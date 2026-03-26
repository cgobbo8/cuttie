import logging
import os
import re
import subprocess
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
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


@router.get("/clips/{job_id}/{filename}/words")
def get_clip_words(job_id: str, filename: str) -> JSONResponse:
    """Return word-level timestamps for a clip's transcript."""
    base, _ = os.path.splitext(filename)
    words_path = os.path.join(CLIPS_DIR, job_id, f"{base}_words.json")
    if not os.path.isfile(words_path):
        return JSONResponse(content=[])
    import json
    with open(words_path, encoding="utf-8") as f:
        words = json.load(f)
    return JSONResponse(content=words)


@router.get("/clips/{job_id}/{clip_filename}/edit-env")
def get_edit_environment(job_id: str, clip_filename: str) -> JSONResponse:
    """Return all data needed to initialise the canvas editor for a clip.

    Returns: clip dimensions, facecam region, game crop, layout constants, words.
    """
    import json

    clip_path = os.path.join(CLIPS_DIR, job_id, clip_filename)
    if not os.path.isfile(clip_path):
        raise HTTPException(status_code=404, detail="Clip not found")

    # Probe clip dimensions
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", clip_path],
        capture_output=True, text=True, timeout=10,
    )
    streams = json.loads(probe.stdout)["streams"]
    video_stream = next(s for s in streams if s["codec_type"] == "video")
    input_w = int(video_stream["width"])
    input_h = int(video_stream["height"])

    # Facecam data — load persisted or detect on the fly
    facecam_path = os.path.join(CLIPS_DIR, job_id, "facecam.json")
    facecam = None
    if os.path.isfile(facecam_path):
        with open(facecam_path, encoding="utf-8") as f:
            facecam = json.load(f)
    else:
        # Try to detect and persist for future calls
        try:
            from app.services.facecam_detector import detect_facecam
            clip_dir = os.path.join(CLIPS_DIR, job_id)
            clips = sorted(
                [f for f in os.listdir(clip_dir) if f.startswith("clip_") and f.endswith(".mp4")],
            )
            if clips:
                clip_paths = [os.path.join(clip_dir, c) for c in clips[:5]]
                raw = detect_facecam(clip_paths[0], extra_clips=clip_paths[1:])
                if raw:
                    facecam = {k: int(v) for k, v in raw.items()}
                    with open(facecam_path, "w", encoding="utf-8") as f:
                        json.dump(facecam, f)
        except Exception:
            pass  # Non-critical — frontend has its own fallback

    # Compute game crop (same logic as _build_filtergraph)
    from app.services.vertical_clipper import (
        OUTPUT_WIDTH, OUTPUT_HEIGHT,
        GAME_HEIGHT_RATIO, GAME_MARGIN_BOTTOM,
        CAM_SIZE, CAM_MARGIN_TOP, CAM_BORDER_RADIUS, BLUR_SIGMA,
    )
    game_h = int(OUTPUT_HEIGHT * GAME_HEIGHT_RATIO)
    game_aspect = OUTPUT_WIDTH / game_h
    crop_h = input_h
    crop_w = int(crop_h * game_aspect)
    if crop_w > input_w:
        crop_w = input_w
        crop_h = int(crop_w / game_aspect)
    crop_x = (input_w - crop_w) // 2
    crop_y = (input_h - crop_h) // 2
    game_y = OUTPUT_HEIGHT - game_h - GAME_MARGIN_BOTTOM

    # Words
    base, _ = os.path.splitext(clip_filename)
    vertical_base = base.replace("clip_", "vertical_")
    words_path = os.path.join(CLIPS_DIR, job_id, f"{vertical_base}_words.json")
    words = []
    if os.path.isfile(words_path):
        with open(words_path, encoding="utf-8") as f:
            words = json.load(f)

    # Dominant color — load cached or extract on the fly
    dominant_color = None
    dominant_path = os.path.join(CLIPS_DIR, job_id, "dominant_color.json")
    if os.path.isfile(dominant_path):
        with open(dominant_path, encoding="utf-8") as f:
            dominant_color = json.load(f)
    else:
        try:
            from app.services.subtitle_generator import extract_dominant_color
            r, g, b = extract_dominant_color(clip_path)
            dominant_color = {"r": r, "g": g, "b": b}
            with open(dominant_path, "w", encoding="utf-8") as f:
                json.dump(dominant_color, f)
        except Exception:
            pass

    return JSONResponse(content={
        "clip_width": input_w,
        "clip_height": input_h,
        "facecam": facecam,
        "dominant_color": dominant_color,
        "game_crop": {"x": crop_x, "y": crop_y, "w": crop_w, "h": crop_h},
        "layout": {
            "canvas_w": OUTPUT_WIDTH,
            "canvas_h": OUTPUT_HEIGHT,
            "game_h": game_h,
            "game_y": game_y,
            "cam_size": CAM_SIZE,
            "cam_margin_top": CAM_MARGIN_TOP,
            "cam_border_radius": CAM_BORDER_RADIUS,
            "blur_sigma": BLUR_SIGMA,
            "game_margin_bottom": GAME_MARGIN_BOTTOM,
        },
        "words": words,
    })


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


# ── Assets ──────────────────────────────────────────────────

ASSETS_DIR = os.path.join(CLIPS_DIR, "_assets")


@router.post("/assets/upload")
async def upload_asset(file: UploadFile) -> dict:
    """Upload an image asset. Returns its id and URL."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files accepted")

    os.makedirs(ASSETS_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename or "img.png")[1] or ".png"
    asset_id = uuid.uuid4().hex[:12]
    filename = f"{asset_id}{ext}"
    path = os.path.join(ASSETS_DIR, filename)

    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)

    logger.info(f"Asset uploaded: {filename} ({len(content) / 1024:.0f}KB)")
    return {"id": asset_id, "filename": filename, "url": f"/api/assets/{filename}"}


@router.get("/assets")
def list_assets() -> JSONResponse:
    """List all uploaded assets."""
    if not os.path.isdir(ASSETS_DIR):
        return JSONResponse(content=[])
    files = sorted(os.listdir(ASSETS_DIR))
    assets = [
        {"filename": f, "url": f"/api/assets/{f}"}
        for f in files
        if not f.startswith(".")
    ]
    return JSONResponse(content=assets)


@router.get("/assets/{filename}")
def get_asset(filename: str) -> FileResponse:
    """Serve an uploaded asset."""
    path = os.path.join(ASSETS_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(path)
