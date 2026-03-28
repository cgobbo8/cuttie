"""Extract short video clips around hot points using yt-dlp + ffmpeg compression.

Dynamic clip boundaries: uses the RMS energy curve to find natural IN/OUT points.
- IN: scan backwards from peak to find a quiet moment (natural scene start)
- OUT: extend forward while the streamer is still reacting (don't cut mid-dialogue)
"""

import json
import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np

from app.models.schemas import HotPoint
from app.services.db import update_hot_point_clip
from app.services.s3_storage import upload_file as s3_upload

logger = logging.getLogger(__name__)


def _write_probe_and_upload(clip_dir: str, job_id: str, filename: str, filepath: str):
    """Write probe JSON (ffprobe dimensions/duration) and upload clip to S3."""
    rank_str = filename.replace("clip_", "").replace(".mp4", "")
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_streams", "-select_streams", "v:0", filepath,
            ],
            capture_output=True, text=True, timeout=15,
        )
        stream = json.loads(result.stdout).get("streams", [{}])[0]

        # Get duration from format section (more reliable)
        dur_result = subprocess.run(
            [
                "ffprobe", "-v", "quiet", "-print_format", "json",
                "-show_format", filepath,
            ],
            capture_output=True, text=True, timeout=15,
        )
        fmt = json.loads(dur_result.stdout).get("format", {})

        probe_data = {
            "width": stream.get("width", 1920),
            "height": stream.get("height", 1080),
            "duration": float(fmt.get("duration", stream.get("duration", 0))),
        }
        probe_path = os.path.join(clip_dir, f"clip_{rank_str}_probe.json")
        with open(probe_path, "w") as f:
            json.dump(probe_data, f)
        logger.debug(f"Probe written: {probe_path}")
    except Exception as e:
        logger.warning(f"Failed to write probe for {filename}: {e}")

    try:
        s3_upload(filepath, f"clips/{job_id}/{filename}")
    except Exception as e:
        logger.error(f"S3 upload failed for {filename}: {e}")

CLIPS_DIR = "clips"
MAX_CLIPS = 20
MAX_CLIP_WORKERS = 5

# Default boundaries (used as starting point for dynamic adjustment)
PRE_PEAK_WINDOW = 20   # default seconds before peak
POST_PEAK_WINDOW = 15  # default seconds after peak

# Hard limits for dynamic extension
MAX_PRE_PEAK = 25      # never start more than 25s before peak
MAX_POST_PEAK = 25     # never extend more than 25s after peak
MIN_CLIP_DURATION = 30
MAX_CLIP_DURATION = 60
CLIP_HALF_DURATION = 30  # fallback (exported for other modules)

# Merge threshold: if two clips overlap or are within this gap, merge them
MERGE_GAP_SEC = 10

# RMS threshold: fraction above baseline to consider "active"
# e.g., 0.3 means 30% above median RMS = still active
ACTIVITY_THRESHOLD_FACTOR = 0.3

# Number of consecutive quiet windows to confirm "calm" for OUT point
CALM_CONFIRM_WINDOWS = 2

# Batch download: merge clips closer than this gap into one yt-dlp call
BATCH_GAP_SEC = 15


def _build_rms_lookup(audio_features: list[dict] | None) -> tuple[np.ndarray, np.ndarray, float, float]:
    """Build RMS arrays and compute baseline/threshold from audio features.

    Returns (times, rms_values, baseline, activity_threshold).
    """
    if not audio_features:
        return np.array([]), np.array([]), 0.0, 0.0

    times = np.array([w["time"] for w in audio_features])
    rms = np.array([w["rms"] for w in audio_features])

    baseline = float(np.median(rms))
    ceiling = float(np.percentile(rms, 85))
    threshold = baseline + ACTIVITY_THRESHOLD_FACTOR * (ceiling - baseline)

    return times, rms, baseline, threshold


def _get_rms_at(time: float, rms_times: np.ndarray, rms_values: np.ndarray) -> float:
    """Get RMS value at a given timestamp (nearest window)."""
    if len(rms_times) == 0:
        return 0.0
    idx = np.argmin(np.abs(rms_times - time))
    return float(rms_values[idx])


