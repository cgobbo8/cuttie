"""Pipeline orchestrator — runs the full analysis in a background thread."""

import logging
import os
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.services.audio_analyzer import analyze_audio
from app.services.audio_classifier import classify_audio
from app.services.chat_analyzer import analyze_chat
from app.services.clipper import CLIPS_DIR, extract_group, plan_downloads
from app.services.db import get_job, save_hot_points, update_hot_point_clip, update_job
from app.services.downloader import download_audio, download_chat
from app.services.llm_analyzer import analyze_hot_points, analyze_single_clip
from app.services.scorer import compute_scores
from app.services.triage import run_triage
logger = logging.getLogger(__name__)

# Steps that can be resumed from (in order)
RESUMABLE_FROM = {
    "CLIPPING",
    "TRANSCRIBING",
    "LLM_ANALYSIS",
}


def _run_clipping_and_analysis(
    job_id: str,
    url: str,
    hot_points: list,
    vod_duration: float,
    vod_meta: dict,
    audio_features: list[dict] | None = None,
    chat_messages: list[dict] | None = None,
    triage_transcripts: dict[int, tuple[str, float]] | None = None,
) -> None:
    """Pipeline: batch-download clips and analyze with LLM concurrently.

    Groups nearby clips to reduce yt-dlp calls (batch download), and starts
    LLM analysis on each clip as soon as it's downloaded — overlapping network
    I/O (clip downloads) with API I/O (LLM calls).
    """
    clip_dir = os.path.join(CLIPS_DIR, job_id)
    os.makedirs(clip_dir, exist_ok=True)

    groups = plan_downloads(hot_points, vod_duration, audio_features)
    total_clips = sum(len(g["clips"]) for g in groups)

    DL_WORKERS = 5
    LLM_WORKERS = 3

    update_job(job_id, status="CLIPPING", progress=f"Extraction clips (0/{total_clips})...")

    with ThreadPoolExecutor(max_workers=DL_WORKERS) as dl_pool, \
         ThreadPoolExecutor(max_workers=LLM_WORKERS) as llm_pool:

        # Submit all group downloads in parallel
        dl_futures = {
            dl_pool.submit(extract_group, url, group, clip_dir): group
            for group in groups
        }

        # As groups complete, attach filenames and submit LLM analysis
        llm_futures: dict = {}
        done_dl = 0

        for future in as_completed(dl_futures):
            try:
                clip_results = future.result()
                for rank, idx, filename in clip_results:
                    done_dl += 1
                    hp = hot_points[idx]
                    if filename:
                        hp.clip_filename = filename
                        update_hot_point_clip(job_id, rank, filename)

                        pre = triage_transcripts.get(idx) if triage_transcripts else None
                        af = llm_pool.submit(
                            analyze_single_clip, job_id, rank, hp, vod_meta,
                            chat_messages=chat_messages, pre_transcript=pre,
                        )
                        llm_futures[af] = (idx, hp)

                    update_job(
                        job_id,
                        progress=f"Extraction clips ({done_dl}/{total_clips})...",
                    )
            except Exception as e:
                logger.error(f"Group extraction error: {e}")

        # All downloads done — wait for remaining LLM analyses
        update_job(job_id, status="LLM_ANALYSIS", progress="Analyse IA des clips...")
        done_llm = 0
        total_llm = len(llm_futures)

        for future in as_completed(llm_futures):
            idx, hp = llm_futures[future]
            done_llm += 1
            try:
                future.result()
                logger.info(f"Analysis {done_llm}/{total_llm}: {hp.timestamp_display}")
            except Exception as e:
                logger.error(f"Analysis failed for {hp.timestamp_display}: {e}")
            update_job(
                job_id,
                progress=f"Analyse IA : {done_llm}/{total_llm} clips ({hp.timestamp_display})",
            )

    # Re-sort by final_score and persist
    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )
    save_hot_points(job_id, hot_points)

    extracted = sum(1 for hp in hot_points if hp.clip_filename)
    logger.info(f"Clipping + analysis complete: {extracted} clips, {done_llm} analyzed")


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
        audio_features: list[dict] = []
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

            # 3. Analyze audio signals + classify audio events in parallel
            update_job(job_id, status="ANALYZING_AUDIO", progress="Analyzing audio signals + classification...")
            with ThreadPoolExecutor(max_workers=2) as audio_pool:
                features_future = audio_pool.submit(analyze_audio, audio_path)
                classify_future = audio_pool.submit(classify_audio, audio_path)
                audio_features = features_future.result()
                classification_features = classify_future.result()

            # 4. Analyze chat
            update_job(job_id, status="ANALYZING_CHAT", progress="Analyzing chat activity...")
            chat_features = analyze_chat(chat_messages, duration)

            # 5. Score and find peaks — get top 50 candidates for triage
            update_job(job_id, status="SCORING", progress="Computing scores and finding hot points...")
            hot_points = compute_scores(
                audio_features, chat_features,
                total_duration=duration, top_n=50,
                classification_features=classification_features,
            )

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

        # Steps 8+9: Clipping + LLM Analysis (pipelined — download & analyze concurrently)
        vod_meta = {
            "title": vod_title or "",
            "game": vod_game or "",
            "streamer": streamer or "",
            "view_count": view_count or 0,
            "stream_date": stream_date or "",
            "duration": duration,
        }

        if not resume_from or resume_from == "CLIPPING":
            if hot_points is None:
                raise RuntimeError("No hot points available for clipping")
            _run_clipping_and_analysis(
                job_id, url, hot_points, duration, vod_meta,
                audio_features=audio_features,
                chat_messages=chat_messages,
                triage_transcripts=triage_transcripts,
            )
        elif resume_from in ("TRANSCRIBING", "LLM_ANALYSIS"):
            update_job(job_id, status="LLM_ANALYSIS", progress="Analyse IA des clips (vision + synthese)...", error=None)
            if hot_points is None:
                raise RuntimeError("No hot points available for analysis")
            _reattach_clips(job_id, hot_points)
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
