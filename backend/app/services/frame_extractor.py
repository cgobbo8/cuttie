"""Extract key frames from clips or directly from VOD URLs.

Two modes:
- extract_frames(): from a local clip file (used after clipping for re-analysis)
- extract_frames_from_url(): from a remote VOD URL via ffmpeg seek (used pre-clipping)
"""

import logging
import os
import subprocess
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed

logger = logging.getLogger(__name__)

FRAMES_DIR = "frames"
NUM_FRAMES = 6  # Evenly-spaced frames per candidate
FRAME_WORKERS = 10  # Parallel ffmpeg seeks for remote extraction


def get_vod_direct_url(vod_url: str) -> str:
    """Get direct video URL from a Twitch VOD URL via yt-dlp.

    Returns the best quality direct/m3u8 URL that ffmpeg can seek into.
    """
    t0 = _time.time()
    try:
        result = subprocess.run(
            ["yt-dlp", "-g", "-f", "best", "--no-warnings", vod_url],
            capture_output=True, text=True, timeout=30, check=True,
        )
        url = result.stdout.strip().split("\n")[0]
        logger.info(f"Got direct VOD URL in {_time.time() - t0:.1f}s ({len(url)} chars)")
        return url
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.error(f"Failed to get direct VOD URL: {e}")
        raise


def extract_frames_from_url(
    direct_url: str,
    job_id: str,
    candidate_index: int,
    vod_timestamps: list[float],
    num_frames: int = NUM_FRAMES,
) -> list[dict]:
    """Extract evenly-spaced frames from a remote VOD URL via ffmpeg seek.

    Each frame is extracted with a separate ffmpeg call using -ss (fast seek).
    For HLS/m3u8 URLs, ffmpeg downloads only the segment containing the timestamp.

    Args:
        direct_url: Direct video URL (m3u8 or mp4) from get_vod_direct_url().
        job_id: Job ID for organizing output.
        candidate_index: Candidate index (0-based, used for folder naming).
        vod_timestamps: List of absolute VOD timestamps (seconds) to extract frames at.
        num_frames: Number of frames to extract (evenly spaced across the window).

    Returns:
        List of dicts: [{"time": float, "path": str}, ...]
    """
    frame_dir = os.path.join(FRAMES_DIR, job_id, f"cand_{candidate_index:03d}")
    os.makedirs(frame_dir, exist_ok=True)

    if not vod_timestamps or len(vod_timestamps) < 2:
        logger.warning(f"Candidate {candidate_index}: not enough timestamps for frame extraction")
        return []

    window_start = vod_timestamps[0]
    window_end = vod_timestamps[-1]
    window_duration = window_end - window_start

    # Compute evenly-spaced timestamps within the candidate window
    if num_frames <= 1:
        target_times = [window_start]
    else:
        step = window_duration / (num_frames - 1)
        target_times = [round(window_start + i * step, 1) for i in range(num_frames)]

    t0 = _time.time()
    frames: list[dict] = []

    for i, vod_t in enumerate(target_times):
        # Time relative to candidate window start (for display in LLM prompt)
        relative_t = round(vod_t - window_start, 1)
        filename = f"frame_{i:03d}_{relative_t:.1f}s.jpg"
        filepath = os.path.join(frame_dir, filename)

        if os.path.isfile(filepath):
            frames.append({"time": relative_t, "path": filepath})
            continue

        success = _extract_remote_frame(direct_url, vod_t, filepath)
        if success:
            frames.append({"time": relative_t, "path": filepath})
        else:
            logger.debug(f"Candidate {candidate_index}: failed to extract frame at {vod_t:.1f}s")

    elapsed = _time.time() - t0
    logger.info(
        f"Candidate {candidate_index}: extracted {len(frames)}/{num_frames} frames "
        f"from URL in {elapsed:.1f}s (window {window_start:.0f}s-{window_end:.0f}s)"
    )
    return frames


