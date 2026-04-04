"""Pipeline orchestrator — runs the full 6-step analysis in a background thread."""

import json
import logging
import os
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint, StepTiming
from app.services.audio_analyzer import analyze_audio
from app.services.audio_classifier import classify_audio
from app.services.chat_analyzer import analyze_chat
from app.services.clipper import CLIPS_DIR, extract_group, plan_downloads, plan_downloads_detected
from app.services.db import get_job, save_hot_points, update_hot_point_clip, update_job
from app.services.downloader import extract_metadata, download_audio, download_chat
from app.services.llm_analyzer import analyze_candidates, analyze_hot_points, analyze_single_clip
from app.services.scorer import compute_scores

logger = logging.getLogger(__name__)


class JobCancelled(Exception):
    """Raised when a job is cancelled via the admin UI."""
    pass


def check_cancelled(job_id: str) -> None:
    """Check Redis for cancellation flag and raise if set."""
    try:
        import redis as _redis
        r = _redis.Redis(
            host=os.getenv("REDIS_HOST", "127.0.0.1"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            password=os.getenv("REDIS_PASSWORD") or None,
        )
        if r.exists(f"cuttie:cancel:{job_id}"):
            r.delete(f"cuttie:cancel:{job_id}")
            raise JobCancelled(f"Job {job_id} cancelled by user")
    except JobCancelled:
        raise
    except Exception:
        pass  # Redis not available — don't block pipeline


class StepTimer:
    """Tracks per-step wall-clock timings throughout the pipeline."""

    def __init__(self) -> None:
        self._timings: dict[str, StepTiming] = {}
        self._current: str | None = None

    def start(self, step: str) -> None:
        """Finalize previous step and start timing the new one."""
        if self._current and self._current in self._timings:
            prev = self._timings[self._current]
            if prev.duration_seconds is None:
                prev.duration_seconds = round(time.time() - prev.start, 1)
        self._current = step
        self._timings[step] = StepTiming(start=round(time.time(), 3))

    def finish(self) -> None:
        """Finalize the current step (called at DONE)."""
        if self._current and self._current in self._timings:
            prev = self._timings[self._current]
            if prev.duration_seconds is None:
                prev.duration_seconds = round(time.time() - prev.start, 1)

    @property
    def timings(self) -> dict[str, StepTiming]:
        return self._timings

# Steps that can be resumed from (in order)
RESUMABLE_FROM = {
    "CLIPPING",
    "LLM_ANALYSIS",
}


def _run_clipping_only(
    job_id: str,
    url: str,
    hot_points: list,
    vod_duration: float,
    vod_meta: dict,
    audio_features: list[dict] | None = None,
    chat_messages: list[dict] | None = None,
    timer: "StepTimer | None" = None,
    detected_bounds: bool = False,
) -> None:
    """Download and compress clips for already-analyzed hot points.

    LLM analysis is already done at this point — this step only downloads video,
    compresses clips, renames them to LLM-generated names, and uploads to S3.

    If detected_bounds=True, use fixed -2min/+5s bounds for "clip" keyword detections.
    """
    from app.services.db import publish_clip_ready, rename_clip_files, slugify_clip_name
    from app.services.s3_storage import rename_object

    clip_dir = os.path.join(CLIPS_DIR, job_id)
    os.makedirs(clip_dir, exist_ok=True)

    # Persist chat messages for editor chat layer
    if chat_messages:
        chat_path = os.path.join(clip_dir, "chat.json")
        if not os.path.isfile(chat_path):
            with open(chat_path, "w", encoding="utf-8") as f:
                json.dump(chat_messages, f, ensure_ascii=False)

    if detected_bounds:
        groups, shared_clips = plan_downloads_detected(hot_points, vod_duration)
    else:
        groups, shared_clips = plan_downloads(hot_points, vod_duration, audio_features)
    total_clips = sum(len(g["clips"]) for g in groups)

    DL_WORKERS = 5

    if detected_bounds:
        update_job(
            job_id, status="CLIPPING",
            progress=f"Extraction de {total_clips} clips détectés...",
            step_timings=timer.timings if timer else None,
        )
    else:
        update_job(
            job_id, status="CLIPPING",
            progress=f"Extraction clips (0/{total_clips})...",
            step_timings=timer.timings if timer else None,
        )

    with ThreadPoolExecutor(max_workers=DL_WORKERS) as dl_pool:
        dl_futures = {
            dl_pool.submit(extract_group, url, group, clip_dir, job_id): group
            for group in groups
        }

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

                        # Rename to LLM-generated name if available
                        if hp.clip_name:
                            new_filename = slugify_clip_name(hp.clip_name)
                            old_filename = filename
                            try:
                                rename_object(
                                    f"clips/{job_id}/{old_filename}",
                                    f"clips/{job_id}/{new_filename}",
                                )
                                rename_clip_files(job_id, old_filename, new_filename)
                                update_hot_point_clip(job_id, rank, new_filename)
                                hp.clip_filename = new_filename
                                logger.info(f"Clip {rank}: renamed {old_filename} → {new_filename}")
                            except Exception as e:
                                logger.warning(f"Clip {rank}: rename failed: {e}")

                        # Publish clip ready for frontend
                        publish_clip_ready(job_id, rank, hp)
                    else:
                        logger.warning(
                            f"Clip {rank} ({hp.timestamp_display}) extraction failed — skipping"
                        )

                    update_job(
                        job_id,
                        progress=(
                            f"Extraction clips détectés..."
                            if detected_bounds
                            else f"Extraction clips ({done_dl}/{total_clips})..."
                        ),
                    )
            except Exception as e:
                logger.error(f"Group extraction error: {e}")

        # Propagate clip filenames to hot points that share a segment
        for rank, sibling_indices in shared_clips.items():
            primary = hot_points[sibling_indices[0]]
            if primary.clip_filename:
                for idx in sibling_indices[1:]:
                    hot_points[idx].clip_filename = primary.clip_filename

    # Remove hot points that failed extraction
    failed = [hp for hp in hot_points if not hp.clip_filename]
    if failed:
        logger.warning(f"{len(failed)} clips failed extraction and were removed")
    hot_points[:] = [hp for hp in hot_points if hp.clip_filename]

    # Deduplicate hot points sharing the same clip file (keep best final_score)
    seen_files: dict[str, int] = {}
    dedup_indices: set[int] = set()
    for i, hp in enumerate(hot_points):
        if hp.clip_filename in seen_files:
            prev_i = seen_files[hp.clip_filename]
            prev_hp = hot_points[prev_i]
            prev_score = prev_hp.final_score if prev_hp.final_score is not None else -1
            cur_score = hp.final_score if hp.final_score is not None else -1
            if cur_score > prev_score:
                dedup_indices.add(prev_i)
                seen_files[hp.clip_filename] = i
                logger.info(
                    f"Dedup: keeping {hp.timestamp_display} ({cur_score:.0%}) "
                    f"over {prev_hp.timestamp_display} ({prev_score:.0%}) "
                    f"for {hp.clip_filename}"
                )
            else:
                dedup_indices.add(i)
                logger.info(
                    f"Dedup: keeping {prev_hp.timestamp_display} ({prev_score:.0%}) "
                    f"over {hp.timestamp_display} ({cur_score:.0%}) "
                    f"for {hp.clip_filename}"
                )
        else:
            seen_files[hp.clip_filename] = i

    if dedup_indices:
        logger.info(f"Deduplicated {len(dedup_indices)} hot points sharing clip files")
        hot_points[:] = [hp for i, hp in enumerate(hot_points) if i not in dedup_indices]

    # Re-sort by final_score and persist (skip for detected — merged later)
    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )
    if not detected_bounds:
        save_hot_points(job_id, hot_points)

    logger.info(f"Clipping complete: {len(hot_points)} clips downloaded")


