import logging
import os
import pathlib
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

# Path-traversal guards: only allow alphanumeric, hyphen, underscore (and dots
# for filenames). These patterns deliberately reject path separators and other
# special characters that could be used to escape the clips directory.
SAFE_JOB_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
SAFE_FILENAME = re.compile(r"^[a-zA-Z0-9_.\-]+$")


def _resolve_clip_path(job_id: str, filename: str) -> pathlib.Path:
    """Return an absolute, resolved path and assert it stays inside CLIPS_DIR.

    Raises HTTPException 400 on invalid identifiers and 404 if the final path
    escapes the clips root (directory traversal attempt).
    """
    if not SAFE_JOB_ID.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID")
    if not SAFE_FILENAME.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    clips_root = pathlib.Path(CLIPS_DIR).resolve()
    target = (clips_root / job_id / filename).resolve()
    if not str(target).startswith(str(clips_root) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    return target


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
    if not SAFE_JOB_ID.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID")
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/jobs/{job_id}/retry")
async def retry_job(job_id: str, bg: BackgroundTasks) -> dict:
    """Retry a failed job from the last failed step."""
    if not SAFE_JOB_ID.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID")
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
        resume_from = "CLIPPING"
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
    filepath = _resolve_clip_path(job_id, filename)
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")
    return FileResponse(str(filepath), media_type="video/mp4")


@router.get("/clips/{job_id}/{filename}/words")
def get_clip_words(job_id: str, filename: str) -> JSONResponse:
    """Return word-level timestamps for a clip's transcript."""
    # Validate identifiers; the words file is derived from filename so the
    # same path-traversal guard applies.
    _resolve_clip_path(job_id, filename)  # raises on invalid identifiers
    base, _ = os.path.splitext(filename)
    words_filename = f"{base}_words.json"
    if not SAFE_FILENAME.match(words_filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    clips_root = pathlib.Path(CLIPS_DIR).resolve()
    words_path = (clips_root / job_id / words_filename).resolve()
    if not str(words_path).startswith(str(clips_root) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not words_path.is_file():
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

    clip_path_obj = _resolve_clip_path(job_id, clip_filename)
    clip_path = str(clip_path_obj)
    if not clip_path_obj.is_file():
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
        except Exception as e:
            logger.warning("Facecam detection failed for %s: %s", job_id, e, exc_info=True)

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

    # Words — try cached file, else transcribe on the fly
    base, _ = os.path.splitext(clip_filename)
    words_path = os.path.join(CLIPS_DIR, job_id, f"{base}_words.json")
    words = []
    if os.path.isfile(words_path):
        with open(words_path, encoding="utf-8") as f:
            words = json.load(f)
    elif os.path.isfile(clip_path):
        # Lazy transcription: generate words on first access
        try:
            from app.services.subtitle_generator import transcribe_with_words
            logger.info(f"Transcribing {clip_filename} for word timestamps (lazy)...")
            _, _, words = transcribe_with_words(clip_path)
            if words:
                with open(words_path, "w", encoding="utf-8") as f:
                    json.dump(words, f, ensure_ascii=False)
                logger.info(f"Saved {len(words)} words to {words_path}")
        except Exception as e:
            logger.warning(f"Lazy transcription failed: {e}")

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
        except Exception as e:
            logger.debug("Dominant color extraction skipped for %s: %s", clip_filename, e)

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
    input_path_obj = _resolve_clip_path(job_id, filename)
    input_path = str(input_path_obj)
    if not input_path_obj.is_file():
        raise HTTPException(status_code=404, detail="Clip not found")

    if req.start_seconds >= req.end_seconds:
        raise HTTPException(status_code=400, detail="start must be < end")

    # Output: same name with _trimmed suffix — resolve and contain within clips root
    base, ext = os.path.splitext(filename)
    trimmed_name = f"{base}_trimmed{ext}"
    clips_root = pathlib.Path(CLIPS_DIR).resolve()
    output_path_obj = (clips_root / job_id / trimmed_name).resolve()
    if not str(output_path_obj).startswith(str(clips_root) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    output_path = str(output_path_obj)

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


# ── Render status (renders are handled by AdonisJS / Remotion) ──

from app.services.db import get_render, list_renders


@router.get("/renders")
def list_all_renders() -> list[dict]:
    """List all renders."""
    renders = list_renders()
    for r in renders:
        if r.get("output_filename") and r.get("job_id"):
            r["url"] = f"/api/clips/{r['job_id']}/{r['output_filename']}"
    return renders


@router.get("/renders/{render_id}")
def get_render_status(render_id: str) -> dict:
    """Poll render progress."""
    r = get_render(render_id)
    if not r:
        raise HTTPException(status_code=404, detail="Render not found")
    if r.get("output_filename") and r.get("job_id"):
        r["url"] = f"/api/clips/{r['job_id']}/{r['output_filename']}"
    return r


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
    if not SAFE_FILENAME.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    assets_root = pathlib.Path(ASSETS_DIR).resolve()
    path = (assets_root / filename).resolve()
    if not str(path).startswith(str(assets_root) + os.sep):
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(str(path))
