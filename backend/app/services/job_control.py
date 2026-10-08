"""In-process job cancellation flags (set by the worker HTTP server, read by the pipeline)."""

import threading


class JobCancelled(Exception):
    """Raised when a job is cancelled from the UI."""


_lock = threading.Lock()
_cancelled: set[str] = set()


def request_cancel(job_id: str) -> None:
    with _lock:
        _cancelled.add(job_id)


def consume_cancel(job_id: str) -> bool:
    """Return True (once) if a cancel was requested for this job."""
    with _lock:
        if job_id in _cancelled:
            _cancelled.discard(job_id)
            return True
        return False


def clear(job_id: str) -> None:
    with _lock:
        _cancelled.discard(job_id)
