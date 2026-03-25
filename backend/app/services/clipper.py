"""Extract short video clips around hot points using yt-dlp + ffmpeg compression.

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
CLIP_HALF_DURATION = 30  # seconds before and after hotpoint
MAX_CLIPS = 20
MAX_CLIP_WORKERS = 3  # Parallel clip extractions


def _extract_single_clip(
    job_id: str,
    url: str,
    hp: HotPoint,
    rank: int,
    vod_duration: float,
    clip_dir: str,
) -> tuple[int, str | None]:
    """Extract and compress a single clip. Returns (rank, filename or None)."""
    start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
    end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)
    raw_file = os.path.join(clip_dir, f"raw_{rank:02d}.mp4")
    filename = f"clip_{rank:02d}.mp4"
    filepath = os.path.join(clip_dir, filename)

    logger.info(f"Extracting clip {rank}: {_fmt_time(start)} - {_fmt_time(end)}")

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
                _extract_single_clip, job_id, url, hp, rank, vod_duration, clip_dir,
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
