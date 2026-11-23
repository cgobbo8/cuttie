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


class ExtendRequest(BaseModel):
    url: str
    # The clip's new bounds in the live, seconds
    start: float
    end: float


class RestoreClip(BaseModel):
    filename: str
    # Where the clip sits in the live, seconds
    start: float
    end: float


class RestoreRequest(BaseModel):
    url: str
    clips: list[RestoreClip]


class SearchRequest(BaseModel):
    query: str
    # "words": said or written in the chat (free); "ai": the AI reads the whole live
    mode: str = "words"
    duration: float = 0.0
    # Voice energy across the live (the analysis' timeline), for the AI
    energy: list[float] | None = None
    # streamer, game, title
    meta: dict = {}
    # The live on Twitch: the AI listens to it (nothing to listen to once Twitch dropped it)
    url: str | None = None
    # Every candidate the analysis rated (the job's timeline): {"t", "state", "score", "name", "category", "what"}
    moments: list[dict] = []
    # Asked again on purpose: the AI searches anew instead of giving the answer it kept
    fresh: bool = False


# Longest description of a video (a real one came to 1300 characters)
MAX_BRIEF = 4000


class OtherLive(BaseModel):
    """One more live a video is made from, besides the one the request is about."""

    job_id: str
    duration: float = 0.0
    url: str | None = None
    moments: list[dict] = []
    # When it was streamed
    date: str | None = None


# Lives a video can be made from at once, the first one included
MAX_LIVES = 5


class PlanRequest(BaseModel):
    # The video the streamer describes
    brief: str
    # Its length, seconds
    target: float = 90.0
    duration: float = 0.0
    energy: list[float] | None = None
    meta: dict = {}
    url: str | None = None
    moments: list[dict] = []
    # A change asked on a video already planned: what is asked now, the video as it is
    # ([{"title", "items": [{"start", "end"}]}], live seconds) and what was asked before
    request: str = ""
    current: list[dict] = []
    asks: list[str] = []
    # More lives the video takes moments from (each moment of the answer then says its live: `job`;
    # in `current`, an item of another live says so the same way)
    lives: list[OtherLive] = []
    # The video is one the AI proposed: the moments it had spotted for it (live seconds)
    leads: list[float] = []
    # Asked again on purpose: the AI plans anew instead of giving the plan it kept
    fresh: bool = False


class IdeasRequest(BaseModel):
    """A live to look through for compilations worth making (what a search is given, and no question)."""

    duration: float = 0.0
    energy: list[float] | None = None
    meta: dict = {}
    url: str | None = None
    moments: list[dict] = []


class MemoryRequest(BaseModel):
    """A live to read into the AI's memory: who and what, its length, what the analysis kept of it."""

    duration: float = 0.0
    meta: dict = {}
    moments: list[dict] = []
    # The live as the analysis understood it (the job's vod_context)
    context: dict | None = None
    # Read it again although it was read before
    fresh: bool = False


class AssistantResume(BaseModel):
    """What the app (or the streamer) answers to the action a conversation is waiting on."""

    call: str
    result: dict | list | str | bool | None = None


class AssistantRequest(BaseModel):
    """One request of a conversation with the assistant: what the streamer says, or an action's answer."""

    # The conversation (kept between requests, and from one page to the next)
    thread: str
    text: str | None = None
    resume: AssistantResume | None = None
    # Where the streamer is in the app: {"page", "job", "video": {"id", ...}, "clip": {"filename", ...}, ...}
    context: dict = {}
    language: str = "fr"


class LivePiece(BaseModel):
    id: str
    # Where the piece sits in the live, seconds
    start: float
    end: float
    # The lines of the live's transcript it is made of (live seconds): to be cut on their words
    fit: list[float] | None = None


class PiecesRequest(BaseModel):
    url: str
    pieces: list[LivePiece]


class LookPiece(BaseModel):
    id: str
    # Its clip in the live's folder, and the part of it the passage plays (clip seconds)
    file: str
    start: float = 0.0
    end: float = 0.0
    text: str = ""
    # Someone is in the webcam during the passage
    cam: bool = False
    # The live its clip is in, when it isn't the one the request is about
    job: str | None = None


class LookTemplate(BaseModel):
    key: str
    name: str = ""
    # What the template shows and what it is good for, written by the app from the template itself
    description: str
    needs_cam: bool = False


