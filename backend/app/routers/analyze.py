import re
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from app.models.schemas import AnalyzeRequest, JobResponse
from app.services.db import create_job, get_job, list_jobs
from app.services.pipeline import run_pipeline_sync

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
async def get_all_jobs() -> list[dict]:
    return list_jobs()


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> JobResponse:
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/clips/{job_id}/{filename}")
async def get_clip(job_id: str, filename: str) -> FileResponse:
    import os
    filepath = os.path.join(CLIPS_DIR, job_id, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(filepath, media_type="video/mp4")