def _find_dynamic_start(
    peak: float,
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    threshold: float,
    vod_duration: float,
) -> float:
    """Find a natural IN point by scanning backwards for a quiet moment.

    Logic: from the default start (PRE_PEAK_WINDOW before peak), scan backwards.
    If it's already quiet at default start, use it.
    If it's active, look further back for a quiet spot (up to MAX_PRE_PEAK).
    """
    default_start = max(0, peak - PRE_PEAK_WINDOW)
    earliest_start = max(0, peak - MAX_PRE_PEAK)

    if len(rms_times) == 0:
        return default_start

    # Check if default start is already quiet
    rms_at_default = _get_rms_at(default_start, rms_times, rms_values)
    if rms_at_default < threshold:
        return default_start

    # Default start is in the middle of activity — scan backwards for quiet
    hop = rms_times[1] - rms_times[0] if len(rms_times) > 1 else 2.5
    t = default_start - hop
    while t >= earliest_start:
        rms_val = _get_rms_at(t, rms_times, rms_values)
        if rms_val < threshold:
            return max(0, t)
        t -= hop

    # No quiet spot found — use max pre-peak
    return earliest_start


def _find_dynamic_end(
    peak: float,
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    threshold: float,
    vod_duration: float,
) -> float:
    """Find a natural OUT point by extending while there's still activity.

    Logic: from the default end (POST_PEAK_WINDOW after peak), check if still active.
    If quiet, stop there. If still active (streamer reacting), extend until calm.
    Requires CALM_CONFIRM_WINDOWS consecutive quiet windows to confirm end.
    """
    default_end = min(vod_duration, peak + POST_PEAK_WINDOW)
    latest_end = min(vod_duration, peak + MAX_POST_PEAK)

    if len(rms_times) == 0:
        return default_end

    # Check if default end is already quiet
    rms_at_default = _get_rms_at(default_end, rms_times, rms_values)
    if rms_at_default < threshold:
        return default_end

    # Still active at default end — extend until calm
    hop = rms_times[1] - rms_times[0] if len(rms_times) > 1 else 2.5
    calm_count = 0
    t = default_end + hop
    while t <= latest_end:
        rms_val = _get_rms_at(t, rms_times, rms_values)
        if rms_val < threshold:
            calm_count += 1
            if calm_count >= CALM_CONFIRM_WINDOWS:
                return min(vod_duration, t)
        else:
            calm_count = 0
        t += hop

    # Hit max — stop here
    return latest_end


