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

    segments = diarize_waveform(waveform, sr)
    if not segments:
        return words

    voiceprint = None
    voiceprint_path = os.path.join(paths.clip_dir(job_id), "_voiceprint.npy")
    if os.path.isfile(voiceprint_path):
        voiceprint = np.load(voiceprint_path)

    job = get_job(job_id)
    streamer_name = (job.streamer if job else None) or "Streamer"

    speaker_names = identify_speakers(waveform, sr, segments, voiceprint, streamer_name)
    return assign_speakers_to_words(words, segments, speaker_names)


def detect_job_facecam(job_id: str, clip_filenames: list[str]) -> dict | None:
    """Detect the facecam region across a few stored clips; caches facecam.json."""
    from app.services.facecam_detector import detect_facecam

    clip_dir = paths.clip_dir(job_id)
    clip_paths = [
        os.path.join(clip_dir, os.path.basename(name))
        for name in clip_filenames
        if os.path.isfile(os.path.join(clip_dir, os.path.basename(name)))
    ]
    if not clip_paths:
        return None

    raw = detect_facecam(clip_paths[0], extra_clips=clip_paths[1:] or None)
    if not raw:
        return None

    result = {k: int(v) for k, v in raw.items()}
    with open(os.path.join(clip_dir, "facecam.json"), "w", encoding="utf-8") as f:
        json.dump(result, f)
    return result
