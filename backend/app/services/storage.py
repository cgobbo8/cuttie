"""Local file storage.

Media files live under paths.STORAGE_DIR using the same keys as the old S3
bucket ("clips/<job_id>/<file>.mp4", "renders/...", "assets/..."), and the API
serves them from there. Most pipeline files are written in place, so "upload"
is a no-op for them.
"""

import logging
import os
import shutil

from app.services.paths import storage_path

logger = logging.getLogger(__name__)


def upload_file(local_path: str, key: str, content_type: str = "video/mp4") -> None:
    """Make sure the file is stored under `key` (copies it if it lives elsewhere)."""
    dest = storage_path(key)
    if os.path.abspath(local_path) == dest:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(local_path, dest)
    size_mb = os.path.getsize(dest) / 1024 / 1024
    logger.info(f"Stored {key} ({size_mb:.1f} MB)")


def rename_object(old_key: str, new_key: str) -> None:
    """Rename a stored file."""
    src, dest = storage_path(old_key), storage_path(new_key)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    os.replace(src, dest)
    logger.info(f"Storage rename: {old_key} → {new_key}")
