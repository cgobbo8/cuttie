"""Pipeline orchestrator — runs the full analysis in a background thread."""

import logging
import os
import shutil
from concurrent.futures import ThreadPoolExecutor

from app.services.audio_analyzer import analyze_audio
from app.services.chat_analyzer import analyze_chat
from app.services.clipper import extract_clips
from app.services.db import get_job, update_job
from app.services.downloader import download_audio, download_chat
from app.services.llm_analyzer import analyze_hot_points
from app.services.scorer import compute_scores
from app.services.triage import run_triage

logger = logging.getLogger(__name__)

# Steps that can be resumed from (in order)
RESUMABLE_FROM = {
    "CLIPPING",
    "TRANSCRIBING",
    "LLM_ANALYSIS",
}


def run_pipeline_sync(job_id: str, url: str, resume_from: str | None = None) -> None:
    """Synchronous pipeline — FastAPI runs this in a threadpool automatically.

    If resume_from is set, skip completed steps and resume from that point.
    """
    output_dir = os.path.join("data", job_id)

    try:
        job = get_job(job_id) if resume_from else None
        hot_points = list(job.hot_points) if job and job.hot_points else None
        duration = job.vod_duration_seconds if job else 0
        vod_title = job.vod_title if job else ""
        vod_game = job.vod_game if job else ""
        streamer = job.streamer if job else ""
        view_count = job.view_count if job else 0
        stream_date = job.stream_date if job else ""

        chat_messages: list[dict] = []
        audio_path: str | None = None
        triage_transcripts: dict[int, tuple[str, float]] = {}

        # Steps 1-6: Download + Analysis + Triage (skip if resuming from later step)
        if not resume_from or resume_from in ("DOWNLOADING_AUDIO", "DOWNLOADING_CHAT", "ANALYZING_AUDIO", "ANALYZING_CHAT", "SCORING", "TRIAGE"):
            # 1 & 2. Download audio + chat in parallel (both I/O bound)
            update_job(job_id, status="DOWNLOADING_AUDIO", progress="Downloading audio + chat...")
            with ThreadPoolExecutor(max_workers=2) as dl_pool:
                audio_future = dl_pool.submit(download_audio, url, output_dir)
                chat_future = dl_pool.submit(download_chat, url)

                audio_path, metadata = audio_future.result()
                chat_messages = chat_future.result()

            duration = metadata.get("duration", 0)
            vod_title = metadata.get("title", "")
            vod_game = metadata.get("game", "")
            streamer = metadata.get("streamer", "")
            view_count = metadata.get("view_count", 0)
            stream_date = metadata.get("stream_date", "")
            update_job(
                job_id,
                vod_title=vod_title,
                vod_game=vod_game,
                vod_duration_seconds=duration,
                streamer=streamer,
                view_count=view_count,
                stream_date=stream_date,
            )
            logger.info(f"Downloaded {len(chat_messages)} chat messages")

            # 3. Analyze audio
            update_job(job_id, status="ANALYZING_AUDIO", progress="Analyzing audio signals...")
            audio_features = analyze_audio(audio_path)

            # 4. Analyze chat
            update_job(job_id, status="ANALYZING_CHAT", progress="Analyzing chat activity...")
            chat_features = analyze_chat(chat_messages, duration)

            # 5. Score and find peaks — get top 50 candidates for triage
            update_job(job_id, status="SCORING", progress="Computing scores and finding hot points...")
            hot_points = compute_scores(audio_features, chat_features, total_duration=duration, top_n=50)

            # 6. Save initial hot points to DB
            update_job(job_id, hot_points=hot_points)

            # 7. LLM triage: transcribe 50 candidates, LLM scores, keep top 20
            vod_meta = {
                "title": vod_title or "",
                "game": vod_game or "",
                "streamer": streamer or "",
                "view_count": view_count or 0,
                "stream_date": stream_date or "",
                "duration": duration,
            }
            hot_points, triage_transcripts = run_triage(
                job_id, audio_path, hot_points, duration,
                chat_messages, vod_meta,
                candidates_n=50, keep_n=20,
            )

        # Step 8: Clipping (skip if resuming from transcription or later)
        if not resume_from or resume_from in ("CLIPPING",):
            update_job(job_id, status="CLIPPING", progress="Downloading video clips...", error=None)
            if hot_points is None:
                raise RuntimeError("No hot points available for clipping")
            extract_clips(job_id, url, hot_points, duration)

        # Step 9: Vision + LLM full analysis (reuses triage transcripts)
        if not resume_from or resume_from in ("CLIPPING", "TRANSCRIBING", "LLM_ANALYSIS"):
            update_job(job_id, status="LLM_ANALYSIS", progress="Analyse IA des clips (vision + synthese)...", error=None)
            if hot_points is None:
                raise RuntimeError("No hot points available for analysis")

            # If resuming, re-attach clip filenames from DB
            if resume_from:
                _reattach_clips(job_id, hot_points)

            vod_meta = {
                "title": vod_title or "",
                "game": vod_game or "",
                "streamer": streamer or "",
                "view_count": view_count or 0,
                "stream_date": stream_date or "",
                "duration": duration,
            }
            analyze_hot_points(
                job_id, hot_points, vod_meta,
                chat_messages=chat_messages,
                transcripts=triage_transcripts,
            )

        # 9. Done
        update_job(job_id, status="DONE", progress="Analysis complete!", error=None)

    except Exception as e:
        logger.error(f"Pipeline error for {job_id}: {e}", exc_info=True)
        update_job(job_id, status="ERROR", error=str(e), progress="An error occurred.")

    finally:
        # Cleanup temp audio files (but keep clips/)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)


def _reattach_clips(job_id: str, hot_points: list) -> None:
    """Re-attach clip filenames from disk to in-memory hot points."""
    clips_dir = os.path.join("clips", job_id)
    if not os.path.isdir(clips_dir):
        return

    for i, hp in enumerate(hot_points):
        if hp.clip_filename:
            continue
        fname = f"clip_{i+1:02d}.mp4"
        if os.path.isfile(os.path.join(clips_dir, fname)):
            hp.clip_filename = fname
