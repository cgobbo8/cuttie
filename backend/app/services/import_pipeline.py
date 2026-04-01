"""Mini-pipeline for user-imported clips.

Steps: probe → S3 upload → transcription → DONE.
Reuses existing services. Skips facecam/dominant color (reuses job's existing data).
Publishes the new hot_point via clip_ready SSE so AdonisJS persists it.
"""

import json
import logging
import os
import time

from app.models.schemas import HotPoint, LlmAnalysis, SignalBreakdown
from app.services.clipper import _write_probe_and_upload
from app.services.db import publish_clip_ready, rename_clip_files, slugify_clip_name, update_job
from app.services.subtitle_generator import transcribe_with_words

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"


def _format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}"


def run_add_clip_pipeline(job_id: str, clip_filename: str, clip_name: str, rank: int) -> None:
    """Process an imported clip and add it to an existing job.

    The clip file must already be at clips/<job_id>/<clip_filename>.
    Facecam and dominant color are reused from the job's existing data.
    """
    clip_dir = os.path.join(CLIPS_DIR, job_id)
    clip_path = os.path.join(clip_dir, clip_filename)

    if not os.path.isfile(clip_path):
        raise FileNotFoundError(f"Imported clip not found: {clip_path}")

    # ── Step 1: Probe + S3 upload ──
    logger.info(f"[AddClip] Probing {clip_filename}...")
    _write_probe_and_upload(clip_dir, job_id, clip_filename, clip_path)

    probe_path = os.path.join(clip_dir, clip_filename.replace(".mp4", "_probe.json"))
    if not os.path.isfile(probe_path):
        raise RuntimeError("Failed to probe clip — ffprobe error")

    with open(probe_path) as f:
        probe = json.load(f)

    duration = probe.get("duration", 0)
    logger.info(f"[AddClip] Probe: {duration:.1f}s")

    # Write clip meta (used by edit-env resolver)
    base = os.path.splitext(clip_filename)[0]
    meta_path = os.path.join(clip_dir, f"{base}_meta.json")
    with open(meta_path, "w") as f:
        json.dump({"vod_start": 0, "vod_end": duration}, f)

    # ── Step 2: Transcription (Whisper via Groq) ──
    logger.info(f"[AddClip] Transcribing {clip_filename}...")
    text, speech_rate, words = transcribe_with_words(clip_path)

    words_path = os.path.join(clip_dir, f"{base}_words.json")
    with open(words_path, "w") as f:
        json.dump(words, f, ensure_ascii=False)

    logger.info(f"[AddClip] Transcription: {len(words)} words")

    # ── Step 3: Build hot_point and publish via SSE ──
    hot_point = HotPoint(
        timestamp_seconds=0,
        timestamp_display=_format_timestamp(duration),
        score=1.0,
        final_score=1.0,
        signals=SignalBreakdown(),
        clip_filename=clip_filename,
        clip_name=clip_name,
        chat_mood="",
        llm=LlmAnalysis(
            summary="",
            narrative="",
            transcript=text,
            virality_score=0,
            is_clipable=True,
            category="",
            key_moments=[],
        ),
    )

    # Rename clip to slug of clip_name
    if clip_name:
        new_filename = slugify_clip_name(clip_name)
        try:
            from app.services.s3_storage import rename_object
            rename_object(f"clips/{job_id}/{clip_filename}", f"clips/{job_id}/{new_filename}")
            rename_clip_files(job_id, clip_filename, new_filename)
            hot_point.clip_filename = new_filename
            logger.info(f"[AddClip] Renamed {clip_filename} → {new_filename}")
        except Exception as e:
            logger.warning(f"[AddClip] Clip rename failed: {e}")

    # Publish via Redis SSE — AdonisJS job_status_bus will persist the hot_point
    publish_clip_ready(job_id, rank, hot_point)

    logger.info(f"[AddClip] Done — {hot_point.clip_filename} added to job {job_id}")
