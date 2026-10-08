"""Plain-Python file downloads (no wget/curl, which aren't available on Windows)."""

import logging
import os

import requests

logger = logging.getLogger(__name__)


def download_if_missing(url: str, dest: str, min_bytes: int = 1) -> str:
    """Download `url` to `dest` unless a file of at least `min_bytes` is already there."""
    if os.path.isfile(dest) and os.path.getsize(dest) >= min_bytes:
        return dest

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    logger.info("Downloading %s → %s", url, dest)
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)

    if os.path.getsize(tmp) < min_bytes:
        os.remove(tmp)
        raise RuntimeError(f"Incomplete download from {url}")
    os.replace(tmp, dest)
    return dest
