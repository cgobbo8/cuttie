"""Ordered delivery of job status events to the API (replaces Redis pub/sub).

Events are queued and POSTed one at a time by a background thread, so the API
receives status transitions in the order the pipeline emitted them. When
CUTTIE_API_URL is not set (tests, scripts), events are dropped silently.
"""

import logging
import os
import queue
import threading
import time

import requests

logger = logging.getLogger(__name__)

_queue: "queue.Queue[dict]" = queue.Queue()
_thread: threading.Thread | None = None
_thread_lock = threading.Lock()

MAX_ATTEMPTS = 5


def _api_url() -> str:
    return os.getenv("CUTTIE_API_URL", "").rstrip("/")


def publish(payload: dict) -> None:
    if not _api_url():
        return
    _ensure_sender()
    _queue.put(payload)


def flush(timeout: float = 10.0) -> None:
    """Block until queued events are sent (or the timeout expires)."""
    deadline = time.time() + timeout
    while _queue.unfinished_tasks and time.time() < deadline:
        time.sleep(0.05)


def _ensure_sender() -> None:
    global _thread
    with _thread_lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_send_loop, name="api-events", daemon=True)
            _thread.start()


def _send_loop() -> None:
    session = requests.Session()
    while True:
        payload = _queue.get()
        try:
            _send(session, payload)
        finally:
            _queue.task_done()


def _send(session: requests.Session, payload: dict) -> None:
    url = f"{_api_url()}/api/internal/worker-events"
    headers = {"X-Cuttie-Secret": os.getenv("CUTTIE_INTERNAL_SECRET", "")}
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = session.post(url, json=payload, headers=headers, timeout=10)
            if resp.status_code < 500:
                if resp.status_code >= 400:
                    logger.warning("API rejected event for job %s: HTTP %s", payload.get("job_id"), resp.status_code)
                return
            logger.debug("API returned HTTP %s for event, retrying", resp.status_code)
        except requests.RequestException as e:
            logger.debug("Event delivery failed (attempt %d): %s", attempt + 1, e)
        time.sleep(min(2 ** attempt, 10))
    logger.error("Dropped status event for job %s after %d attempts", payload.get("job_id"), MAX_ATTEMPTS)
