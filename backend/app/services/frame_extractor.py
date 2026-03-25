"""Extract key frames from clips for vision analysis.

Extracts frames at:
1. Whisper segment boundaries (aligned with speech)
2. Regular intervals (~3s) to fill gaps
3. Deduplicates to avoid redundant frames too close together.
"""

import logging
import os
import subprocess

logger = logging.getLogger(__name__)

FRAMES_DIR = "frames"
MIN_FRAME_GAP = 2.0  # Minimum seconds between extracted frames
REGULAR_INTERVAL = 3.0  # Interval for gap-filling frames


def extract_frames(
    clip_path: str,
    job_id: str,
    clip_index: int,
    segment_timestamps: list[float] | None = None,
) -> list[dict]:
    """Extract key frames from a clip video.

    Args:
        clip_path: Path to the clip MP4 file.
        job_id: Job ID for organizing output.
        clip_index: Clip rank/index (1-based).
        segment_timestamps: Whisper segment start times (seconds into the clip).

    Returns:
        List of dicts: [{"time": float, "path": str, "source": str}, ...]
    """
    frame_dir = os.path.join(FRAMES_DIR, job_id, f"clip_{clip_index:02d}")
    os.makedirs(frame_dir, exist_ok=True)

    # Get clip duration
    duration = _get_duration(clip_path)
    if duration <= 0:
        logger.warning(f"Could not determine duration for {clip_path}")
        return []

    # Build target timestamps
    targets: set[float] = set()

    # Add segment timestamps from Whisper
    if segment_timestamps:
        for t in segment_timestamps:
            if 0 <= t <= duration:
                targets.add(round(t, 1))

    # Add regular interval frames
    t = 0.0
    while t <= duration:
        targets.add(round(t, 1))
        t += REGULAR_INTERVAL

    # Always include first and last second
    targets.add(0.0)
    targets.add(round(max(0, duration - 0.5), 1))

    # Sort and deduplicate (merge timestamps closer than MIN_FRAME_GAP)
    sorted_times = sorted(targets)
    final_times: list[float] = []
    for t in sorted_times:
        if not final_times or (t - final_times[-1]) >= MIN_FRAME_GAP:
            final_times.append(t)

    # Extract frames with ffmpeg
    frames: list[dict] = []
    for i, t in enumerate(final_times):
        filename = f"frame_{i:03d}_{t:.1f}s.jpg"
        filepath = os.path.join(frame_dir, filename)

        if os.path.isfile(filepath):
            # Already extracted (resume support)
            frames.append({"time": t, "path": filepath, "source": "cached"})
            continue

        success = _extract_single_frame(clip_path, t, filepath)
        if success:
            frames.append({"time": t, "path": filepath, "source": "extracted"})

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
    except (ValueError, subprocess.TimeoutExpired):
        return 0.0


def _extract_single_frame(clip_path: str, timestamp: float, output_path: str) -> bool:
    """Extract a single frame at the given timestamp."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(timestamp),
                "-i", clip_path,
                "-frames:v", "1",
                "-q:v", "3",  # JPEG quality (2-5 is good, lower = better)
                output_path,
            ],
            check=True,
            timeout=10,
            capture_output=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False
