import re
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from app.models.schemas import AnalyzeRequest, JobResponse
from app.services.db import create_job, get_job, list_jobs
from app.services.pipeline import RESUMABLE_FROM, run_pipeline_sync

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
    import os
    filepath = os.path.join(CLIPS_DIR, job_id, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(filepath, media_type="video/mp4")
