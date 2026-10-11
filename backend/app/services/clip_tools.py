"""On-demand helpers for the clip editor (called through the worker HTTP server)."""

import json
import logging
import os
import subprocess
import tempfile

from app.services import paths

logger = logging.getLogger(__name__)


def transcribe_clip_words(job_id: str, clip_filename: str) -> list[dict]:
    """Word-level transcription of a stored clip, with speaker labels when possible.

    Writes <clip>_words.json next to the clip and returns the words.
    """
    from app.services.subtitle_generator import transcribe_with_words

    clip_dir = paths.clip_dir(job_id)
    clip_path = os.path.join(clip_dir, clip_filename)
    if not os.path.isfile(clip_path):
        raise FileNotFoundError(clip_path)

    _, _, words = transcribe_with_words(clip_path)

    if words:
        try:
            words = _label_speakers(job_id, clip_path, words)
        except Exception as e:
            # Diarization is optional — keep plain Whisper words
            logger.warning(f"Diarization skipped for {clip_filename}: {e}")

        base = os.path.splitext(clip_filename)[0]
        with open(os.path.join(clip_dir, f"{base}_words.json"), "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False)

    return words


def _label_speakers(job_id: str, clip_path: str, words: list[dict]) -> list[dict]:
    import numpy as np

    from app.services.db import get_job
    from app.services.speaker_diarizer import (
        _load_wav,
        assign_speakers_to_words,
        diarize_waveform,
        identify_speakers,
    )

    fd, tmp_wav = tempfile.mkstemp(suffix=".wav", dir=paths.WORK_DIR)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", clip_path, "-vn", "-ac", "1", "-ar", "16000",
             "-loglevel", "error", tmp_wav],
            check=True, capture_output=True, timeout=30,
        )
        waveform, sr = _load_wav(tmp_wav)
    finally:
        os.remove(tmp_wav)

    voiceprint = None
    voiceprint_path = os.path.join(paths.clip_dir(job_id), "_voiceprint.npy")
    if os.path.isfile(voiceprint_path):
        voiceprint = np.load(voiceprint_path)

    segments = diarize_waveform(waveform, sr, voiceprint)
    if not segments:
        return words

    job = get_job(job_id)
    streamer_name = (job.streamer if job else None) or "Streamer"

    speaker_names = identify_speakers(waveform, sr, segments, voiceprint, streamer_name)
    return assign_speakers_to_words(words, segments, speaker_names)