class LooksRequest(BaseModel):
    pieces: list[LookPiece]
    templates: list[LookTemplate]
    # What the streamer asked about the look, in their words
    wish: str = ""
    # Where the webcam is in the stream's picture: {"x", "y", "w", "h", "frame_w", "frame_h"}
    cam: dict | None = None
    language: str = "fr"
    # The template the streamer uses when they ask for nothing
    usual: str | None = None


class SoundMusic(BaseModel):
    key: str
    name: str = ""
    kinds: list[str] = []
    about: str = ""


class SoundRequest(BaseModel):
    # What the video is: {"title", "parts", "seconds", "passages", "said"}
    video: dict
    musics: list[SoundMusic] = []
    # The streamer's favourite track for a kind of video, and the intro they prefer
    favourites: dict[str, str] = {}
    intro: str | None = None
    # What they asked for the video, in their words
    asked: str = ""
    language: str = "fr"
    # The intros the AI gave their last videos, the newest first: the choice stays away from them
    recent_intros: list[str] = []
    # When the intro they prefer is the hook: the graphics they like it framed with
    intro_look: str | None = None


class MusicRequest(BaseModel):
    # The file as it was added (in <data dir>/musics), and where the track is kept (same folder, .mp3)
    source: str
    target: str
    language: str = "fr"
    # Its name as the streamer's file had it: a hint for the model that listens
    hint: str = ""


class MusicMomentRequest(BaseModel):
    # One of the streamer's tracks (in <data dir>/musics), and about where its strong moment is (seconds)
    path: str
    at: float


class TemplateUsageRequest(BaseModel):
    name: str = ""
    description: str
    language: str = "fr"


class CutRequest(BaseModel):
    # What happens in the clip, the cut kept now (clip seconds), what the streamer asks for,
    # the length they aim for (seconds; none: left to the AI)
    summary: str = ""
    current: list[list[float]] = []
    wish: str = ""
    target: float | None = None


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
            except Exception as e:
                logger.exception("Job %s crashed", req.job_id)
                # Before the pipeline could report it (a module that won't load...): the app shows it
                try:
                    reason = f"{type(e).__name__}: {e}".splitlines()[0][:300]
                    update_job(req.job_id, status="ERROR", progress="Analyse arrêtée.", error=f"Le moteur d'analyse a planté : {reason}")
                except Exception:
                    logger.exception("Could not mark job %s as failed", req.job_id)
            finally:
                job_control.clear(req.job_id)
                with self._cv:
                    self.current = None


jobs = JobQueue()


def _missing_keys() -> list[str]:
    """Keys an analysis can't do without: OpenRouter, the AI that listens to and
    watches the live. Groq is optional: without it the live is transcribed on this
    computer or by OpenRouter (transcriber.chosen_engine)."""
    return [] if settings.get("openrouter_api_key", "OPENROUTER_API_KEY") else ["OpenRouter"]


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
        logger.warning("Job %s not started: missing key(s) %s", req.job_id, ", ".join(missing))
        update_job(
            req.job_id, status="ERROR", progress="Clés API manquantes.",
            error=f"Clé(s) API manquante(s) : {', '.join(missing)}. Ajoute-les dans Paramètres.",
        )
        return

    logger.info("Starting pipeline for job %s (url=%s)", req.job_id, req.url)
    update_job(req.job_id, status="PENDING", progress="Démarrage...")
    run_pipeline_sync(req.job_id, req.url or "")


def _prefetch_models() -> None:
    from app.services import panns_files

    panns_files.prefetch()


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
    # The audio events model (358 MB) before the first analysis needs it
    threading.Thread(target=_prefetch_models, name="models", daemon=True).start()
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


@app.post("/clips/{job_id}/{clip_filename}/extend", dependencies=[Depends(require_secret)])
def clip_extend(job_id: str, clip_filename: str, req: ExtendRequest) -> dict:
    from app.services.clip_tools import extend_clip

    if req.start < 0 or req.end - req.start < 1:
        raise HTTPException(status_code=400, detail="invalid bounds")
    try:
        return extend_clip(_check_job_id(job_id), os.path.basename(clip_filename), req.url, req.start, req.end)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="clip not found")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/clips/{job_id}/restore", dependencies=[Depends(require_secret)])
