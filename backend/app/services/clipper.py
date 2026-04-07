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
                "-show_streams", "-select_streams", "v:0",
                "-show_format", filepath,
            ],
            capture_output=True, text=True, timeout=15,
        )
        data = json.loads(result.stdout)
        stream = data.get("streams", [{}])[0]
        fmt = data.get("format", {})

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
IDEAL_CLIP_DURATION = 60      # target clip duration

# --- Per-HP clip centering ---
PRE_PEAK_RATIO = 0.6          # 60% of clip before peak (captures build-up)
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

# --- Detected clip bounds ---
DETECTED_PRE_PEAK = 120   # 2 minutes before "clip" keyword
DETECTED_POST_PEAK = 5    # 5 seconds after
DETECTED_MERGE_WINDOW = 0  # Only merge clips that actually overlap (start <= prev end)


def plan_downloads_detected(
    hot_points: list[HotPoint],
    vod_duration: float,
) -> tuple[list[dict], dict[int, list[int]]]:
    """Plan downloads for detected "clip" moments with fixed bounds (-2min / +5s).

    Merges overlapping clips (e.g. streamer says "clip" twice in 1 minute).

    Returns same format as plan_downloads: (groups, shared_clips).
    """
    if not hot_points:
        return [], {}

    # Sort by timestamp
    sorted_hps = sorted(enumerate(hot_points), key=lambda x: x[1].timestamp_seconds)

    # Merge nearby detections into single clips
    merged: list[dict] = []  # {start, end, hp_indices}
    for orig_idx, hp in sorted_hps:
        clip_start = max(0, hp.timestamp_seconds - DETECTED_PRE_PEAK)
        clip_end = min(vod_duration, hp.timestamp_seconds + DETECTED_POST_PEAK)

        if merged and clip_start <= merged[-1]["end"] + DETECTED_MERGE_WINDOW:
            # Extend existing clip to cover this detection
            merged[-1]["end"] = max(merged[-1]["end"], clip_end)
            merged[-1]["hp_indices"].append(orig_idx)
        else:
            merged.append({
                "start": clip_start,
                "end": clip_end,
                "hp_indices": [orig_idx],
            })

    logger.info(
        f"Detected clips: {len(sorted_hps)} detections → {len(merged)} clips after merge"
    )

    # Build groups (same format as plan_downloads)
    groups: list[dict] = []
    shared_clips: dict[int, list[int]] = {}

    for clip_idx, m in enumerate(merged):
        # Offset rank by 100 to avoid collision with normal clip filenames (clip_01..clip_20)
        rank = 100 + clip_idx + 1

        clips_in_group = []
        for hp_idx in m["hp_indices"]:
            clips_in_group.append({
                "rank": rank,
                "index": hp_idx,
                "hp": hot_points[hp_idx],
                "start": m["start"],
                "end": m["end"],
            })

        if len(m["hp_indices"]) > 1:
            shared_clips[rank] = m["hp_indices"]

        groups.append({
            "start": m["start"],
            "end": m["end"],
            "clips": clips_in_group,
        })

        dur = m["end"] - m["start"]
        logger.info(
            f"  Detected clip: {_fmt_time(m['start'])}-{_fmt_time(m['end'])} "
            f"({dur:.0f}s, {len(m['hp_indices'])} detection(s))"
        )

    return groups, shared_clips


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


def _compute_hp_clip_boundary(
    peak: float,
    vod_duration: float,
    segments: list[tuple[float, float]],
    rms_times: np.ndarray | None = None,
    rms_values: np.ndarray | None = None,
    rms_threshold: float = 0.0,
    audio_path: str | None = None,
) -> tuple[float, float]:
    """Compute clip boundaries centered on a hot point peak.

    The peak is always inside the clip (guaranteed). Uses activity segments
    to align with natural moment boundaries when the segment is short enough.
    """
    # Find containing activity segment (if any)
    containing_seg = None
    for seg_start, seg_end in segments:
        if seg_start <= peak <= seg_end:
            containing_seg = (seg_start, seg_end)
            break

    if containing_seg:
        seg_start, seg_end = containing_seg
        seg_duration = seg_end - seg_start

        if seg_duration <= MAX_CLIP_DURATION:
            # Segment fits in one clip — use full segment as natural boundaries
            start, end = seg_start, seg_end
        else:
            # Segment too long — center window on peak (biased toward build-up)
            pre = IDEAL_CLIP_DURATION * PRE_PEAK_RATIO
            post = IDEAL_CLIP_DURATION * (1 - PRE_PEAK_RATIO)
            start = max(seg_start, peak - pre)
            end = min(seg_end, peak + post)
    else:
        # No containing segment — use fallback pre/post windows
        start = max(0, peak - FALLBACK_PRE_PEAK)
        end = min(vod_duration, peak + FALLBACK_POST_PEAK)

    # Enforce minimum duration (shift to other side if one edge hits VOD boundary)
    duration = end - start
    if duration < MIN_CLIP_DURATION:
        deficit = MIN_CLIP_DURATION - duration
        start = max(0, start - deficit / 2)
        end = min(vod_duration, end + deficit / 2)
        # Still short? One side hit a boundary — extend the other
        remaining = MIN_CLIP_DURATION - (end - start)
        if remaining > 0:
            if start == 0:
                end = min(vod_duration, end + remaining)
            else:
                start = max(0, start - remaining)

    # Snap boundaries to silence (extend only, never shorten)
    if audio_path or (rms_times is not None and len(rms_times) > 0):
        _rms_t = rms_times if rms_times is not None else np.array([])
        _rms_v = rms_values if rms_values is not None else np.array([])
        start = _snap_to_quiet(start, -1, _rms_t, _rms_v, rms_threshold, vod_duration, audio_path)
        end = _snap_to_quiet(end, +1, _rms_t, _rms_v, rms_threshold, vod_duration, audio_path)

    return round(start, 1), round(end, 1)