def detect_job_facecam(job_id: str, clip_filenames: list[str]) -> dict | None:
    """Locate the webcam across stored clips and cache it in facecam.json.

    facecam.json also keeps where people stand along each clip (v3: with the
    time of each frame), so the API can check whether the cam is on screen in
    the part of a clip that gets exported.
    """
    from app.services.facecam_detector import analyze_clips

    clip_dir = paths.clip_dir(job_id)
    clip_paths = [
        os.path.join(clip_dir, os.path.basename(name))
        for name in clip_filenames
        if os.path.isfile(os.path.join(clip_dir, os.path.basename(name)))
    ]
    if not clip_paths:
        return None

    result = analyze_clips(clip_paths)
    with open(os.path.join(clip_dir, "facecam.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 3, **result}, f)
    return result["rect"]


VOD_SAMPLES = 10
VOD_FRAME_WORKERS = 5


def detect_vod_facecam(vod_id: str, duration: float) -> dict:
    """Find the webcam on a Twitch VOD before any analysis (first launch).

    Frames are taken across the whole live, so game footage differs a lot
    from one to the next while the cam overlay stays put. The frame shown to
    the streamer is stored as brand/webcam_<vod_id>.jpg.
    """
    import shutil
    from concurrent.futures import ThreadPoolExecutor

    import cv2

    from app.services.facecam_detector import analyze_frames
    from app.services.frame_extractor import _extract_remote_frame, get_vod_direct_url

    direct_url = get_vod_direct_url(f"https://www.twitch.tv/videos/{vod_id}", max_height=1080)
    times = [duration * (0.08 + 0.84 * i / (VOD_SAMPLES - 1)) for i in range(VOD_SAMPLES)]

    os.makedirs(paths.WORK_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="webcam_", dir=paths.WORK_DIR)
    try:
        files = [os.path.join(tmp, f"frame_{i:02d}.jpg") for i in range(VOD_SAMPLES)]
        with ThreadPoolExecutor(max_workers=VOD_FRAME_WORKERS) as pool:
            ok = list(pool.map(lambda job: _extract_remote_frame(direct_url, *job), zip(times, files)))
        frames = [img for img in (cv2.imread(f) for f, good in zip(files, ok) if good) if img is not None]
        if len(frames) < 3:
            raise RuntimeError(f"only {len(frames)} frames read from the VOD")

        rect, shown = analyze_frames(frames)
        key = f"brand/webcam_{vod_id}.jpg"
        dest = paths.storage_path(key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        cv2.imwrite(dest, frames[shown], [cv2.IMWRITE_JPEG_QUALITY, 88])
        height, width = frames[shown].shape[:2]
        logger.info(f"VOD {vod_id}: webcam {rect} on {len(frames)} frames")
        return {"facecam": rect, "frame_key": key, "frame_w": width, "frame_h": height}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── A clip made longer (more before or after it, asked from the trim strip) ──

EXTEND_ATTEMPTS = 2


def extend_clip(job_id: str, clip_filename: str, vod_url: str, start: float, end: float) -> dict:
    """Extract a stored clip again over a wider part of the live (`start`-`end`, live seconds).

    The clip keeps its name and its sidecars follow: _meta.json (where it sits
    in the live), _probe.json, _words.json (the added part's words come from
    the live transcript, or that part alone is transcribed; speakers labelled
    again) and its cam check in facecam.json.
    """
    from app.services.clipper import _streamcopy_clip
    from app.services.frame_extractor import get_vod_direct_url

    clip_dir = paths.clip_dir(job_id)
    clip_path = os.path.join(clip_dir, clip_filename)
    if not os.path.isfile(clip_path):
        raise FileNotFoundError(clip_path)
    base = os.path.splitext(clip_filename)[0]
    meta_path = os.path.join(clip_dir, f"{base}_meta.json")
    meta = _read_json(meta_path)
    meta = meta if isinstance(meta, dict) else {}
    old_start = float(meta.get("vod_start", start))
    old_end = float(meta.get("vod_end", end))

    tmp = os.path.join(clip_dir, f"{base}.extending.mp4")
    for _ in range(EXTEND_ATTEMPTS):
        direct = get_vod_direct_url(vod_url)
        if direct and _streamcopy_clip(direct, start, end - start, tmp) and _duration(tmp) >= (end - start) - 2:
            break
    else:
        if os.path.isfile(tmp):
            os.remove(tmp)
        raise RuntimeError("the live's video could not be fetched")
    _replace(tmp, clip_path)

    probe = _probe(clip_path)
    meta.update({"vod_start": round(start, 1), "vod_end": round(end, 1)})
    _write_json(meta_path, meta)
    _write_json(os.path.join(clip_dir, f"{base}_probe.json"), probe)

    added_before = round(old_start - start, 1)
    try:
        _extend_words(job_id, os.path.join(clip_dir, f"{base}_words.json"), clip_path, start, end, old_start, old_end)
    except Exception as e:
        logger.warning(f"Words of {clip_filename} not extended: {e}")
    try:
        _recheck_cam(job_id, clip_filename, clip_path)
    except Exception as e:
        logger.warning(f"Cam of {clip_filename} not checked again: {e}")
    logger.info(f"Clip {clip_filename} now {start:.1f}-{end:.1f} (was {old_start:.1f}-{old_end:.1f})")
    return {"vod_start": meta["vod_start"], "vod_end": meta["vod_end"], "duration": probe["duration"], "added_before": added_before}


RESTORE_WORKERS = 3
# What yt-dlp says about a VOD Twitch deleted (7 to 60 days after the live)
_GONE = ("does not exist", "404", "not available", "deleted", "private")


class LiveGone(Exception):
    """The live is no longer on Twitch: its clips can't be cut again."""


def restore_clips(job_id: str, vod_url: str, clips: list[dict]) -> dict:
    """Cut a project's clips again from the live, at the same places (`clips`:
    filename, start, end in live seconds), after they were deleted to free disk
    space. Their sidecars stayed: same words, same cam, same thumbnails."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    from app.services.clipper import _streamcopy_clip
    from app.services.frame_extractor import get_vod_direct_url

    try:
        direct = get_vod_direct_url(vod_url)
    except subprocess.CalledProcessError as e:
        said = f"{e.stderr or ''} {e.stdout or ''}".lower()
        if any(word in said for word in _GONE):
            raise LiveGone(vod_url) from e
        raise RuntimeError("the live's video could not be fetched") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("the live's video could not be fetched") from e

    clip_dir = paths.clip_dir(job_id)
    os.makedirs(clip_dir, exist_ok=True)
    t0 = time.time()

    def restore(clip: dict) -> bool:
        name = os.path.basename(clip["filename"])
        start, end = float(clip["start"]), float(clip["end"])
        target = os.path.join(clip_dir, name)
        if os.path.isfile(target):
            return True
        tmp = os.path.join(clip_dir, f"{os.path.splitext(name)[0]}.restoring.mp4")
        if _streamcopy_clip(direct, start, end - start, tmp) and _duration(tmp) >= (end - start) - 2:
            _replace(tmp, target)
            return True
        if os.path.isfile(tmp):
            os.remove(tmp)
        return False

    with ThreadPoolExecutor(RESTORE_WORKERS) as pool:
        done = list(pool.map(restore, clips))
    restored = [os.path.basename(c["filename"]) for c, ok in zip(clips, done) if ok]
    failed = [os.path.basename(c["filename"]) for c, ok in zip(clips, done) if not ok]
    logger.info(f"[{job_id[:8]}] Clips cut again from the live: {len(restored)}/{len(clips)} in {time.time() - t0:.0f} s")
    return {"restored": restored, "failed": failed}


def _extend_words(job_id: str, words_path: str, clip_path: str, start: float, end: float, old_start: float, old_end: float) -> None:
    """Shift the clip's words to its new start and add the words of the added parts."""
    old = _read_json(words_path)
    if not isinstance(old, list):
        return  # never transcribed: the editor does it when the clip opens
    shift = old_start - start
    words = [{**w, "start": round(w["start"] + shift, 3), "end": round(w["end"] + shift, 3)} for w in old]
    for a, b in ((start, old_start), (old_end, end)):
        if b - a > 0.5:
            words += _words_between(job_id, clip_path, start, a, b)
    words.sort(key=lambda w: w["start"])
    try:
        words = _label_speakers(job_id, clip_path, words)
    except Exception as e:
        logger.warning(f"Speakers not labelled again on {os.path.basename(clip_path)}: {e}")
    _write_json(words_path, words)


def _words_between(job_id: str, clip_path: str, clip_start: float, a: float, b: float) -> list[dict]:
    """Words said between `a` and `b` (live seconds), in clip seconds: from the live transcript, else transcribed."""
    from app.services.vod_transcript import cached_words

    live = cached_words(job_id, a, b)
    if live is not None:
        return [{"word": w["word"], "start": round(w["start"] - clip_start, 3), "end": round(w["end"] - clip_start, 3)} for w in live]

    from app.services.llm_analyzer import _transcribe_audio

    os.makedirs(paths.WORK_DIR, exist_ok=True)
    fd, audio = tempfile.mkstemp(suffix=".mp3", dir=paths.WORK_DIR)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(a - clip_start), "-t", str(b - a), "-i", clip_path,
             "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-loglevel", "error", audio],
            check=True, capture_output=True, timeout=60,
        )
        _text, _rate, _segments, words = _transcribe_audio(audio)
    finally:
        os.remove(audio)
    offset = a - clip_start
    return [{"word": w["word"], "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)} for w in words]


def _recheck_cam(job_id: str, clip_filename: str, clip_path: str) -> None:
    """Who stands where along the new clip, in facecam.json (the API judges the cam from it)."""
    from app.services.facecam_detector import presence

    path = os.path.join(paths.clip_dir(job_id), "facecam.json")
    data = _read_json(path)
    if not isinstance(data, dict) or data.get("version") not in (2, 3):
        return
    seen = presence(clip_path)
    if not seen:
        return
    data.setdefault("people", {})[clip_filename], data.setdefault("frames", {})[clip_filename] = seen
    data["version"] = 3
    _write_json(path, data)


def _probe(path: str) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "v:0", "-show_format", path],
        capture_output=True, text=True, timeout=15,
    )
    data = json.loads(result.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    return {
        "width": stream.get("width", 1920),
        "height": stream.get("height", 1080),
        "duration": round(float((data.get("format") or {}).get("duration", stream.get("duration", 0)) or 0), 3),
    }


def _duration(path: str) -> float:
    return _probe(path)["duration"] if os.path.isfile(path) else 0.0


def _replace(src: str, dst: str, attempts: int = 10) -> None:
    """os.replace, waiting a little when a reader still holds the old file (Windows)."""
    import time

    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.5)


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
