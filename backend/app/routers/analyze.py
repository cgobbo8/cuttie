import logging
import os
import re
import subprocess
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models.schemas import AnalyzeRequest, JobResponse
from app.services.db import create_job, get_job, list_jobs
from app.services.pipeline import RESUMABLE_FROM, run_pipeline_sync

logger = logging.getLogger(__name__)

router = APIRouter()

TWITCH_VOD_PATTERN = re.compile(r"twitch\.tv/videos/(\d+)")
CLIPS_DIR = "clips"


@router.post("/analyze")
async def analyze_vod(req: AnalyzeRequest, bg: BackgroundTasks) -> dict:
    if not TWITCH_VOD_PATTERN.search(req.url):
        raise HTTPException(status_code=400, detail="URL must be a Twitch VOD (twitch.tv/videos/...)")

    job_id = uuid.uuid4().hex[:12]
    create_job(job_id, req.url)
    bg.add_task(run_pipeline_sync, job_id, req.url)
    return {"job_id": job_id}


@router.get("/jobs")
def get_all_jobs() -> list[dict]:
    return list_jobs()


@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> JobResponse:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str, bg: BackgroundTasks) -> dict:
    """Retry a failed job from the last failed step."""
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status.value != "ERROR":
        raise HTTPException(status_code=400, detail="Job is not in ERROR state")

    # Determine resume point based on what data already exists
    has_clips = any(hp.clip_filename for hp in (job.hot_points or []))
    has_llm = any(hp.llm and hp.llm.category for hp in (job.hot_points or []))

    if has_llm:
        resume_from = "LLM_ANALYSIS"
    elif has_clips:
        resume_from = "TRANSCRIBING"
    elif job.hot_points:
        resume_from = "CLIPPING"
    else:
        resume_from = None  # Full restart

    # Get original URL from DB
    from app.services.db import _get_conn
    conn = _get_conn()
    row = conn.execute("SELECT url FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    conn.close()
    url = row["url"]

    bg.add_task(run_pipeline_sync, job_id, url, resume_from)
    return {"job_id": job_id, "resume_from": resume_from}


@router.get("/clips/{job_id}/{filename}")
def get_clip(job_id: str, filename: str) -> FileResponse:
    filepath = os.path.join(CLIPS_DIR, job_id, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(filepath, media_type="video/mp4")


class TrimRequest(BaseModel):
    start_seconds: float
    end_seconds: float


@router.post("/clips/{job_id}/{filename}/trim")
def trim_clip(job_id: str, filename: str, req: TrimRequest) -> dict:
    """Trim a clip using FFmpeg stream copy (instant, no re-encode)."""
    input_path = os.path.join(CLIPS_DIR, job_id, filename)
    if not os.path.isfile(input_path):
        raise HTTPException(status_code=404, detail="Clip not found")

    if req.start_seconds >= req.end_seconds:
        raise HTTPException(status_code=400, detail="start must be < end")

    # Output: same name with _trimmed suffix
    base, ext = os.path.splitext(filename)
    trimmed_name = f"{base}_trimmed{ext}"
    output_path = os.path.join(CLIPS_DIR, job_id, trimmed_name)

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(req.start_seconds),
                "-i", input_path,
                "-to", str(req.end_seconds - req.start_seconds),
                "-c", "copy",
                "-movflags", "+faststart",
                output_path,
            ],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            logger.error(f"Trim failed: {result.stderr[-300:]}")
            raise HTTPException(status_code=500, detail="FFmpeg trim failed")

        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        logger.info(f"Trimmed {filename}: {req.start_seconds:.2f}s-{req.end_seconds:.2f}s -> {trimmed_name} ({size_mb:.1f}MB)")
        return {"filename": trimmed_name}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Trim timed out")