SNAP_SEARCH_SEC = 30.0  # max extension to find silence
FINE_RMS_FRAME_SEC = 0.1  # 100ms windows for fine-grained silence detection
FINE_RMS_HOP_SEC = 0.05   # 50ms hop
SILENCE_THRESHOLD_FACTOR = 0.3  # RMS below 30% of median = silence
MIN_SILENCE_SEC = 0.5     # 500ms sustained silence required (filters micro-pauses)


def _load_fine_rms(
    audio_path: str,
    center: float,
    radius: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Load audio around center±radius and compute fine-grained RMS.

    Returns (times, smoothed_rms) with ~50ms resolution.
    """
    import librosa

    sr = 11025
    offset = max(0.0, center - radius)
    dur = 2 * radius

    try:
        y, _ = librosa.load(audio_path, sr=sr, mono=True, offset=offset, duration=dur)
    except Exception:
        return np.array([]), np.array([])

    min_samples = int(sr * FINE_RMS_FRAME_SEC)
    if len(y) < min_samples:
        return np.array([]), np.array([])

    hop = int(sr * FINE_RMS_HOP_SEC)
    frame = int(sr * FINE_RMS_FRAME_SEC)
    rms = librosa.feature.rms(y=y, frame_length=frame, hop_length=hop)[0]
    times = np.arange(len(rms)) * FINE_RMS_HOP_SEC + offset

    # Smooth to avoid snapping to momentary noise dips (~250ms window)
    kernel_size = 5
    kernel = np.ones(kernel_size) / kernel_size
    rms_smooth = np.convolve(rms, kernel, mode="same")

    return times, rms_smooth


def _find_silence_gaps(
    quiet_mask: np.ndarray,
) -> list[tuple[int, int]]:
    """Find contiguous runs of True in quiet_mask. Returns [(start_idx, end_idx), ...]."""
    gaps: list[tuple[int, int]] = []
    start = None
    for i, q in enumerate(quiet_mask):
        if q:
            if start is None:
                start = i
        else:
            if start is not None:
                gaps.append((start, i))
                start = None
    if start is not None:
        gaps.append((start, len(quiet_mask)))
    return gaps


def _snap_to_quiet_fine(
    time: float,
    direction: int,
    audio_path: str,
    vod_duration: float,
) -> float:
    """Extend clip boundary until a sustained silence is found.

    Always extends (never shortens) because users can trim but cannot extend.
    Requires MIN_SILENCE_SEC (500ms) of sustained silence to cut — this filters
    out micro-pauses where the speaker briefly stops but continues the same thought.

    For clip END (direction=+1): cuts at the START of the silence gap.
    For clip START (direction=-1): cuts at the END of the silence gap.
    """
    fine_times, fine_rms = _load_fine_rms(audio_path, time, SNAP_SEARCH_SEC)

    if len(fine_times) == 0:
        return time

    # Only search in the extending direction (never shorten the clip)
    if direction > 0:
        mask = fine_times >= time
    else:
        mask = fine_times <= time

    if not np.any(mask):
        return time

    cand_t = fine_times[mask]
    cand_rms = fine_rms[mask]

    # Silence = RMS below 30% of median speech level
    median_rms = float(np.median(fine_rms))
    silence_thresh = median_rms * SILENCE_THRESHOLD_FACTOR
    quiet_mask = cand_rms <= silence_thresh

    # Find sustained silence gaps (consecutive quiet frames)
    min_frames = max(1, int(MIN_SILENCE_SEC / FINE_RMS_HOP_SEC))  # 500ms / 50ms = 10 frames
    gaps = _find_silence_gaps(quiet_mask)
    valid_gaps = [(s, e) for s, e in gaps if e - s >= min_frames]

    if valid_gaps:
        if direction > 0:
            # Clip END: cut at start of first sustained silence
            gap_start = valid_gaps[0][0]
            result = float(cand_t[gap_start])
        else:
            # Clip START: cut at end of last sustained silence
            gap_end = valid_gaps[-1][1] - 1
            result = float(cand_t[min(gap_end, len(cand_t) - 1)])
    elif gaps:
        # No sustained silence — use the longest available gap
        longest = max(gaps, key=lambda g: g[1] - g[0])
        if direction > 0:
            result = float(cand_t[longest[0]])
        else:
            result = float(cand_t[min(longest[1] - 1, len(cand_t) - 1)])
    else:
        # No quiet frames at all — extend to quietest moment
        best_idx = int(np.argmin(cand_rms))
        result = float(cand_t[best_idx])

    snapped = round(max(0.0, min(vod_duration, result)), 1)

    shift = snapped - time
    label = "end" if direction > 0 else "start"
    logger.debug(f"Fine snap {label}: {time:.1f} → {snapped:.1f} ({shift:+.1f}s)")

    return snapped


def _snap_to_quiet(
    time: float,
    direction: int,
    rms_times: np.ndarray,
    rms_values: np.ndarray,
    threshold: float,
    vod_duration: float,
    audio_path: str | None = None,
) -> float:
    """Nudge a clip boundary toward a quieter spot to avoid cutting mid-speech.

    When audio_path is available, uses fine-grained RMS (50ms resolution) from
    the raw audio file. Falls back to coarse audio features (2.5s resolution).
    """
    if audio_path and os.path.isfile(audio_path):
        return _snap_to_quiet_fine(time, direction, audio_path, vod_duration)

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


def compute_clip_bounds(
    hot_points: list[HotPoint],
    vod_duration: float,
    audio_features: list[dict] | None = None,
    audio_path: str | None = None,
) -> None:
    """Pre-compute clip boundaries for each hot point using RMS activity segments.

    Stores results directly on HotPoint objects (clip_start / clip_end).
    Called before LLM analysis so Whisper + frames + LLM see the real clip content.
    """
    rms_times, rms_values, _, rms_threshold = _build_rms_lookup(audio_features)
    segments = _detect_activity_segments(rms_times, rms_values, rms_threshold, vod_duration)
    logger.info(f"Activity segments detected: {len(segments)} — computing bounds for {len(hot_points)} HPs")

    for hp in hot_points:
        start, end = _compute_hp_clip_boundary(
            hp.timestamp_seconds, vod_duration, segments,
            rms_times, rms_values, rms_threshold, audio_path,
        )
        hp.clip_start = start
        hp.clip_end = end
        logger.debug(
            f"  HP {hp.timestamp_display}: "
            f"clip={_fmt_time(start)}-{_fmt_time(end)} ({end - start:.0f}s)"
        )


def plan_downloads(
    hot_points: list[HotPoint],
    vod_duration: float,
    audio_features: list[dict] | None = None,
    audio_path: str | None = None,
) -> tuple[list[dict], dict[int, list[int]]]:
    """Compute per-HP clip boundaries and group for batch download.

    Each clip is centered on its HP's peak (guaranteed to include the peak).
    Activity segments guide natural boundaries when short enough, otherwise
    the clip is centered on the peak with a build-up bias.

    Returns:
    - groups: list of download groups {start, end, clips: [{rank, index, hp, start, end}]}
    - shared_clips: {rank -> [hp_indices sharing this clip]} for deduplication
    """
    to_clip = hot_points[:MAX_CLIPS]

    if not to_clip:
        return [], {}

    # Use pre-computed bounds if available, otherwise compute from RMS
    if to_clip[0].clip_start is not None:
        clips_with_bounds: list[dict] = []
        for i, hp in enumerate(to_clip):
            clips_with_bounds.append({
                "rank": i + 1, "index": i, "hp": hp,
                "start": hp.clip_start, "end": hp.clip_end,
            })
        logger.info(f"Using pre-computed bounds for {len(to_clip)} clips")
    else:
        rms_times, rms_values, _, rms_threshold = _build_rms_lookup(audio_features)
        segments = _detect_activity_segments(rms_times, rms_values, rms_threshold, vod_duration)
        logger.info(f"Activity segments detected: {len(segments)}")

        clips_with_bounds = []
        for i, hp in enumerate(to_clip):
            start, end = _compute_hp_clip_boundary(
                hp.timestamp_seconds, vod_duration, segments,
                rms_times, rms_values, rms_threshold, audio_path,
            )
            clips_with_bounds.append({
                "rank": i + 1, "index": i, "hp": hp,
                "start": start, "end": end,
            })
            logger.debug(
                f"  HP {i+1}: peak={_fmt_time(hp.timestamp_seconds)} "
                f"clip={_fmt_time(start)}-{_fmt_time(end)} ({end-start:.0f}s)"
            )

    # Dedup: merge clips with >80% temporal overlap into shared files
    shared_clips: dict[int, list[int]] = {}
    merged_into: dict[int, int] = {}  # j -> i

    for i in range(len(clips_with_bounds)):
        if i in merged_into:
            continue
        for j in range(i + 1, len(clips_with_bounds)):
            if j in merged_into:
                continue

            s1, e1 = clips_with_bounds[i]["start"], clips_with_bounds[i]["end"]
            s2, e2 = clips_with_bounds[j]["start"], clips_with_bounds[j]["end"]

            overlap = max(0, min(e1, e2) - max(s1, s2))
            shorter = min(e1 - s1, e2 - s2)

            if shorter > 0 and overlap / shorter > 0.8:
                # Extend clip i to cover both, mark j as merged
                clips_with_bounds[i]["start"] = min(s1, s2)
                clips_with_bounds[i]["end"] = max(e1, e2)
                merged_into[j] = i

                rank_i = clips_with_bounds[i]["rank"]
                if rank_i not in shared_clips:
                    shared_clips[rank_i] = [clips_with_bounds[i]["index"]]
                shared_clips[rank_i].append(clips_with_bounds[j]["index"])
                logger.info(
                    f"Dedup: merged clip {clips_with_bounds[j]['rank']} into {rank_i} "
                    f"({overlap:.0f}s overlap)"
                )

    active_clips = [c for i, c in enumerate(clips_with_bounds) if i not in merged_into]

    if not active_clips:
        return [], {}

    # Sort by start time and group nearby clips for batch download
    sorted_clips = sorted(active_clips, key=lambda c: c["start"])

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

    total = len(active_clips)
    deduped = sum(len(v) - 1 for v in shared_clips.values())
    logger.info(
        f"Download plan: {total} clips ({deduped} HPs deduplicated) -> "
        f"{len(groups)} groups"
    )
    return groups, shared_clips


def _streamcopy_clip(
    direct_url: str,
    start: float,
    duration: float,
    output_path: str,
) -> bool:
    """Extract a clip via FFmpeg stream copy from an M3U8/direct URL.

    No re-encoding — copies H.264+AAC as-is. ~10x faster than libx264.
    """
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-i", direct_url,
                "-t", str(duration),
                "-c", "copy",
                "-movflags", "+faststart",
                output_path,
            ],
            check=True, timeout=120, capture_output=True, text=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning(f"Stream copy failed: {e}")
        return False


def extract_group(
    url: str,
    group: dict,
    clip_dir: str,
    job_id: str = "",
    direct_url: str | None = None,
) -> list[tuple[int, int, str | None]]:
    """Download and extract clips for a download group.

    If direct_url is provided, uses FFmpeg stream copy (fast, no re-encode).
    Otherwise falls back to yt-dlp download + libx264 compression (legacy).

    Returns: [(rank, index, filename | None), ...]
    """
    clips = group["clips"]
    results: list[tuple[int, int, str | None]] = []

    for c in clips:
        rank, idx = c["rank"], c["index"]
        start, end = c["start"], c["end"]
        duration = end - start
        filename = f"clip_{rank:02d}.mp4"
        filepath = os.path.join(clip_dir, filename)

        logger.info(f"Clip {rank}: {_fmt_time(start)}-{_fmt_time(end)} ({duration:.0f}s)")

        MAX_RETRIES = 2
        success = False

        for attempt in range(1, MAX_RETRIES + 1):
            # Try stream copy first if we have a direct URL
            if direct_url and _streamcopy_clip(direct_url, start, duration, filepath):
                success = True
                break

            # Fallback: yt-dlp download + compress
            raw_file = os.path.join(clip_dir, f"raw_{rank:02d}.mp4")
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
                    success = True
                    break
                else:
                    logger.warning(
                        f"Clip {rank}: raw file missing or compression failed "
                        f"(attempt {attempt}/{MAX_RETRIES})"
                    )

            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
                logger.error(f"Clip {rank} fallback failed (attempt {attempt}/{MAX_RETRIES}): {e}")

            finally:
                if os.path.isfile(raw_file):
                    os.remove(raw_file)

        if success:
            size_mb = os.path.getsize(filepath) / (1024 * 1024)
            logger.info(f"Clip {rank}: {filepath} ({size_mb:.1f}MB)")
            meta_path = os.path.join(clip_dir, f"clip_{rank:02d}_meta.json")
            with open(meta_path, "w") as mf:
                json.dump({"vod_start": start, "vod_end": end}, mf)
            _write_probe_and_upload(clip_dir, job_id, filename, filepath)
            results.append((rank, idx, filename))
        else:
            results.append((rank, idx, None))

    return results