def extract_frames_batch(
    direct_url: str,
    job_id: str,
    candidates: list[dict],
    num_frames: int = NUM_FRAMES,
    max_workers: int = FRAME_WORKERS,
) -> dict[int, list[dict]]:
    """Extract frames for multiple candidates in parallel.

    Args:
        direct_url: Direct VOD URL.
        job_id: Job ID.
        candidates: List of {"index": int, "start": float, "end": float}.
        num_frames: Frames per candidate.
        max_workers: Parallel workers.

    Returns:
        Dict mapping candidate index -> list of frame dicts.
    """
    t0 = _time.time()
    total = len(candidates)
    logger.info(f"Extracting {num_frames} frames for {total} candidates with {max_workers} workers...")

    results: dict[int, list[dict]] = {}

    def _extract_one(cand: dict) -> tuple[int, list[dict]]:
        idx = cand["index"]
        timestamps = [cand["start"], cand["end"]]
        return idx, extract_frames_from_url(
            direct_url, job_id, idx, timestamps, num_frames,
        )

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_extract_one, c): c["index"] for c in candidates}
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                idx, frames = future.result()
                results[idx] = frames
            except Exception as e:
                idx = futures[future]
                logger.error(f"Frame extraction failed for candidate {idx}: {e}")
                results[idx] = []

            if done % 10 == 0 or done == total:
                logger.info(f"Frame extraction progress: {done}/{total}")

    elapsed = _time.time() - t0
    total_frames = sum(len(f) for f in results.values())
    logger.info(f"Frame extraction complete: {total_frames} frames for {total} candidates in {elapsed:.1f}s")
    return results


def _extract_remote_frame(url: str, timestamp: float, output_path: str) -> bool:
    """Extract a single frame from a remote URL at the given VOD timestamp."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(timestamp),
                "-i", url,
                "-frames:v", "1",
                "-q:v", "3",
                "-loglevel", "error",
                output_path,
            ],
            check=True,
            timeout=30,  # longer timeout for remote seeks
            capture_output=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.debug("Failed to extract remote frame at %.1fs: %s", timestamp, e)
        return False


# --- Local clip frame extraction (used for re-analysis after clipping) ---

def extract_frames(
    clip_path: str,
    job_id: str,
    clip_index: int,
    num_frames: int = NUM_FRAMES,
) -> list[dict]:
    """Extract evenly-spaced frames from a local clip file.

    Args:
        clip_path: Path to the clip MP4 file.
        job_id: Job ID for organizing output.
        clip_index: Clip rank/index (1-based).
        num_frames: Number of frames to extract.

    Returns:
        List of dicts: [{"time": float, "path": str}, ...]
    """
    frame_dir = os.path.join(FRAMES_DIR, job_id, f"clip_{clip_index:02d}")
    os.makedirs(frame_dir, exist_ok=True)

    duration = _get_duration(clip_path)
    if duration <= 0:
        logger.warning(f"Could not determine duration for {clip_path}")
        return []

    if num_frames <= 1:
        final_times = [0.0]
    else:
        step = duration / (num_frames - 1)
        final_times = [round(i * step, 1) for i in range(num_frames)]
        final_times[-1] = round(min(final_times[-1], max(0, duration - 0.5)), 1)

    frames: list[dict] = []
    for i, t in enumerate(final_times):
        filename = f"frame_{i:03d}_{t:.1f}s.jpg"
        filepath = os.path.join(frame_dir, filename)

        if os.path.isfile(filepath):
            frames.append({"time": t, "path": filepath})
            continue

        success = _extract_single_frame(clip_path, t, filepath)
        if success:
            frames.append({"time": t, "path": filepath})

    logger.info(f"Extracted {len(frames)} frames from clip {clip_index} ({duration:.0f}s)")
    return frames


def _get_duration(clip_path: str) -> float:
    """Get video duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-show_entries", "format=duration",
                "-of", "csv=p=0",
                clip_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return float(result.stdout.strip())
    except (ValueError, subprocess.TimeoutExpired) as e:
        logger.warning("Failed to get duration for %s: %s", clip_path, e)
        return 0.0


def _extract_single_frame(clip_path: str, timestamp: float, output_path: str) -> bool:
    """Extract a single frame at the given timestamp from a local file."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(timestamp),
                "-i", clip_path,
                "-frames:v", "1",
                "-q:v", "3",
                output_path,
            ],
            check=True,
            timeout=10,
            capture_output=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning("Failed to extract frame at %.1fs from %s: %s", timestamp, clip_path, e)
        return False
