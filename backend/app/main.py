"""Cuttie worker — local HTTP server driven by the API.

The API enqueues jobs here; a single background thread runs them one at a time
and reports progress back to the API (see services/api_events). The editor's
on-demand helpers (lazy transcription, facecam detection) are served here too,
so the models stay loaded between calls.

Every endpoint except /health requires the shared X-Cuttie-Secret header.
"""

import hmac
import logging
import os
import platform
import re
import shutil
import subprocess
import threading
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

load_dotenv()

from app.services import job_control, paths, settings  # noqa: E402
from app.services.db import _get_conn, get_job, init_db, update_job  # noqa: E402
from app.services.provider_errors import ProviderUnavailable  # noqa: E402

logger = logging.getLogger("worker")


def require_secret(x_cuttie_secret: str = Header(default="")) -> None:
    expected = os.getenv("CUTTIE_INTERNAL_SECRET", "")
    if not expected or not hmac.compare_digest(x_cuttie_secret, expected):
        raise HTTPException(status_code=401, detail="invalid secret")


_JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _check_job_id(job_id: str) -> str:
    if not _JOB_ID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="invalid job id")
    return job_id


class JobRequest(BaseModel):
    job_id: str
    type: str = "analyze"  # "analyze" | "add_clip"
    url: str | None = None
    clip_filename: str | None = None
    clip_name: str | None = None
    rank: int | None = None


class FacecamRequest(BaseModel):
    clip_filenames: list[str]


class VodFacecamRequest(BaseModel):
    vod_id: str
    duration: float


class PaletteRequest(BaseModel):
    # Logo first, then banner; only https images
    urls: list[str]


# ── Job queue ────────────────────────────────────────────────────────────────

class JobQueue:
    """FIFO of pending jobs, consumed by a single runner thread."""

    def __init__(self) -> None:
        self._items: deque[JobRequest] = deque()
        self._cv = threading.Condition()
        self.current: JobRequest | None = None

    def put(self, req: JobRequest) -> int:
        with self._cv:
            self._items.append(req)
            self._cv.notify()
            return len(self._items)

    def remove(self, job_id: str) -> bool:
        with self._cv:
            kept = [r for r in self._items if r.job_id != job_id]
            removed = len(kept) != len(self._items)
            self._items = deque(kept)
            return removed

    def flush(self) -> int:
        with self._cv:
            n = len(self._items)
            self._items.clear()
            return n

    def snapshot(self) -> dict:
        with self._cv:
            return {
                "current": self.current.model_dump() if self.current else None,
                "items": [r.model_dump() for r in self._items],
            }

    def run_forever(self) -> None:
        while True:
            with self._cv:
                while not self._items:
                    self._cv.wait()
                req = self._items.popleft()
                self.current = req
            try:
                _run(req)
            except Exception:
                logger.exception("Job %s crashed", req.job_id)
            finally:
                job_control.clear(req.job_id)
                with self._cv:
                    self.current = None


jobs = JobQueue()


def _missing_keys() -> list[str]:
    missing = []
    if not settings.get("groq_api_key", "GROQ_API_KEY"):
        missing.append("Groq")
    if not settings.get("openrouter_api_key", "OPENROUTER_API_KEY"):
        missing.append("OpenRouter")
    return missing


def _run(req: JobRequest) -> None:
    if req.type == "add_clip":
        from app.services.import_pipeline import run_add_clip_pipeline

        logger.info("Adding clip %s to job %s", req.clip_filename, req.job_id)
        run_add_clip_pipeline(req.job_id, req.clip_filename or "", req.clip_name or "Imported clip", req.rank or 99)
        return

    from app.services.pipeline import run_pipeline_sync

    if not get_job(req.job_id):
        conn = _get_conn()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO jobs (job_id, url, status, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?)",
            (req.job_id, req.url, now, now),
        )
        conn.commit()
        conn.close()

    missing = _missing_keys()
    if missing:
        update_job(
            req.job_id, status="ERROR", progress="Clés API manquantes.",
            error=f"Clé(s) API manquante(s) : {', '.join(missing)}. Ajoute-les dans Paramètres.",
        )
        return

    logger.info("Starting pipeline for job %s (url=%s)", req.job_id, req.url)
    update_job(req.job_id, status="PENDING", progress="Démarrage...")
    run_pipeline_sync(req.job_id, req.url or "")


def _cleanup_work_dir() -> None:
    """Remove temp data left by a previous run (crash, killed worker)."""
    if not os.path.isdir(paths.WORK_DIR):
        return
    for entry in os.listdir(paths.WORK_DIR):
        shutil.rmtree(os.path.join(paths.WORK_DIR, entry), ignore_errors=True)


# ── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    _cleanup_work_dir()
    paths.ensure_dirs()
    threading.Thread(target=jobs.run_forever, name="job-runner", daemon=True).start()
    logger.info("Worker ready — data dir: %s", paths.DATA_DIR)
    yield


