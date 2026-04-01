"""Extract short video clips around hot points using yt-dlp + ffmpeg compression.

Activity-segment approach: instead of centering clips on a single peak with
limited extension, we detect contiguous high-energy regions in the RMS curve
and clip the full segment. Hot points that fall within the same segment share
a single clip (deduplication).
"""

import json
import logging
import os
import subprocess

import numpy as np

from app.models.schemas import HotPoint
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

# --- Activity segment detection ---
SEGMENT_GAP_TOLERANCE = 5.0   # seconds of quiet tolerated within one segment
SEGMENT_PADDING = 5.0         # seconds of padding before/after a detected segment
SEGMENT_MATCH_RADIUS = 10.0   # HP within this distance of a segment edge is assigned

# --- Clip duration limits ---
MIN_CLIP_DURATION = 45
MAX_CLIP_DURATION = 90
IDEAL_CLIP_DURATION = 60      # target when sub-windowing a long segment

# --- Fallback for orphan hot points (no matching segment) ---
FALLBACK_PRE_PEAK = 25
FALLBACK_POST_PEAK = 20

# --- RMS threshold ---
ACTIVITY_THRESHOLD_FACTOR = 0.3

# --- Batch download ---
BATCH_GAP_SEC = 15

# --- Backward-compatible aliases (imported by triage.py, llm_analyzer.py) ---
PRE_PEAK_WINDOW = 25
POST_PEAK_WINDOW = 20
CLIP_HALF_DURATION = 30


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


def _detect_activity_segments(
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    threshold: float,
    vod_duration: float,
) -> list[tuple[float, float]]:
    """Detect contiguous high-energy regions in the RMS curve.

    Bridges short gaps (< SEGMENT_GAP_TOLERANCE) and adds SEGMENT_PADDING
    around each detected segment.
    """
    if len(rms_times) < 2:
        return []

    hop = float(rms_times[1] - rms_times[0])
    active = rms_values >= threshold

    # Find rising/falling edges
    diff = np.diff(active.astype(np.int8))
    starts = np.where(diff == 1)[0] + 1  # index where active begins
    ends = np.where(diff == -1)[0] + 1    # index where active ends

    # Handle edge cases: starts/ends at array boundaries
    if active[0]:
        starts = np.concatenate(([0], starts))
    if active[-1]:
        ends = np.concatenate((ends, [len(active)]))

    if len(starts) == 0:
        return []

    # Build raw segments as (start_time, end_time)
    raw_segments = []
    for s, e in zip(starts, ends):
        raw_segments.append((float(rms_times[s]), float(rms_times[min(e, len(rms_times) - 1)])))

    # Merge segments separated by less than gap tolerance
    merged = [raw_segments[0]]
    for seg_start, seg_end in raw_segments[1:]:
        prev_start, prev_end = merged[-1]
        if seg_start - prev_end <= SEGMENT_GAP_TOLERANCE:
            merged[-1] = (prev_start, seg_end)
        else:
            merged.append((seg_start, seg_end))

    # Apply padding and clamp
    padded = []
    for seg_start, seg_end in merged:
        padded.append((
            max(0.0, seg_start - SEGMENT_PADDING),
            min(vod_duration, seg_end + SEGMENT_PADDING),
        ))

    return padded


def _assign_hotpoints_to_segments(
    hot_points: list[HotPoint],
    segments: list[tuple[float, float]],
) -> tuple[dict[int, list[tuple[int, HotPoint]]], list[tuple[int, HotPoint]]]:
    """Assign each hot point to its containing activity segment.

    Returns (segment_map, orphans) where:
    - segment_map[seg_idx] = [(original_index, hp), ...]
    - orphans = [(original_index, hp), ...] for HPs not in any segment
    """
    segment_map: dict[int, list[tuple[int, HotPoint]]] = {}
    orphans: list[tuple[int, HotPoint]] = []

    for i, hp in enumerate(hot_points):
        t = hp.timestamp_seconds
        assigned = False
        for seg_idx, (seg_start, seg_end) in enumerate(segments):
            # Match if inside segment or within match radius of its edges
            if (seg_start - SEGMENT_MATCH_RADIUS) <= t <= (seg_end + SEGMENT_MATCH_RADIUS):
                segment_map.setdefault(seg_idx, []).append((i, hp))
                assigned = True
                break
        if not assigned:
            orphans.append((i, hp))

    return segment_map, orphans