def clips_restore(job_id: str, req: RestoreRequest) -> dict:
    """Cut a project's clips again from the live (deleted to free disk space)."""
    from app.services.clip_tools import LiveGone, restore_clips

    clips = [c.model_dump() for c in req.clips if c.start >= 0 and c.end - c.start >= 1]
    try:
        return restore_clips(_check_job_id(job_id), req.url, clips)
    except LiveGone:
        raise HTTPException(status_code=410, detail="the live is no longer on Twitch")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


def _ai_errors(e: Exception) -> HTTPException:
    """What went wrong with an AI call, as the API reads it."""
    from app.services.live_search import NoTranscript

    if isinstance(e, NoTranscript):
        return HTTPException(status_code=409, detail="the live has no transcript")
    if isinstance(e, ProviderUnavailable):
        return HTTPException(status_code=402 if e.reason == "credits" else 401, detail=str(e))
    logger.warning(f"AI call failed: {type(e).__name__}: {e}")
    return HTTPException(status_code=502, detail=f"{type(e).__name__}: {e}"[:300])


@app.get("/jobs/{job_id}/search/info", dependencies=[Depends(require_secret)])
def search_info(job_id: str, duration: float = 0.0) -> dict:
    """What can be searched in a live, and about what asking the AI costs."""
    from app.services import live_search

    return live_search.info(_check_job_id(job_id), duration)


@app.post("/jobs/{job_id}/search", dependencies=[Depends(require_secret)])
def search_live(job_id: str, req: SearchRequest) -> dict:
    """Moments of the live that match a search: by words (free) or by asking the AI."""
    from app.services import live_search

    query = req.query.strip()[:300]
    if not query:
        raise HTTPException(status_code=400, detail="empty query")
    if req.mode != "ai":
        return live_search.search_words(_check_job_id(job_id), query, req.duration)
    try:
        return live_search.search_ai(_check_job_id(job_id), query, req.meta, req.duration, req.energy, url=req.url, moments=req.moments[:400], fresh=req.fresh)
    except Exception as e:
        raise _ai_errors(e) from e


@app.get("/jobs/{job_id}/search/progress", dependencies=[Depends(require_secret)])
def search_progress(job_id: str) -> dict:
    """What the AI searching this live is doing right now (shown while the app waits for its answer)."""
    from app.services import live_search

    return {"doing": live_search.doing(_check_job_id(job_id))}


@app.post("/jobs/{job_id}/plan", dependencies=[Depends(require_secret)])
def plan_video(job_id: str, req: PlanRequest) -> dict:
    """A whole video planned by the AI from a description: sections of moments."""
    from app.services import live_search

    brief = req.brief.strip()[:MAX_BRIEF]
    if not brief:
        raise HTTPException(status_code=400, detail="empty description")
    others = [
        {"job_id": _check_job_id(live.job_id), "duration": live.duration, "url": live.url, "moments": live.moments[:400], "date": live.date}
        for live in req.lives[: MAX_LIVES - 1]
        if live.job_id != job_id
    ] or None
    try:
        if req.request.strip():
            return live_search.revise_video(
                _check_job_id(job_id), brief, req.current[:12], [a[:MAX_BRIEF] for a in req.asks[-8:]], req.request.strip()[:MAX_BRIEF],
                req.duration, url=req.url, moments=req.moments[:400], others=others, date=req.meta.get("date"),
            )
        return live_search.plan_video(
            _check_job_id(job_id), brief, max(10.0, min(req.target, 600.0)), req.meta, req.duration, req.energy, url=req.url, moments=req.moments[:400],
            others=others, leads=[at for at in req.leads[:40] if at >= 0] or None, fresh=req.fresh,
        )
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/jobs/{job_id}/ideas", dependencies=[Depends(require_secret)])
def live_ideas(job_id: str, req: IdeasRequest) -> dict:
    """The compilations worth making from a live, found by the AI on its own (each with the request to build it from)."""
    from app.services import live_ideas as ideas

    try:
        return ideas.suggest_videos(_check_job_id(job_id), req.meta, req.duration, req.energy, url=req.url, moments=req.moments[:400])
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/jobs/{job_id}/memory", dependencies=[Depends(require_secret)])
def live_memory(job_id: str, req: MemoryRequest) -> dict:
    """A live enters the AI's memory: what happened in it is noted, the memory is rewritten, and corrections are
    proposed for the streamer's notes that the lives contradict. A live already read answers from disk."""
    from app.services import memory

    try:
        return memory.note_live(_check_job_id(job_id), req.meta, req.duration, req.moments[:400], req.context, fresh=req.fresh)
    except Exception as e:
        raise _ai_errors(e) from e


