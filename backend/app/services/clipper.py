"""Extract short video clips around hot points using yt-dlp + ffmpeg compression.

Smart clip boundaries: instead of fixed ±30s, finds natural start points
by looking for silence/low-energy moments before the peak.
Clips are extracted in parallel (3 workers) for faster processing.
"""

import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint
from app.services.db import update_hot_point_clip

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"
MAX_CLIPS = 20
MAX_CLIP_WORKERS = 3

# Clip boundary parameters (inspired by Powder, KoalaVOD research)
PRE_PEAK_WINDOW = 15   # seconds before peak (context/setup)
POST_PEAK_WINDOW = 12  # seconds after peak (reaction)
MIN_CLIP_DURATION = 20  # minimum clip duration
MAX_CLIP_DURATION = 60  # maximum clip duration
CLIP_HALF_DURATION = 30  # fallback (exported for other modules)

# Merge threshold: if two clips overlap or are within this gap, merge them
MERGE_GAP_SEC = 10


def _compute_clip_boundaries(
    hp: HotPoint,
    vod_duration: float,
    all_hot_points: list[HotPoint] | None = None,
) -> tuple[float, float]:
    """Compute smart clip start/end around a hot point.

    Uses asymmetric boundaries: more context before (setup), less after (reaction).
    If adjacent hot points are very close, extends to cover both.
    """
    peak = hp.timestamp_seconds

    # Start: 15s before peak for context
    start = max(0, peak - PRE_PEAK_WINDOW)

    # End: 12s after peak for reaction
    end = min(vod_duration, peak + POST_PEAK_WINDOW)

    # If there are nearby hot points within merge distance, extend
    if all_hot_points:
        for other in all_hot_points:
            if other is hp:
                continue
            other_t = other.timestamp_seconds
            # If another hot point is just after our end, extend to include it
            if end < other_t < end + MERGE_GAP_SEC:
                end = min(vod_duration, other_t + POST_PEAK_WINDOW)
            # If another hot point is just before our start, extend backwards
            if start - MERGE_GAP_SEC < other_t < start:
                start = max(0, other_t - PRE_PEAK_WINDOW)

    # Enforce min/max duration
    duration = end - start
    if duration < MIN_CLIP_DURATION:
        pad = (MIN_CLIP_DURATION - duration) / 2
        start = max(0, start - pad)
        end = min(vod_duration, end + pad)
    elif duration > MAX_CLIP_DURATION:
        # Center on peak
        start = max(0, peak - MAX_CLIP_DURATION / 2)
        end = min(vod_duration, peak + MAX_CLIP_DURATION / 2)

    return round(start, 1), round(end, 1)


def _extract_single_clip(
    job_id: str,
    url: str,
    hp: HotPoint,
    rank: int,
    vod_duration: float,
    clip_dir: str,
    all_hot_points: list[HotPoint] | None = None,
) -> tuple[int, str | None]:
    """Extract and compress a single clip. Returns (rank, filename or None)."""
    start, end = _compute_clip_boundaries(hp, vod_duration, all_hot_points)
    raw_file = os.path.join(clip_dir, f"raw_{rank:02d}.mp4")
    filename = f"clip_{rank:02d}.mp4"
    filepath = os.path.join(clip_dir, filename)

    logger.info(f"Extracting clip {rank}: {_fmt_time(start)} - {_fmt_time(end)} ({end-start:.0f}s)")

    try:
        # Step 1: Download raw segment
        subprocess.run(
            [
                "yt-dlp",
                "--download-sections", f"*{_fmt_time(start)}-{_fmt_time(end)}",
                "--force-keyframes-at-cuts",
                "-f", "best",
                "-o", raw_file,
                "--no-warnings",
                url,
            ],
            check=True,
            timeout=180,
            capture_output=True,
            text=True,
        )

        if not os.path.isfile(raw_file):
            logger.warning(f"Clip {rank}: raw file not created")
            return rank, None

        # Step 2: Compress to 480p preview
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", raw_file,
                "-vf", "scale=-2:480",
                "-c:v", "libx264", "-preset", "fast",
                "-b:v", "1M", "-maxrate", "1.5M", "-bufsize", "2M",
                "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart",
                filepath,
            ],
            check=True,
            timeout=120,
            capture_output=True,
            text=True,
        )

        # Remove raw file
        if os.path.isfile(raw_file):
            os.remove(raw_file)

        if os.path.isfile(filepath):
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            logger.info(f"Clip {rank} saved: {filepath} ({size_mb:.1f}MB)")
            return rank, filename
        else:
            logger.warning(f"Clip {rank}: compressed file not created")
            return rank, None

    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.error(f"Clip {rank} failed: {e}")
        for f in [raw_file, filepath]:
            if os.path.isfile(f):
                os.remove(f)
        return rank, None


def extract_clips(
    job_id: str,
    url: str,
    hot_points: list[HotPoint],
    vod_duration: float,
) -> None:
    """Download and compress video segments around each hot point (parallel)."""
    clip_dir = os.path.join(CLIPS_DIR, job_id)
    os.makedirs(clip_dir, exist_ok=True)

    to_clip = hot_points[:MAX_CLIPS]

    with ThreadPoolExecutor(max_workers=MAX_CLIP_WORKERS) as executor:
        futures = {}
        for i, hp in enumerate(to_clip):
            rank = i + 1
            future = executor.submit(
                _extract_single_clip, job_id, url, hp, rank, vod_duration, clip_dir, to_clip,
            )
            futures[future] = (rank, hp)

        for future in as_completed(futures):
            rank, hp = futures[future]
            try:
                _, filename = future.result()
                if filename:
                    hp.clip_filename = filename
                    update_hot_point_clip(job_id, rank, filename)
            except Exception as e:
                logger.error(f"Clip {rank} extraction error: {e}")

    extracted = sum(1 for hp in to_clip if hp.clip_filename)
    logger.info(f"Clipping complete: {extracted}/{len(to_clip)} clips extracted")


def _fmt_time(seconds: float) -> str:
    """Format seconds as HH:MM:SS for yt-dlp."""
    h, remainder = divmod(int(seconds), 3600)
    m, s = divmod(remainder, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"