def _pick_best_subwindow(
    seg_start: float,
    seg_end: float,
    hot_points: list[tuple[int, HotPoint]],
) -> tuple[float, float]:
    """Pick the densest sub-window within a long segment.

    Uses a sliding window of IDEAL_CLIP_DURATION, maximizing total HP score.
    Then extends to MAX_CLIP_DURATION if possible.
    """
    seg_duration = seg_end - seg_start
    window = min(IDEAL_CLIP_DURATION, seg_duration)
    step = 2.5

    best_start = seg_start
    best_score = -1.0

    t = seg_start
    while t + window <= seg_end + 0.1:
        total = sum(
            hp.score for _, hp in hot_points
            if t <= hp.timestamp_seconds <= t + window
        )
        if total > best_score:
            best_score = total
            best_start = t
        t += step

    # Try to extend symmetrically up to MAX_CLIP_DURATION
    extra = min(MAX_CLIP_DURATION - window, seg_duration - window) / 2
    clip_start = max(seg_start, best_start - extra)
    clip_end = min(seg_end, best_start + window + extra)

    return clip_start, clip_end


SNAP_SEARCH_SEC = 5.0  # how far to look for a quiet spot at clip edges


def _snap_to_quiet(
    time: float,
    direction: int,
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    threshold: float,
    vod_duration: float,
) -> float:
    """Nudge a clip boundary toward a quieter spot to avoid cutting mid-speech.

    direction: -1 = move earlier (for start), +1 = move later (for end).
    Scans up to SNAP_SEARCH_SEC in the given direction for RMS below threshold.
    """
    if len(rms_times) < 2:
        return time

    hop = float(rms_times[1] - rms_times[0])
    best_t = time
    best_rms = _get_rms_at(time, rms_times, rms_values)

    t = time + direction * hop
    limit = time + direction * SNAP_SEARCH_SEC
    while (direction > 0 and t <= limit) or (direction < 0 and t >= limit):
        if t < 0 or t > vod_duration:
            break
        rms_val = _get_rms_at(t, rms_times, rms_values)
        if rms_val < threshold:
            return round(max(0, min(vod_duration, t)), 1)
        if rms_val < best_rms:
            best_rms = rms_val
            best_t = t
        t += direction * hop

    return round(max(0, min(vod_duration, best_t)), 1)


def _compute_segment_clip_boundary(
    seg_start: float,
    seg_end: float,
    hot_points: list[tuple[int, HotPoint]],
    vod_duration: float,
    rms_times: np.ndarray | None = None,
    rms_values: np.ndarray | None = None,
    rms_threshold: float = 0.0,
) -> tuple[float, float]:
    """Compute clip start/end for an activity segment."""
    seg_duration = seg_end - seg_start

    if seg_duration <= MAX_CLIP_DURATION:
        start, end = seg_start, seg_end
    else:
        start, end = _pick_best_subwindow(seg_start, seg_end, hot_points)

    # Enforce minimum duration
    duration = end - start
    if duration < MIN_CLIP_DURATION:
        pad = (MIN_CLIP_DURATION - duration) / 2
        start = max(0, start - pad)
        end = min(vod_duration, end + pad)

    # Snap boundaries to quieter spots to avoid cutting mid-speech
    if rms_times is not None and len(rms_times) > 0:
        start = _snap_to_quiet(start, -1, rms_times, rms_values, rms_threshold, vod_duration)
        end = _snap_to_quiet(end, +1, rms_times, rms_values, rms_threshold, vod_duration)

    return round(start, 1), round(end, 1)


