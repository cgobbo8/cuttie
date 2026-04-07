"""
Lazy transcription helper — called by AdonisJS when no cached words exist.

Runs Whisper transcription + pyannote diarization to produce speaker-labeled
word timestamps. Falls back to plain Whisper if diarization fails.

Usage:
    uv run python transcribe_clip.py <clip_path> <words_path>

Outputs the words JSON array on stdout.
"""
import json
import logging
import os
import subprocess
import sys
import tempfile

from dotenv import load_dotenv

load_dotenv()

from app.services.subtitle_generator import transcribe_with_words

logger = logging.getLogger(__name__)

clip_path = sys.argv[1]
words_path = sys.argv[2]

_, _, words = transcribe_with_words(clip_path)

# Try to add speaker labels via diarization
if words:
    try:
        from app.services.speaker_diarizer import (
            _get_pipeline,
            _get_classifier,
            _cosine_similarity,
            _extract_wav_segment,
            diarize_segment,
            assign_speakers_to_words,
            identify_speakers,
            VOICEPRINT_THRESHOLD,
        )
        import torch
        import torchaudio

        # Extract 16kHz WAV from clip for diarization
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = tmp.name

        subprocess.run(
            ["ffmpeg", "-y", "-i", clip_path, "-vn", "-ac", "1", "-ar", "16000",
             "-loglevel", "error", tmp_wav],
            check=True, capture_output=True, timeout=30,
        )

        # Diarize
        segments = diarize_segment(tmp_wav)

        if segments:
            # Load audio for speaker identification
            waveform, sr = torchaudio.load(tmp_wav)
            if sr != 16000:
                waveform = torchaudio.functional.resample(waveform, sr, 16000)
                sr = 16000

            # Try to load voiceprint from job context
            # The clip_path is like clips/<job_id>/<filename>.mp4
            job_id = os.path.basename(os.path.dirname(clip_path))
            voiceprint = None
            streamer_name = "Streamer"

            # Check if a voiceprint was saved during pipeline
            voiceprint_path = os.path.join("clips", job_id, "_voiceprint.npy")
            if os.path.isfile(voiceprint_path):
                import numpy as np
                voiceprint = np.load(voiceprint_path)

            # Get streamer name from DB
            try:
                import sqlite3
                conn = sqlite3.connect("cuttie.db")
                conn.row_factory = sqlite3.Row
                row = conn.execute("SELECT streamer FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
                if row and row["streamer"]:
                    streamer_name = row["streamer"]
                conn.close()
            except Exception:
                pass

            speaker_names = identify_speakers(
                waveform, sr, segments, voiceprint, streamer_name,
            )
            words = assign_speakers_to_words(words, segments, speaker_names)

        # Cleanup
        os.remove(tmp_wav)

    except Exception as e:
        # Diarization failed — keep plain Whisper words (no speaker labels)
        print(f"Diarization skipped: {e}", file=sys.stderr)

if words:
    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)

print(json.dumps(words, ensure_ascii=False))
