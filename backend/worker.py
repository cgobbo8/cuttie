"""
Cuttie Python Worker — Redis-based job consumer.

- BRPOPs jobs from `cuttie:jobs_queue` (pushed by AdonisJS API)
- Runs the full pipeline
- db.update_job() automatically publishes to `cuttie:job_status:<job_id>`
- AdonisJS subscribes to those updates and persists them to its own DB

Run:
    cd backend && uv run python worker.py
"""

import json
import logging
import os
import signal
import sys
import threading
from datetime import datetime, timezone

import redis
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("worker")

REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD") or None
QUEUE_KEY = "cuttie:jobs_queue"

_stop_event = threading.Event()


def get_redis() -> redis.Redis:
    return redis.Redis(
        host=REDIS_HOST,
        port=REDIS_PORT,
        password=REDIS_PASSWORD,
        decode_responses=True,
    )


def run_job(job_id: str, url: str) -> None:
    """Run the full pipeline for a job."""
    from app.services.db import _get_conn, get_job, init_db, update_job
    from app.services.pipeline import run_pipeline_sync

    init_db()

    # Create job row if not present
    existing = get_job(job_id)
    if not existing:
        conn = _get_conn()
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT OR IGNORE INTO jobs (job_id, url, status, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?)",
            (job_id, url, now, now),
        )
        conn.commit()
        conn.close()

    logger.info("Starting pipeline for job %s (url=%s)", job_id, url)
    try:
        update_job(job_id, status="PENDING", progress="Démarrage...")
        run_pipeline_sync(job_id, url)
    except Exception as e:
        logger.exception("Pipeline failed for job %s", job_id)
        update_job(job_id, status="ERROR", error=str(e))


def run_add_clip_job(job_id: str, clip_filename: str, clip_name: str, rank: int) -> None:
    """Process an imported clip and add it to an existing job."""
    from app.services.db import init_db
    from app.services.import_pipeline import run_add_clip_pipeline

    init_db()

    logger.info("Adding clip %s to job %s (rank=%d)", clip_filename, job_id, rank)
    try:
        run_add_clip_pipeline(job_id, clip_filename, clip_name, rank)
    except Exception as e:
        logger.exception("Add clip failed for job %s / %s", job_id, clip_filename)


def main() -> None:
    r = get_redis()

    try:
        r.ping()
        logger.info("Connected to Redis at %s:%s", REDIS_HOST, REDIS_PORT)
    except redis.ConnectionError as e:
        logger.error("Cannot connect to Redis: %s", e)
        sys.exit(1)

    # Cleanup orphaned temp data from previous runs (killed workers, crashes)
    import shutil
    for temp_dir in ("data", "triage_audio"):
        full_path = os.path.join(os.path.dirname(__file__), temp_dir)
        if os.path.isdir(full_path):
            for entry in os.listdir(full_path):
                entry_path = os.path.join(full_path, entry)
                if os.path.isdir(entry_path):
                    shutil.rmtree(entry_path, ignore_errors=True)
                    logger.info("Cleaned up orphaned temp dir: %s/%s", temp_dir, entry)

    # Log compute device (triggers detection + GPU info)
    from app.services.device import get_device
    get_device()

    logger.info("Waiting for jobs on queue: %s", QUEUE_KEY)

    def handle_signal(sig, frame):
        logger.info("Received signal %s, shutting down...", sig)
        _stop_event.set()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    while not _stop_event.is_set():
        try:
            result = r.brpop(QUEUE_KEY, timeout=2)
            if result is None:
                continue

            _, raw = result
            payload = json.loads(raw)
            job_id = payload.get("job_id")
            job_type = payload.get("type")

            if not job_id:
                logger.warning("Invalid job payload: %s", payload)
                continue

            logger.info("Dequeued job %s (type=%s)", job_id, job_type or "analyze")

            if job_type == "add_clip":
                run_add_clip_job(
                    job_id,
                    payload["clip_filename"],
                    payload.get("clip_name", "Imported clip"),
                    payload.get("rank", 99),
                )
            else:
                url = payload.get("url")
                if not url:
                    logger.warning("Missing url in payload: %s", payload)
                    continue
                run_job(job_id, url)

        except redis.RedisError as e:
            logger.error("Redis error: %s", e)
            _stop_event.wait(timeout=3)
        except Exception as e:
            logger.exception("Unexpected error: %s", e)


if __name__ == "__main__":
    main()
