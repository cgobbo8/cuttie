"""SQLite persistence layer for jobs and hot points."""

import json
import logging
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

from app.models.schemas import HotPoint, JobResponse, JobStatus, LlmAnalysis, SignalBreakdown, StepTiming

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "cuttie.db")

# ── Optional Redis publisher ──────────────────────────────────────────────────
# When REDIS_HOST is set, status updates are published so AdonisJS can relay
# them to SSE clients. Falls back to a no-op if Redis is unavailable.

_redis: Any = None
_redis_init = False


def _get_redis():
    global _redis, _redis_init
    if _redis_init:
        return _redis
    _redis_init = True
    host = os.getenv("REDIS_HOST")
    if not host:
        return None
    try:
        import redis as redis_lib  # type: ignore
        _redis = redis_lib.Redis(
            host=host,
            port=int(os.getenv("REDIS_PORT", "6379")),
            password=os.getenv("REDIS_PASSWORD") or None,
            decode_responses=True,
        )
        _redis.ping()
        logger.info("Redis publisher connected at %s", host)
    except Exception as e:
        logger.warning("Redis publisher unavailable: %s", e)
        _redis = None
    return _redis


def _publish_status(job_id: str, payload: dict) -> None:
    r = _get_redis()
    if r is None:
        return
    try:
        r.publish(f"cuttie:job_status:{job_id}", json.dumps(payload))
    except Exception as e:
        logger.debug("Redis publish failed: %s", e)


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            job_id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'PENDING',
            progress TEXT,
            vod_title TEXT,
            vod_duration_seconds REAL,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hot_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
            rank INTEGER NOT NULL,
            timestamp_seconds REAL NOT NULL,
            timestamp_display TEXT NOT NULL,
            score REAL NOT NULL,
            signals_json TEXT NOT NULL,
            clip_filename TEXT,
            llm_json TEXT,
            final_score REAL,
            UNIQUE(job_id, rank)
        );

        CREATE INDEX IF NOT EXISTS idx_hot_points_job ON hot_points(job_id);

        CREATE TABLE IF NOT EXISTS renders (
            render_id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            clip_filename TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'rendering',
            progress INTEGER NOT NULL DEFAULT 0,
            output_filename TEXT,
            size_mb REAL,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_renders_job ON renders(job_id);
    """)
    # Migrations: add columns if they don't exist (for existing DBs).
    # Table names and column names are interpolated directly into SQL (SQLite
    # does not support parameterized DDL), so we validate them against an
    # explicit allowlist before use.
    migrations = [
        ("hot_points", "llm_json", "TEXT"),
        ("hot_points", "final_score", "REAL"),
        ("hot_points", "chat_mood", "TEXT"),
        ("hot_points", "vertical_filename", "TEXT"),
        ("jobs", "vod_game", "TEXT"),
        ("jobs", "streamer", "TEXT"),
        ("jobs", "view_count", "INTEGER"),
        ("jobs", "stream_date", "TEXT"),
        ("jobs", "step_timings", "TEXT"),
        ("hot_points", "clip_name", "TEXT"),
    ]

    # Allowlists derived from the migration tuples above — update both lists
    # whenever a new migration is added.
    VALID_TABLES = {"jobs", "hot_points", "renders"}
    VALID_COLUMNS = {
        "llm_json", "final_score", "chat_mood", "vertical_filename",
        "vod_game", "streamer", "view_count", "stream_date", "step_timings",
        "clip_name",
    }
    VALID_COL_TYPES = {"TEXT", "REAL", "INTEGER", "BLOB", "NUMERIC"}

    for table, col, col_type in migrations:
        if table not in VALID_TABLES:
            raise ValueError(f"Invalid table name in migration: {table!r}")
        if col not in VALID_COLUMNS:
            raise ValueError(f"Invalid column name in migration: {col!r}")
        if col_type not in VALID_COL_TYPES:
            raise ValueError(f"Invalid column type in migration: {col_type!r}")
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists
    conn.close()


def create_job(job_id: str, url: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()
    conn.execute(
        "INSERT INTO jobs (job_id, url, status, progress, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (job_id, url, "PENDING", "Job created, waiting to start...", now, now),
    )
    conn.commit()
    conn.close()


def update_job(job_id: str, **kwargs) -> None:
    if not kwargs:
        return
    now = datetime.now(timezone.utc).isoformat()
    kwargs["updated_at"] = now

    # Handle complex fields separately (not simple SQL columns)
    hot_points = kwargs.pop("hot_points", None)
    step_timings = kwargs.pop("step_timings", None)

    # Serialize step_timings to JSON for storage
    if step_timings is not None:
        kwargs["step_timings"] = json.dumps(
            {k: v.model_dump() if hasattr(v, "model_dump") else v for k, v in step_timings.items()}
        )

    if kwargs:
        cols = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values()) + [job_id]
        conn = _get_conn()
        conn.execute(f"UPDATE jobs SET {cols} WHERE job_id = ?", vals)
        conn.commit()
        conn.close()

    if hot_points is not None:
        save_hot_points(job_id, hot_points)

    # Publish status update to Redis (no-op if Redis unavailable)
    publish_payload: dict = {"job_id": job_id, **kwargs}
    publish_payload.pop("updated_at", None)
    # Re-expose step_timings as dict (not JSON string) for Redis subscribers
    if step_timings is not None:
        publish_payload["step_timings"] = {
            k: v.model_dump() if hasattr(v, "model_dump") else v for k, v in step_timings.items()
        }
    if hot_points is not None:
        publish_payload["hot_points"] = [hp.model_dump() for hp in hot_points]
    _publish_status(job_id, publish_payload)


def save_hot_points(job_id: str, hot_points: list[HotPoint]) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM hot_points WHERE job_id = ?", (job_id,))
    for i, hp in enumerate(hot_points):
        signals_json = json.dumps(hp.signals.model_dump())
        llm_json = json.dumps(hp.llm.model_dump()) if hp.llm else None
        conn.execute(
            "INSERT INTO hot_points (job_id, rank, timestamp_seconds, timestamp_display, score, signals_json, clip_filename, vertical_filename, llm_json, final_score, chat_mood, clip_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, i + 1, hp.timestamp_seconds, hp.timestamp_display, hp.score, signals_json, hp.clip_filename, hp.vertical_filename, llm_json, hp.final_score, hp.chat_mood, hp.clip_name or None),
        )
    conn.commit()
    conn.close()


def publish_clip_ready(job_id: str, rank: int, hp: HotPoint) -> None:
    """Publish a single enriched hot point via Redis so SSE clients get it immediately."""
    _publish_status(job_id, {
        "job_id": job_id,
        "type": "clip_ready",
        "rank": rank,
        "hot_point": hp.model_dump(),
    })


def update_hot_point_clip(job_id: str, rank: int, clip_filename: str) -> None:
    conn = _get_conn()
    conn.execute(
        "UPDATE hot_points SET clip_filename = ? WHERE job_id = ? AND rank = ?",
        (clip_filename, job_id, rank),
    )
    conn.commit()
    conn.close()


def update_hot_point_llm(job_id: str, rank: int, llm: LlmAnalysis) -> None:
    conn = _get_conn()
    conn.execute(
        "UPDATE hot_points SET llm_json = ? WHERE job_id = ? AND rank = ?",
        (json.dumps(llm.model_dump()), job_id, rank),
    )
    conn.commit()
    conn.close()


def get_job(job_id: str) -> JobResponse | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM jobs WHERE job_id = ?", (job_id,)).fetchone()
    if row is None:
        conn.close()
        return None

    hp_rows = conn.execute(
        "SELECT * FROM hot_points WHERE job_id = ? ORDER BY rank", (job_id,)
    ).fetchall()
    conn.close()

    hot_points = None
    if hp_rows:
        hot_points = []
        for hp in hp_rows:
            signals = SignalBreakdown(**json.loads(hp["signals_json"]))
            llm = LlmAnalysis(**json.loads(hp["llm_json"])) if hp["llm_json"] else None
            hot_points.append(
                HotPoint(
                    timestamp_seconds=hp["timestamp_seconds"],
                    timestamp_display=hp["timestamp_display"],
                    score=hp["score"],
                    final_score=hp["final_score"],
                    signals=signals,
                    clip_filename=hp["clip_filename"],
                    vertical_filename=hp["vertical_filename"] if "vertical_filename" in hp.keys() else None,
                    clip_name=(hp["clip_name"] or "") if "clip_name" in hp.keys() else "",
                    llm=llm,
                    chat_mood=hp["chat_mood"] or "",
                )
            )

    keys = row.keys()
    raw_timings = row["step_timings"] if "step_timings" in keys else None
    step_timings = None
    if raw_timings:
        try:
            parsed = json.loads(raw_timings)
            step_timings = {k: StepTiming(**v) for k, v in parsed.items()}
        except Exception:
            pass

    return JobResponse(
        job_id=row["job_id"],
        status=JobStatus(row["status"]),
        progress=row["progress"],
        hot_points=hot_points,
        error=row["error"],
        vod_title=row["vod_title"],
        vod_game=row["vod_game"] if "vod_game" in keys else None,
        vod_duration_seconds=row["vod_duration_seconds"],
        streamer=row["streamer"] if "streamer" in keys else None,
        view_count=row["view_count"] if "view_count" in keys else None,
        stream_date=row["stream_date"] if "stream_date" in keys else None,
        step_timings=step_timings,
    )


def list_jobs() -> list[dict]:
    """Return all jobs (summary, no hot_points detail)."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT job_id, url, status, vod_title, vod_duration_seconds, created_at, error FROM jobs ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── Renders ──────────────────────────────────────────────────

def create_render(render_id: str, job_id: str, clip_filename: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()
    conn.execute(
        "INSERT INTO renders (render_id, job_id, clip_filename, status, progress, created_at, updated_at) VALUES (?, ?, ?, 'rendering', 0, ?, ?)",
        (render_id, job_id, clip_filename, now, now),
    )
    conn.commit()
    conn.close()


def update_render(render_id: str, **kwargs) -> None:
    if not kwargs:
        return
    now = datetime.now(timezone.utc).isoformat()
    kwargs["updated_at"] = now
    cols = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values()) + [render_id]
    conn = _get_conn()
    conn.execute(f"UPDATE renders SET {cols} WHERE render_id = ?", vals)
    conn.commit()
    conn.close()


def get_render(render_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM renders WHERE render_id = ?", (render_id,)).fetchone()
    conn.close()
    if row is None:
        return None
    return dict(row)


def list_renders() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT r.*, j.vod_title, j.vod_game FROM renders r LEFT JOIN jobs j ON r.job_id = j.job_id ORDER BY r.created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
