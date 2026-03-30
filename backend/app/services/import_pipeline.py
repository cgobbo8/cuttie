"""Mini-pipeline for user-imported clips.

Steps: probe → S3 upload → facecam detection → transcription → dominant color → DONE.
Reuses existing services — no audio analysis, no scoring, no LLM triage.
"""

import json
import logging
import os

from app.models.schemas import HotPoint, LlmAnalysis, SignalBreakdown, StepTiming
from app.services.clipper import _write_probe_and_upload
from app.services.db import create_job, save_hot_points, update_job
from app.services.facecam_detector import detect_facecam
from app.services.subtitle_generator import extract_dominant_color, transcribe_with_words

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"


def _format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h}:{m:02d}:{s:02d}"


def run_import_pipeline(job_id: str, original_filename: str) -> None:
    """Process an imported clip through the mini-pipeline."""
    clip_dir = os.path.join(CLIPS_DIR, job_id)
    clip_path = os.path.join(clip_dir, "clip_01.mp4")

    if not os.path.isfile(clip_path):
        raise FileNotFoundError(f"Imported clip not found: {clip_path}")

    step_timings: dict[str, StepTiming] = {}

    # ── Step 1: Probe + S3 upload ──
    import time

    update_job(job_id, status="CLIPPING", progress="Analyse du fichier...")
    t0 = time.time()

    _write_probe_and_upload(clip_dir, job_id, "clip_01.mp4", clip_path)

    # Read probe data
    probe_path = os.path.join(clip_dir, "clip_01_probe.json")
    if not os.path.isfile(probe_path):
        raise RuntimeError("Failed to probe clip — ffprobe error")

    with open(probe_path) as f:
        probe = json.load(f)

    duration = probe.get("duration", 0)
    width = probe.get("width", 1920)
    height = probe.get("height", 1080)

    step_timings["PROBING"] = StepTiming(start=t0, duration_seconds=time.time() - t0)

    # Write clip meta (used by edit-env resolver)
    meta_path = os.path.join(clip_dir, "clip_01_meta.json")
    with open(meta_path, "w") as f:
        json.dump({"vod_start": 0, "vod_end": duration}, f)

    logger.info(f"[Import] Probe: {width}x{height}, {duration:.1f}s")

    # Update job with duration
    update_job(
        job_id,
        vod_duration_seconds=duration,
        step_timings=step_timings,
    )

    # ── Step 2: Facecam detection ──
    update_job(job_id, progress="Détection facecam...")
    t0 = time.time()

    facecam = detect_facecam(clip_path)
    facecam_path = os.path.join(clip_dir, "facecam.json")
    if facecam:
        with open(facecam_path, "w") as f:
            json.dump(facecam, f)
        logger.info(f"[Import] Facecam: {facecam}")
    else:
        logger.info("[Import] No facecam detected")

    step_timings["FACECAM"] = StepTiming(start=t0, duration_seconds=time.time() - t0)
    update_job(job_id, step_timings=step_timings)

    # ── Step 3: Transcription (Whisper) ──
    update_job(job_id, status="TRANSCRIBING", progress="Transcription...")
    t0 = time.time()

    text, speech_rate, words = transcribe_with_words(clip_path)

    # Save words for edit-env resolver (naming convention: vertical_XX_words.json)
    words_path = os.path.join(clip_dir, "vertical_01_words.json")
    with open(words_path, "w") as f:
        json.dump(words, f, ensure_ascii=False)

    logger.info(f"[Import] Transcription: {len(words)} words, rate={speech_rate:.1f}")

    step_timings["TRANSCRIBING"] = StepTiming(start=t0, duration_seconds=time.time() - t0)
    update_job(job_id, step_timings=step_timings)

    # ── Step 4: Dominant color ──
    update_job(job_id, progress="Extraction couleur...")
    t0 = time.time()

    r, g, b = extract_dominant_color(clip_path)
    color_path = os.path.join(clip_dir, "dominant_color.json")
    with open(color_path, "w") as f:
        json.dump({"r": r, "g": g, "b": b}, f)

    step_timings["COLOR"] = StepTiming(start=t0, duration_seconds=time.time() - t0)

    # ── Step 5: Create hot_point + finalize ──
    clip_name = os.path.splitext(original_filename)[0]

    hot_point = HotPoint(
        timestamp_seconds=0,
        timestamp_display=_format_timestamp(duration),
        score=1.0,
        final_score=1.0,
        signals=SignalBreakdown(),
        clip_filename="clip_01.mp4",
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

    update_job(
        job_id,
        status="DONE",
        progress="Terminé",
        hot_points=[hot_point],
        step_timings=step_timings,
    )

    logger.info(f"[Import] Done — job {job_id}")