_THREAD_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _check_thread(thread: str) -> str:
    if not _THREAD_RE.match(thread or ""):
        raise HTTPException(status_code=400, detail="invalid thread")
    return thread


@app.post("/assistant/turn", dependencies=[Depends(require_secret)])
def assistant_turn(req: AssistantRequest) -> dict:
    """One request of a conversation with the assistant. It runs until the assistant is done ("done") or hands
    an action to the app or a question to the streamer ("action"): the next request then brings the answer
    (`resume`). 409 "busy": this conversation is still answering; 409 "nothing_waiting": the answer is for an
    action nobody waits on any more; 501: no model that calls tools (a development command stands for it)."""
    from app.services import assistant

    thread = _check_thread(req.thread)
    try:
        return assistant.turn(thread, req.text, req.resume.model_dump() if req.resume else None, req.context, req.language)
    except assistant.NothingAsked as e:
        raise HTTPException(status_code=400, detail="nothing was asked") from e
    except assistant.Busy as e:
        raise HTTPException(status_code=409, detail="busy: this conversation is already answering") from e
    except assistant.NothingWaiting as e:
        raise HTTPException(status_code=409, detail="nothing_waiting: no action is waiting for this answer") from e
    except assistant.NotAvailable as e:
        raise HTTPException(status_code=501, detail=str(e)) from e
    except Exception as e:
        raise _ai_errors(e) from e


@app.get("/assistant/progress", dependencies=[Depends(require_secret)])
def assistant_progress(thread: str) -> dict:
    """What the assistant is doing right now for a conversation (shown while the app waits for its answer)."""
    from app.services import assistant

    return assistant.progress(_check_thread(thread))


@app.delete("/assistant/thread", dependencies=[Depends(require_secret)])
def assistant_forget(thread: str) -> dict:
    """A conversation forgotten: the next request with this name starts a new one."""
    from app.services import assistant

    _check_thread(thread)
    try:
        assistant.forget(thread)
    except assistant.Busy as e:
        raise HTTPException(status_code=409, detail="busy: this conversation is already answering") from e
    return {"success": True}


@app.post("/clips/{job_id}/pieces", dependencies=[Depends(require_secret)])
def clips_pieces(job_id: str, req: PiecesRequest) -> dict:
    """Cut pieces of the live into small clips (compilations)."""
    from app.services.clip_tools import LiveGone, extract_pieces

    try:
        return extract_pieces(_check_job_id(job_id), req.url, [p.model_dump() for p in req.pieces if p.start >= 0])
    except LiveGone:
        raise HTTPException(status_code=410, detail="the live is no longer on Twitch")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/clips/{job_id}/looks", dependencies=[Depends(require_secret)])
def clips_looks(job_id: str, req: LooksRequest) -> dict:
    """The template of each passage of a video, chosen by the AI looking at its frames."""
    from app.services import looks

    if not req.pieces or not req.templates:
        raise HTTPException(status_code=400, detail="nothing to choose from")
    try:
        return looks.choose(
            _check_job_id(job_id),
            [{**p.model_dump(), "job": _check_job_id(p.job) if p.job else None} for p in req.pieces[: looks.MAX_PIECES]],
            [t.model_dump() for t in req.templates[: looks.MAX_TEMPLATES]],
            wish=req.wish[:600],
            cam=req.cam,
            language=req.language,
            usual=req.usual,
        )
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/musics/describe", dependencies=[Depends(require_secret)])
def describe_music(req: MusicRequest) -> dict:
    """A track the streamer adds: kept as an MP3, measured, and listened to by the AI to say what it is for."""
    from app.services import music_library, paths

    folder = os.path.realpath(os.path.join(paths.DATA_DIR, "musics"))
    source, target = os.path.realpath(req.source), os.path.realpath(req.target)
    # Only files of the musics folder: nothing else on the machine is read or written
    if os.path.dirname(source) != folder or os.path.dirname(target) != folder or not target.endswith(".mp3") or not os.path.isfile(source):
        raise HTTPException(status_code=400, detail="not a file of the musics folder")
    try:
        music_library.to_mp3(source, target)
    except Exception as e:
        raise HTTPException(status_code=422, detail="this file is not a sound the app can read") from e
    try:
        return music_library.describe(target, req.language, hint=req.hint)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/musics/moment", dependencies=[Depends(require_secret)])
