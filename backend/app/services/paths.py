"""Filesystem layout of the local Cuttie data directory.

Everything the app produces lives under a single data directory so the desktop
build can point it at %APPDATA%/Cuttie (or ~/Library/Application Support/Cuttie)
and dev runs can keep using a folder inside the repo.

    <DATA_DIR>/
        storage/            files served by the API (same keys as the old S3 bucket)
            clips/<job_id>/ clip MP4s + sidecars (_meta, _probe, _words, chat.json, ...)
            renders/<job_id>/
            assets/
        work/               temporary pipeline files (audio, frames, segments), emptied at start
        transcripts/<job>/  the live transcribed by 10-minute chunks (kept: a retry or a restart resumes)
        worker.sqlite3      worker job state (resume checkpoints)
        settings.json       user settings written by the API (API keys, ...)
"""

import os

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REPO_DIR = os.path.dirname(BACKEND_DIR)

DATA_DIR = os.path.abspath(os.getenv("CUTTIE_DATA_DIR") or os.path.join(REPO_DIR, ".data"))
STORAGE_DIR = os.path.join(DATA_DIR, "storage")
CLIPS_DIR = os.path.join(STORAGE_DIR, "clips")
WORK_DIR = os.path.join(DATA_DIR, "work")
TRANSCRIPTS_DIR = os.path.join(DATA_DIR, "transcripts")
DB_PATH = os.path.join(DATA_DIR, "worker.sqlite3")
SETTINGS_PATH = os.path.join(DATA_DIR, "settings.json")


def storage_path(key: str) -> str:
    """Absolute path of a storage key (e.g. "clips/<job>/<file>.mp4").

    Rejects keys that would escape the storage directory.
    """
    path = os.path.abspath(os.path.join(STORAGE_DIR, key))
    if os.path.commonpath([path, STORAGE_DIR]) != STORAGE_DIR:
        raise ValueError(f"Invalid storage key: {key}")
    return path


def clip_dir(job_id: str) -> str:
    return os.path.join(CLIPS_DIR, job_id)


def work_dir(*parts: str) -> str:
    """Path inside the temporary work directory (not created)."""
    return os.path.join(WORK_DIR, *parts)


def transcript_dir(job_id: str) -> str:
    """The live transcript's chunks of a job (deleted with the job by the API)."""
    return os.path.join(TRANSCRIPTS_DIR, job_id)


def ensure_dirs() -> None:
    for d in (STORAGE_DIR, CLIPS_DIR, WORK_DIR):
        os.makedirs(d, exist_ok=True)