def _compute_fallback_boundary(
    hp: HotPoint,
    vod_duration: float,
    rms_times: np.ndarray | None = None,
    rms_values: np.ndarray | None = None,
    rms_threshold: float = 0.0,
) -> tuple[float, float]:
    """Fallback boundaries for orphan hot points (not in any activity segment)."""
    peak = hp.timestamp_seconds
    start = max(0, peak - FALLBACK_PRE_PEAK)
    end = min(vod_duration, peak + FALLBACK_POST_PEAK)

    duration = end - start
    if duration < MIN_CLIP_DURATION:
        pad = (MIN_CLIP_DURATION - duration) / 2
        start = max(0, start - pad)
        end = min(vod_duration, end + pad)

    # Snap boundaries to quieter spots to avoid cutting mid-speech
    if rms_times is not None and len(rms_times) > 0:
        start = _snap_to_quiet(start, -1, rms_times, rms_values, rms_threshold, vod_duration)
        end = _snap_to_quiet(end, +1, rms_times, rms_values, rms_threshold, vod_duration)

    return round(start, 1), round(end, 1)



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
) -> tuple[list[dict], dict[int, list[int]]]:
    """Pre-compute clip boundaries using activity segments and group for batch download.

    Detects contiguous high-energy segments in the RMS curve, assigns hot points
    to segments, and deduplicates: multiple HPs in one segment produce a single clip.

    Returns:
    - groups: list of download groups {start, end, clips: [{rank, index, hp, start, end}]}
    - shared_clips: {rank -> [hp_indices sharing this clip]} for deduplication
    """
    rms_times, rms_values, _, rms_threshold = _build_rms_lookup(audio_features)
    to_clip = hot_points[:MAX_CLIPS]

    if not to_clip:
        return [], {}

    # Detect activity segments from RMS curve
    segments = _detect_activity_segments(rms_times, rms_values, rms_threshold, vod_duration)
    logger.info(f"Activity segments detected: {len(segments)}")
    for i, (s, e) in enumerate(segments):
        logger.debug(f"  Segment {i}: {_fmt_time(s)}-{_fmt_time(e)} ({e-s:.0f}s)")

    # Assign hot points to segments
    segment_map, orphans = _assign_hotpoints_to_segments(to_clip, segments)

    clips_with_bounds: list[dict] = []
    shared_clips: dict[int, list[int]] = {}  # rank -> [hp indices]
    rank_counter = 0

    # Process segments: one clip per segment, assigned to best-scoring HP
    for seg_idx in sorted(segment_map.keys()):
        hp_list = segment_map[seg_idx]
        seg_start, seg_end = segments[seg_idx]

        start, end = _compute_segment_clip_boundary(
            seg_start, seg_end, hp_list, vod_duration,
            rms_times, rms_values, rms_threshold,
        )

        # Sort by score descending — best HP gets the clip
        hp_list_sorted = sorted(hp_list, key=lambda x: x[1].score, reverse=True)
        primary_idx, primary_hp = hp_list_sorted[0]

        rank_counter += 1
        rank = rank_counter

        clips_with_bounds.append({
            "rank": rank, "index": primary_idx, "hp": primary_hp,
            "start": start, "end": end,
        })

        # Track shared clip for dedup
        all_indices = [idx for idx, _ in hp_list_sorted]
        if len(all_indices) > 1:
            shared_clips[rank] = all_indices
            logger.info(
                f"Segment {seg_idx}: {len(hp_list)} HPs merged into clip {rank} "
                f"({_fmt_time(start)}-{_fmt_time(end)}, {end-start:.0f}s)"
            )

    # Process orphans: one clip per orphan HP
    for orig_idx, hp in orphans:
        start, end = _compute_fallback_boundary(
            hp, vod_duration, rms_times, rms_values, rms_threshold,
        )
        rank_counter += 1
        clips_with_bounds.append({
            "rank": rank_counter, "index": orig_idx, "hp": hp,
            "start": start, "end": end,
        })

    if not clips_with_bounds:
        return [], {}

    # Sort by start time and group nearby clips for batch download
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

    total = len(clips_with_bounds)
    deduped = sum(len(v) - 1 for v in shared_clips.values())
    single = sum(1 for g in groups if len(g["clips"]) == 1)
    batched = sum(1 for g in groups if len(g["clips"]) > 1)
    logger.info(
        f"Download plan: {total} clips ({deduped} HPs deduplicated) -> "
        f"{len(groups)} groups ({single} single, {batched} batched)"
    )
    return groups, shared_clips


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

        MAX_RETRIES = 2
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                subprocess.run(
                    [
                        "yt-dlp",
                        "--download-sections", f"*{_fmt_time(start)}-{_fmt_time(end)}",
                        "--force-keyframes-at-cuts", "-f", "best",
                        "--concurrent-fragments", "5",
                        "-o", raw_file, "--no-warnings", url,
                    ],
                    check=True, timeout=600, capture_output=True, text=True,
                )

                if os.path.isfile(raw_file) and _compress_clip(raw_file, filepath):
                    size_mb = os.path.getsize(filepath) / (1024 * 1024)
                    logger.info(f"Clip {rank}: {filepath} ({size_mb:.1f}MB)")
                    meta_path = os.path.join(clip_dir, f"clip_{rank:02d}_meta.json")
                    with open(meta_path, "w") as mf:
                        json.dump({"vod_start": start, "vod_end": end}, mf)
                    _write_probe_and_upload(clip_dir, job_id, filename, filepath)
                    results.append((rank, idx, filename))
                    break
                else:
                    logger.warning(f"Clip {rank}: raw file missing or compression failed (attempt {attempt}/{MAX_RETRIES})")
                    if attempt == MAX_RETRIES:
                        results.append((rank, idx, None))

            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                logger.error(f"Clip {rank} failed (attempt {attempt}/{MAX_RETRIES}): {e}")
                if os.path.isfile(raw_file):
                    os.remove(raw_file)
                if attempt == MAX_RETRIES:
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
                    "--concurrent-fragments", "5",
                    "-o", group_file, "--no-warnings", url,
                ],
                check=True, timeout=600, capture_output=True, text=True,
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