def music_moment(req: MusicMomentRequest) -> dict:
    """The strong moment of a track as the streamer points at it: the attack nearest to the time they give, and the tempo there."""
    from app.services import music_library, paths

    folder = os.path.realpath(os.path.join(paths.DATA_DIR, "musics"))
    path = os.path.realpath(req.path)
    # Only a track of the musics folder: nothing else on the machine is read
    if os.path.dirname(path) != folder or not path.endswith(".mp3") or not os.path.isfile(path):
        raise HTTPException(status_code=400, detail="not a track of the musics folder")
    if not (req.at >= 0):
        raise HTTPException(status_code=400, detail="at: seconds from the start of the track")
    try:
        return music_library.moment(path, req.at)
    except Exception as e:
        raise HTTPException(status_code=422, detail="this track could not be read") from e


@app.post("/sound", dependencies=[Depends(require_secret)])
def video_sound(req: SoundRequest) -> dict:
    """The background music and the intro of a video, chosen by the AI from what the video is (it may give none)."""
    from app.services import looks

    try:
        return looks.choose_sound(
            req.video, [m.model_dump() for m in req.musics], req.favourites, req.intro, req.asked[:800], req.language, recent_intros=req.recent_intros[:12], preferred_look=req.intro_look
        )
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/templates/usage", dependencies=[Depends(require_secret)])
def template_usage(req: TemplateUsageRequest) -> dict:
    """What a template of the streamer's own is good for, in a sentence or two."""
    from app.services import looks

    if not req.description.strip():
        raise HTTPException(status_code=400, detail="no description")
    try:
        return looks.write_usage(req.name, req.description, req.language)
    except Exception as e:
        raise _ai_errors(e) from e


@app.post("/clips/{job_id}/{clip_filename}/suggest-cut", dependencies=[Depends(require_secret)])
def clip_suggest_cut(job_id: str, clip_filename: str, req: CutRequest) -> dict:
    """The parts of a clip worth keeping, chosen by the AI from what is said in it."""
    import json

    from app.services import live_search
    from app.services.clip_tools import _duration

    clip_dir = paths.clip_dir(_check_job_id(job_id))
    name = os.path.basename(clip_filename)
    clip_path = os.path.join(clip_dir, name)
    if not os.path.isfile(clip_path):
        raise HTTPException(status_code=404, detail="clip not found")
    try:
        with open(os.path.join(clip_dir, f"{os.path.splitext(name)[0]}_words.json"), encoding="utf-8") as f:
            words = json.load(f)
    except (OSError, ValueError):
        words = []
    try:
        return live_search.suggest_cut(
            words if isinstance(words, list) else [], _duration(clip_path), req.summary[:600], req.current[:20], req.wish[:300],
            target=live_search.cut_target(req.target),
        )
    except Exception as e:
        raise _ai_errors(e) from e


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


@app.get("/machine", dependencies=[Depends(require_secret)])
def machine_profile(cached: bool = False) -> dict | None:
    """The card, how fast Whisper would run here and the voice model's speed, measured in seconds (no Whisper download).
    `cached`: only when already measured (null otherwise), never a new measure."""
    from app.services import machine

    return machine.cached() if cached else machine.profile()


@app.post("/diagnostics/local-test", dependencies=[Depends(require_secret)])
def local_test() -> dict:
    """Run the GPU and Whisper on this computer once (the first time downloads the model)."""
    from app.services import local_check

    return local_check.run()


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
        # Where the PyTorch models run (a small NVIDIA card is left to Whisper)
        info["device"] = device.type
        if torch.cuda.is_available():
            info["gpu"] = torch.cuda.get_device_name(0)
        elif device.type == "mps":
            info["gpu"] = "Apple Silicon (MPS)"
    except Exception as e:
        info["device"] = "error"
        info["device_error"] = str(e)
    return info
