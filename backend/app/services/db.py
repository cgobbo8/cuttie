"""SQLite persistence layer for jobs and hot points."""

import json
import os
import sqlite3
from datetime import datetime, timezone

from app.models.schemas import HotPoint, JobResponse, JobStatus, LlmAnalysis, SignalBreakdown

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "cuttie.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
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
    """)
    # Migrations: add columns if they don't exist (for existing DBs)
    migrations = [
        ("hot_points", "llm_json", "TEXT"),
        ("hot_points", "final_score", "REAL"),
        ("jobs", "vod_game", "TEXT"),
    ]
    for table, col, col_type in migrations:
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

    # Handle hot_points separately
    hot_points = kwargs.pop("hot_points", None)

    if kwargs:
        cols = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values()) + [job_id]
        conn = _get_conn()
        conn.execute(f"UPDATE jobs SET {cols} WHERE job_id = ?", vals)
        conn.commit()
        conn.close()

    if hot_points is not None:
        save_hot_points(job_id, hot_points)


def save_hot_points(job_id: str, hot_points: list[HotPoint]) -> None:
    conn = _get_conn()
    conn.execute("DELETE FROM hot_points WHERE job_id = ?", (job_id,))
    for i, hp in enumerate(hot_points):
        signals_json = json.dumps(hp.signals.model_dump())
        llm_json = json.dumps(hp.llm.model_dump()) if hp.llm else None
        conn.execute(
            "INSERT INTO hot_points (job_id, rank, timestamp_seconds, timestamp_display, score, signals_json, clip_filename, llm_json, final_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, i + 1, hp.timestamp_seconds, hp.timestamp_display, hp.score, signals_json, hp.clip_filename, llm_json, hp.final_score),
        )
    conn.commit()
    conn.close()


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
                    llm=llm,
                )
            )

    return JobResponse(
        job_id=row["job_id"],
        status=JobStatus(row["status"]),
        progress=row["progress"],
        hot_points=hot_points,
        error=row["error"],
        vod_title=row["vod_title"],
        vod_game=row["vod_game"] if "vod_game" in row.keys() else None,
        vod_duration_seconds=row["vod_duration_seconds"],
    )


def list_jobs() -> list[dict]:
    """Return all jobs (summary, no hot_points detail)."""
    conn = _get_conn()
    rows = conn.execute(
        "SELECT job_id, url, status, vod_title, vod_duration_seconds, created_at, error FROM jobs ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
