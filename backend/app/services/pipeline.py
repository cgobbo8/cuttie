"""Pipeline orchestrator — runs the full analysis in a background thread."""

import os
import shutil

from app.services.audio_analyzer import analyze_audio
from app.services.chat_analyzer import analyze_chat
from app.services.clipper import extract_clips
from app.services.db import update_job
from app.services.downloader import download_audio, download_chat
from app.services.llm_analyzer import analyze_hot_points
from app.services.scorer import compute_scores


def run_pipeline_sync(job_id: str, url: str) -> None:
    """Synchronous pipeline — FastAPI runs this in a threadpool automatically."""
    output_dir = os.path.join("data", job_id)

    try:
        # 1. Download audio
        update_job(job_id, status="DOWNLOADING_AUDIO", progress="Downloading audio from VOD...")
        audio_path, metadata = download_audio(url, output_dir)
        duration = metadata.get("duration", 0)
        update_job(
            job_id,
            vod_title=metadata.get("title"),
            vod_duration_seconds=duration,
        )

        # 2. Download chat
        update_job(job_id, status="DOWNLOADING_CHAT", progress="Downloading chat messages...")
        messages = download_chat(url)

        # 3. Analyze audio
        update_job(job_id, status="ANALYZING_AUDIO", progress="Analyzing audio signals...")
        audio_features = analyze_audio(audio_path)

        # 4. Analyze chat
        update_job(job_id, status="ANALYZING_CHAT", progress="Analyzing chat activity...")
        chat_features = analyze_chat(messages, duration)

        # 5. Score and find peaks
        update_job(job_id, status="SCORING", progress="Computing scores and finding hot points...")
        hot_points = compute_scores(audio_features, chat_features, total_duration=duration)

        # 6. Save hot points to DB
        update_job(job_id, hot_points=hot_points)

        # 7. Extract 1-min video clips around each hot point
        update_job(job_id, status="CLIPPING", progress="Downloading video clips...")
        extract_clips(job_id, url, hot_points, duration)

        # 8. Whisper transcription + LLM analysis
        update_job(job_id, status="TRANSCRIBING", progress="Transcription et analyse LLM des clips...")
        vod_title = metadata.get("title", "")
        analyze_hot_points(job_id, hot_points, vod_title)

        # 9. Done
        update_job(job_id, status="DONE", progress="Analysis complete!")

    except Exception as e:
        update_job(job_id, status="ERROR", error=str(e), progress="An error occurred.")

    finally:
        # Cleanup temp audio files (but keep clips/)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)