def _compute_clip_boundaries(
    hp: HotPoint,
    vod_duration: float,
    all_hot_points: list[HotPoint] | None = None,
    rms_times: np.ndarray | None = None,
    rms_values: np.ndarray | None = None,
    rms_threshold: float = 0.0,
) -> tuple[float, float]:
    """Compute dynamic clip start/end around a hot point.

    Uses RMS energy to find natural IN/OUT points, then applies merge logic
    for nearby hot points, and enforces min/max duration.
    """
    peak = hp.timestamp_seconds

    # Step 1: Dynamic boundaries based on RMS
    if rms_times is not None and len(rms_times) > 0:
        start = _find_dynamic_start(peak, rms_times, rms_values, rms_threshold, vod_duration)
        end = _find_dynamic_end(peak, rms_times, rms_values, rms_threshold, vod_duration)
    else:
        # Fallback to fixed boundaries
        start = max(0, peak - PRE_PEAK_WINDOW)
        end = min(vod_duration, peak + POST_PEAK_WINDOW)

    # Step 2: Merge nearby hot points
    if all_hot_points:
        for other in all_hot_points:
            if other is hp:
                continue
            other_t = other.timestamp_seconds
            if end < other_t < end + MERGE_GAP_SEC:
                end = min(vod_duration, other_t + POST_PEAK_WINDOW)
            if start - MERGE_GAP_SEC < other_t < start:
                start = max(0, other_t - PRE_PEAK_WINDOW)

    # Step 3: Enforce min/max duration
    duration = end - start
    if duration < MIN_CLIP_DURATION:
        pad = (MIN_CLIP_DURATION - duration) / 2
        start = max(0, start - pad)
        end = min(vod_duration, end + pad)
    elif duration > MAX_CLIP_DURATION:
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
    rms_times: np.ndarray | None = None,
    rms_values: np.ndarray | None = None,
    rms_threshold: float = 0.0,
) -> tuple[int, str | None]:
    """Extract and compress a single clip. Returns (rank, filename or None)."""
    start, end = _compute_clip_boundaries(
        hp, vod_duration, all_hot_points,
        rms_times, rms_values, rms_threshold,
    )
    raw_file = os.path.join(clip_dir, f"raw_{rank:02d}.mp4")
    filename = f"clip_{rank:02d}.mp4"
    filepath = os.path.join(clip_dir, filename)

    logger.info(f"Extracting clip {rank}: {_fmt_time(start)} - {_fmt_time(end)} ({end-start:.0f}s)")

    try:
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
            timeout=300,
            capture_output=True,
            text=True,
        )

        if not os.path.isfile(raw_file):
            logger.warning(f"Clip {rank}: raw file not created")
            return rank, None

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", raw_file,
                "-c:v", "libx264", "-preset", "fast",
                "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                filepath,
            ],
            check=True,
            timeout=240,
            capture_output=True,
            text=True,
        )

        if os.path.isfile(raw_file):
            os.remove(raw_file)

        if os.path.isfile(filepath):
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            logger.info(f"Clip {rank} saved: {filepath} ({size_mb:.1f}MB)")
            # Save VOD timing metadata for editor/chat filtering
            meta_path = os.path.join(clip_dir, f"clip_{rank:02d}_meta.json")
            with open(meta_path, "w") as f:
                json.dump({"vod_start": start, "vod_end": end}, f)
            _write_probe_and_upload(clip_dir, job_id, filename, filepath)
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
    audio_features: list[dict] | None = None,
) -> None:
    """Download and compress video segments around each hot point (parallel).

    If audio_features are provided, uses RMS for dynamic clip boundaries.
    """
    clip_dir = os.path.join(CLIPS_DIR, job_id)
    os.makedirs(clip_dir, exist_ok=True)

    # Build RMS lookup for dynamic boundaries
    rms_times, rms_values, _, rms_threshold = _build_rms_lookup(audio_features)

    to_clip = hot_points[:MAX_CLIPS]

    with ThreadPoolExecutor(max_workers=MAX_CLIP_WORKERS) as executor:
        futures = {}
        for i, hp in enumerate(to_clip):
            rank = i + 1
            future = executor.submit(
                _extract_single_clip, job_id, url, hp, rank, vod_duration, clip_dir, to_clip,
                rms_times, rms_values, rms_threshold,
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


def _compress_clip(raw_path: str, output_path: str) -> bool:
    """Compress a raw clip to h264 (source resolution). Returns True on success."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", raw_path,
                "-c:v", "libx264", "-preset", "fast",
                "-crf", "18",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ],
            check=True,
            timeout=240,
            capture_output=True,
            text=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.error(f"Compression failed: {e}")
        return False


def plan_downloads(
    hot_points: list[HotPoint],
    vod_duration: float,
    audio_features: list[dict] | None = None,
) -> list[dict]:
    """Pre-compute clip boundaries and group nearby clips for batch download.

    Clips within BATCH_GAP_SEC of each other are merged into a single yt-dlp
    call, reducing connection overhead.

    Returns list of download groups, each with:
    - start/end: download time range
    - clips: list of {rank, index, hp, start, end}
    """
    rms_times, rms_values, _, rms_threshold = _build_rms_lookup(audio_features)
    to_clip = hot_points[:MAX_CLIPS]

    clips_with_bounds = []
    for i, hp in enumerate(to_clip):
        start, end = _compute_clip_boundaries(
            hp, vod_duration, to_clip,
            rms_times, rms_values, rms_threshold,
        )
        clips_with_bounds.append({
            "rank": i + 1, "index": i, "hp": hp,
            "start": start, "end": end,
        })

    if not clips_with_bounds:
        return []

    # Sort by start time and group nearby clips
    sorted_clips = sorted(clips_with_bounds, key=lambda c: c["start"])

    groups: list[dict] = []
    current = [sorted_clips[0]]
    g_start = sorted_clips[0]["start"]
    g_end = sorted_clips[0]["end"]

    for clip in sorted_clips[1:]:
        if clip["start"] <= g_end + BATCH_GAP_SEC:
            current.append(clip)
            g_end = max(g_end, clip["end"])
        else:
            groups.append({"start": g_start, "end": g_end, "clips": current})
            current = [clip]
            g_start = clip["start"]
            g_end = clip["end"]
    groups.append({"start": g_start, "end": g_end, "clips": current})

    single = sum(1 for g in groups if len(g["clips"]) == 1)
    batched = sum(1 for g in groups if len(g["clips"]) > 1)
    logger.info(
        f"Download plan: {len(clips_with_bounds)} clips -> "
        f"{len(groups)} groups ({single} single, {batched} batched)"
    )
    return groups


def extract_group(
    url: str,
    group: dict,
    clip_dir: str,
    job_id: str = "",
) -> list[tuple[int, int, str | None]]:
    """Download and extract clips for a download group.

    Single-clip groups: direct yt-dlp download + compress.
    Multi-clip groups: one yt-dlp call for the merged range, then FFmpeg split.

    Returns: [(rank, index, filename | None), ...]
    """
    clips = group["clips"]
    results: list[tuple[int, int, str | None]] = []

    if len(clips) == 1:
        c = clips[0]
        rank, idx = c["rank"], c["index"]
        start, end = c["start"], c["end"]
        raw_file = os.path.join(clip_dir, f"raw_{rank:02d}.mp4")
        filename = f"clip_{rank:02d}.mp4"
        filepath = os.path.join(clip_dir, filename)

        logger.info(f"Clip {rank}: {_fmt_time(start)}-{_fmt_time(end)} ({end-start:.0f}s)")

        try:
            subprocess.run(
                [
                    "yt-dlp",
                    "--download-sections", f"*{_fmt_time(start)}-{_fmt_time(end)}",
                    "--force-keyframes-at-cuts", "-f", "best",
                    "-o", raw_file, "--no-warnings", url,
                ],
                check=True, timeout=300, capture_output=True, text=True,
            )

            if os.path.isfile(raw_file) and _compress_clip(raw_file, filepath):
                size_mb = os.path.getsize(filepath) / (1024 * 1024)
                logger.info(f"Clip {rank}: {filepath} ({size_mb:.1f}MB)")
                # Save VOD timing metadata for editor chat layer
                meta_path = os.path.join(clip_dir, f"clip_{rank:02d}_meta.json")
                with open(meta_path, "w") as mf:
                    json.dump({"vod_start": start, "vod_end": end}, mf)
                _write_probe_and_upload(clip_dir, job_id, filename, filepath)
                results.append((rank, idx, filename))
            else:
                results.append((rank, idx, None))

        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            logger.error(f"Clip {rank} failed: {e}")
            results.append((rank, idx, None))

        finally:
            if os.path.isfile(raw_file):
                os.remove(raw_file)

    else:
        # Multi-clip group: download merged range, then split + compress each
        g_start, g_end = group["start"], group["end"]
        group_file = os.path.join(clip_dir, f"group_{clips[0]['rank']:02d}.mp4")

        logger.info(
            f"Batch {len(clips)} clips: {_fmt_time(g_start)}-{_fmt_time(g_end)} "
            f"({g_end-g_start:.0f}s)"
        )

        try:
            subprocess.run(
                [
                    "yt-dlp",
                    "--download-sections", f"*{_fmt_time(g_start)}-{_fmt_time(g_end)}",
                    "--force-keyframes-at-cuts", "-f", "best",
                    "-o", group_file, "--no-warnings", url,
                ],
                check=True, timeout=300, capture_output=True, text=True,
            )

            if not os.path.isfile(group_file):
                for c in clips:
                    results.append((c["rank"], c["index"], None))
                return results

            # Split each clip from the group file
            for c in clips:
                rank, idx = c["rank"], c["index"]
                local_start = c["start"] - g_start
                duration = c["end"] - c["start"]
                filename = f"clip_{rank:02d}.mp4"
                filepath = os.path.join(clip_dir, filename)

                try:
                    subprocess.run(
                        [
                            "ffmpeg", "-y",
                            "-ss", str(local_start),
                            "-i", group_file,
                            "-t", str(duration),
                            "-c:v", "libx264", "-preset", "fast",
                            "-crf", "18",
                            "-c:a", "aac", "-b:a", "128k",
                            "-movflags", "+faststart",
                            filepath,
                        ],
                        check=True, timeout=240, capture_output=True, text=True,
                    )

                    if os.path.isfile(filepath):
                        size_mb = os.path.getsize(filepath) / (1024 * 1024)
                        logger.info(f"Clip {rank} split: {filepath} ({size_mb:.1f}MB)")
                        # Save VOD timing metadata for editor chat layer
                        meta_path = os.path.join(clip_dir, f"clip_{rank:02d}_meta.json")
                        with open(meta_path, "w") as mf:
                            json.dump({"vod_start": c["start"], "vod_end": c["end"]}, mf)
                        _write_probe_and_upload(clip_dir, job_id, filename, filepath)
                        results.append((rank, idx, filename))
                    else:
                        results.append((rank, idx, None))

                except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                    logger.error(f"Clip {rank} split failed: {e}")
                    if os.path.isfile(filepath):
                        os.remove(filepath)
                    results.append((rank, idx, None))

        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            logger.error(f"Group download failed: {e}")
            for c in clips:
                results.append((c["rank"], c["index"], None))

        finally:
            if os.path.isfile(group_file):
                os.remove(group_file)

    return results
