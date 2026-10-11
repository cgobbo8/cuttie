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