def run_pipeline_sync(job_id: str, url: str, resume_from: str | None = None) -> None:
    """Synchronous pipeline — FastAPI runs this in a threadpool automatically.

    If resume_from is set, skip completed steps and resume from that point.
    """
    output_dir = os.path.join("data", job_id)
    timer = StepTimer()

    try:
        job = get_job(job_id) if resume_from else None
        hot_points = list(job.hot_points) if job and job.hot_points else None
        duration = job.vod_duration_seconds if job else 0
        vod_title = job.vod_title if job else ""
        vod_game = job.vod_game if job else ""
        streamer = job.streamer if job else ""
        view_count = job.view_count if job else 0
        stream_date = job.stream_date if job else ""
        step_timings_restore = job.step_timings if job else None

        chat_messages: list[dict] = []
        audio_path: str | None = None
        audio_features: list[dict] = []
        detected_hot_points: list[HotPoint] = []

        # Steps 1-6: Download + Analysis + LLM Scoring (skip if resuming from later step)
        if not resume_from or resume_from in (
            "DOWNLOADING_AUDIO", "DOWNLOADING_CHAT",
            "ANALYZING_AUDIO", "ANALYZING_CHAT",
            "SCORING", "ANALYZING_CLIPS",
        ):
            # 1 & 2. Extract metadata first (fast, ~2s), then download audio + chat in parallel
            timer.start("DOWNLOADING_AUDIO")
            update_job(job_id, status="DOWNLOADING_AUDIO", progress="Fetching VOD metadata...", step_timings=timer.timings)

            metadata = extract_metadata(url)
            duration = metadata.get("duration", 0)
            vod_title = metadata.get("title", "")
            vod_game = metadata.get("game", "")
            vod_game_id = metadata.get("game_id", "")
            vod_game_thumbnail = metadata.get("game_thumbnail", "")
            streamer = metadata.get("streamer", "")
            streamer_thumbnail = metadata.get("streamer_thumbnail", "")
            view_count = metadata.get("view_count", 0)
            stream_date = metadata.get("stream_date", "")
            update_job(
                job_id,
                vod_title=vod_title,
                vod_game=vod_game,
                vod_game_id=vod_game_id,
                vod_game_thumbnail=vod_game_thumbnail,
                vod_duration_seconds=duration,
                streamer=streamer,
                streamer_thumbnail=streamer_thumbnail,
                view_count=view_count,
                stream_date=stream_date,
            )
            logger.info(f"Metadata extracted: {streamer} — {vod_game} — {vod_title}")

            # Now download audio + chat in parallel (slow I/O bound)
            logger.info(f"[{job_id[:8]}] Starting audio + chat download...")
            update_job(job_id, progress="Downloading audio + chat...")
            with ThreadPoolExecutor(max_workers=2) as dl_pool:
                audio_future = dl_pool.submit(download_audio, url, output_dir)
                chat_future = dl_pool.submit(download_chat, url)

                audio_path = audio_future.result()
                chat_messages = chat_future.result()

            audio_size = os.path.getsize(audio_path) / (1024 * 1024) if os.path.isfile(audio_path) else 0
            logger.info(f"[{job_id[:8]}] Download complete: audio={audio_size:.0f}MB, chat={len(chat_messages)} messages")
            check_cancelled(job_id)

            # 3. Analyze audio signals + classify audio events in parallel
            timer.start("ANALYZING_AUDIO")
            logger.info(f"[{job_id[:8]}] Analyzing audio signals + classification...")
            update_job(job_id, status="ANALYZING_AUDIO", progress="Analyzing audio signals + classification...", step_timings=timer.timings)
            with ThreadPoolExecutor(max_workers=2) as audio_pool:
                features_future = audio_pool.submit(analyze_audio, audio_path)
                classify_future = audio_pool.submit(classify_audio, audio_path)
                audio_features = features_future.result()
                classification_features = classify_future.result()
            logger.info(f"[{job_id[:8]}] Audio analysis done: {len(audio_features)} windows")

            check_cancelled(job_id)

            # 4. Analyze chat
            timer.start("ANALYZING_CHAT")
            logger.info(f"[{job_id[:8]}] Analyzing chat ({len(chat_messages)} messages)...")
            update_job(job_id, status="ANALYZING_CHAT", progress="Analyzing chat activity...", step_timings=timer.timings)
            chat_features = analyze_chat(chat_messages, duration)
            logger.info(f"[{job_id[:8]}] Chat analysis done: {len(chat_features)} windows")

            check_cancelled(job_id)

            # 5. Score and find peaks — get top 50 candidates
            timer.start("SCORING")
            logger.info(f"[{job_id[:8]}] Computing scores...")
            update_job(job_id, status="SCORING", progress="Computing scores and finding hot points...", step_timings=timer.timings)
            hot_points = compute_scores(
                audio_features, chat_features,
                total_duration=duration, top_n=100,
                classification_features=classification_features,
            )
            logger.info(f"[{job_id[:8]}] Scoring done: {len(hot_points)} hot points")

            # Save initial hot points to DB
            update_job(job_id, hot_points=hot_points)

            check_cancelled(job_id)

            # 6. Unified LLM analysis: frames from VOD + Whisper + LLM → score & re-rank → top 20
            vod_meta = {
                "title": vod_title or "",
                "game": vod_game or "",
                "streamer": streamer or "",
                "view_count": view_count or 0,
                "stream_date": stream_date or "",
                "duration": duration,
            }
            timer.start("ANALYZING_CLIPS")
            logger.info(f"[{job_id[:8]}] Analyzing {len(hot_points)} candidates (frames + Whisper + LLM)...")
            update_job(
                job_id, status="ANALYZING_CLIPS",
                progress=f"Analyse IA de {len(hot_points)} candidats...",
                step_timings=timer.timings,
            )
            hot_points, detected_hot_points = analyze_candidates(
                job_id=job_id,
                hot_points=hot_points,
                audio_path=audio_path,
                vod_url=url,
                vod_duration=duration,
                vod_meta=vod_meta,
                chat_messages=chat_messages,
                keep_n=20,
            )

        # Step 7: Clipping — download video only for top 20
        vod_meta = {
            "title": vod_title or "",
            "game": vod_game or "",
            "streamer": streamer or "",
            "view_count": view_count or 0,
            "stream_date": stream_date or "",
            "duration": duration,
        }

        check_cancelled(job_id)

        if not resume_from or resume_from == "CLIPPING":
            if hot_points is None:
                raise RuntimeError("No hot points available for clipping")
            timer.start("CLIPPING")
            logger.info(f"[{job_id[:8]}] Clipping top {len(hot_points)} hot points...")
            update_job(job_id, status="CLIPPING", progress="Extraction des clips...", step_timings=timer.timings)

            _run_clipping_only(
                job_id, url, hot_points, duration, vod_meta,
                audio_features=audio_features,
                chat_messages=chat_messages,
                timer=timer,
            )

            # Clip detected "clip" moments with fixed bounds (-2min / +5s)
            if detected_hot_points:
                logger.info(
                    f"[{job_id[:8]}] Clipping {len(detected_hot_points)} detected 'clip' moments..."
                )
                update_job(job_id, progress=f"Extraction de {len(detected_hot_points)} clips détectés...")
                _run_clipping_only(
                    job_id, url, detected_hot_points, duration, vod_meta,
                    audio_features=None,  # No RMS segmentation — use fixed bounds
                    chat_messages=chat_messages,
                    timer=timer,
                    detected_bounds=True,
                )

        elif resume_from == "LLM_ANALYSIS":
            # Legacy resume: re-analyze already-clipped files
            timer.start("LLM_ANALYSIS")
            update_job(job_id, status="LLM_ANALYSIS", progress="Analyse IA des clips...", error=None, step_timings=timer.timings)
            if hot_points is None:
                raise RuntimeError("No hot points available for analysis")
            _reattach_clips(job_id, hot_points)
            analyze_hot_points(
                job_id, hot_points, vod_meta,
                chat_messages=chat_messages,
            )

        # Done — merge normal + detected hot points, finalize
        timer.finish()

        # hot_points already saved in DB by _run_clipping_only (normal clips)
        # detected_hot_points NOT saved yet — merge and save all together
        all_hot_points = list(hot_points) if hot_points else []
        if detected_hot_points:
            # Only keep detected clips that were successfully clipped
            clipped_detected = [hp for hp in detected_hot_points if hp.clip_filename]
            failed_detected = len(detected_hot_points) - len(clipped_detected)
            if failed_detected:
                logger.warning(f"[{job_id[:8]}] {failed_detected} detected clip(s) failed extraction")
            all_hot_points.extend(clipped_detected)
            logger.info(
                f"[{job_id[:8]}] Merged: {len(all_hot_points)} total hot points "
                f"({len(all_hot_points) - len(clipped_detected)} auto + "
                f"{len(clipped_detected)} detected)"
            )

        update_job(
            job_id,
            status="DONE",
            progress="Analysis complete!",
            error=None,
            vod_title=vod_title or "",
            hot_points=all_hot_points,
            step_timings=timer.timings,
        )
        logger.info(f"[{job_id[:8]}] Pipeline fully complete!")

    except JobCancelled:
        logger.info(f"Pipeline cancelled for {job_id}")
        timer.finish()
        update_job(job_id, status="ERROR", error="Cancelled by user", progress="Cancelled.", step_timings=timer.timings)

    except Exception as e:
        logger.error(f"Pipeline error for {job_id}: {e}", exc_info=True)
        timer.finish()
        update_job(job_id, status="ERROR", error=str(e), progress="An error occurred.", step_timings=timer.timings)

    finally:
        # Cleanup temp audio files (but keep clips/)
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)

        # Cleanup local clip MP4s (already uploaded to S3, keep JSON metadata)
        clip_dir = os.path.join("clips", job_id)
        if os.path.isdir(clip_dir):
            for f in os.listdir(clip_dir):
                if f.endswith(".mp4"):
                    try:
                        os.remove(os.path.join(clip_dir, f))
                    except OSError as e:
                        logger.debug("Failed to delete temp clip %s: %s", f, e)


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