app = FastAPI(title="Cuttie worker", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/jobs", status_code=202, dependencies=[Depends(require_secret)])
def enqueue_job(req: JobRequest) -> dict:
    _check_job_id(req.job_id)
    if req.type == "analyze" and not req.url:
        raise HTTPException(status_code=422, detail="url is required")
    if req.type == "add_clip" and not req.clip_filename:
        raise HTTPException(status_code=422, detail="clip_filename is required")
    position = jobs.put(req)
    return {"queued": position}


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(require_secret)])
def cancel_job(job_id: str) -> dict:
    removed = jobs.remove(job_id)
    running = jobs.current is not None and jobs.current.job_id == job_id
    if running:
        job_control.request_cancel(job_id)
    return {"removed_from_queue": removed, "running": running}


@app.get("/queue", dependencies=[Depends(require_secret)])
def get_queue() -> dict:
    return jobs.snapshot()


@app.post("/queue/flush", dependencies=[Depends(require_secret)])
def flush_queue() -> dict:
    flushed = jobs.flush()
    current = jobs.current
    if current:
        job_control.request_cancel(current.job_id)
    return {"flushed": flushed, "cancelled_current": current.job_id if current else None}


@app.post("/clips/{job_id}/{clip_filename}/words", dependencies=[Depends(require_secret)])
def clip_words(job_id: str, clip_filename: str) -> list[dict]:
    from app.services.clip_tools import transcribe_clip_words

    try:
        return transcribe_clip_words(_check_job_id(job_id), os.path.basename(clip_filename))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="clip not found")
    except ProviderUnavailable as e:
        raise HTTPException(status_code=402 if e.reason == "credits" else 401, detail=str(e)) from e


@app.post("/jobs/{job_id}/facecam", dependencies=[Depends(require_secret)])
def facecam(job_id: str, req: FacecamRequest) -> dict:
    from app.services.clip_tools import detect_job_facecam

    return {"facecam": detect_job_facecam(_check_job_id(job_id), req.clip_filenames)}


@app.post("/facecam/vod", dependencies=[Depends(require_secret)])
def vod_facecam(req: VodFacecamRequest) -> dict:
    """Webcam on a Twitch VOD, before any analysis (first launch)."""
    from app.services.clip_tools import detect_vod_facecam

    if not req.vod_id.isdigit() or req.duration <= 0:
        raise HTTPException(status_code=400, detail="invalid vod")
    try:
        return detect_vod_facecam(req.vod_id, req.duration)
    except Exception as e:
        logger.warning(f"Webcam detection on VOD {req.vod_id} failed: {e}")
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/palette", dependencies=[Depends(require_secret)])
def palette(req: PaletteRequest) -> dict:
    from app.services.palette import extract_palette

    urls = [u for u in req.urls[:3] if u.startswith("https://")]
    if not urls:
        raise HTTPException(status_code=400, detail="no image url")
    return extract_palette(urls)


def _first_line(cmd: list[str]) -> str | None:
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        return (out.stdout or out.stderr).strip().splitlines()[0]
    except Exception:
        return None


@app.get("/diagnostics", dependencies=[Depends(require_secret)])
def diagnostics() -> dict:
    info: dict = {
        "python": platform.python_version(),
        "platform": platform.platform(),
        "data_dir": paths.DATA_DIR,
        "ffmpeg": (_first_line(["ffmpeg", "-version"]) or "").split(" Copyright")[0] or None,
        "yt_dlp": _first_line(["yt-dlp", "--version"]),
        "keys": {
            "groq": bool(settings.get("groq_api_key", "GROQ_API_KEY")),
            "openrouter": bool(settings.get("openrouter_api_key", "OPENROUTER_API_KEY")),
        },
        "disk_free_gb": round(shutil.disk_usage(paths.DATA_DIR).free / 1e9, 1),
        "busy": jobs.current.job_id if jobs.current else None,
    }
    # One token to OpenRouter: "credits" (none left) or "key" (refused) stop every analysis
    if info["keys"]["openrouter"]:
        from app.services.provider_errors import check_openrouter, openrouter_credit

        info["openrouter"] = check_openrouter() or "ok"
        # Dollars left on the key, when it has a spending limit
        info["openrouter_credit"] = openrouter_credit()
    try:
        from app.services import transcriber

        model_dir = transcriber.local_model_dir()
        info["transcription"] = {
            "engine": transcriber.chosen_engine(),
            # This computer: fast on an Apple chip ("mlx") or an NVIDIA GPU ("cuda"), slow on the CPU
            "local_device": transcriber.local_backend(),
            "local_model_ready": os.path.isdir(model_dir) and any(os.scandir(model_dir)),
        }
    except Exception as e:
        info["transcription"] = {"error": str(e)}
    try:
        import torch

        from app.services.device import get_device

        device = get_device()
        info["torch"] = torch.__version__
        info["device"] = device.type
        if device.type == "cuda":
            info["gpu"] = torch.cuda.get_device_name(0)
        elif device.type == "mps":
            info["gpu"] = "Apple Silicon (MPS)"
    except Exception as e:
        info["device"] = "error"
        info["device_error"] = str(e)
    return info
