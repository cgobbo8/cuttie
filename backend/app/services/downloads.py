"""Plain-Python file downloads (no wget/curl, which aren't available on Windows).

Model files come from academic hosts that sometimes time out (Zenodo answered
504 twice in a row on the streamer's PC): each source is tried a few times,
carrying on from what already came, then the next source; a known SHA-256
checks the result.
"""

import hashlib
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

ATTEMPTS = 3
# Seconds before the 2nd and the 3rd attempt on the same source
BACKOFF = (5.0, 20.0)
_CHUNK = 1 << 20


def download_if_missing(urls: str | list[str], dest: str, min_bytes: int = 1, sha256: str | None = None) -> str:
    """Download to `dest` unless a file of at least `min_bytes` is already there.
    `urls`: one source, or several holding the same file, tried in order."""
    if os.path.isfile(dest) and os.path.getsize(dest) >= min_bytes:
        return dest

    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    name = os.path.basename(dest)
    failures: list[str] = []
    for url in [urls] if isinstance(urls, str) else urls:
        host = url.split("/")[2] if "//" in url else url
        for attempt in range(ATTEMPTS):
            if attempt:
                time.sleep(BACKOFF[min(attempt, len(BACKOFF)) - 1])
            try:
                _fetch(url, tmp)
            except (requests.RequestException, OSError) as e:
                failures.append(f"{host}: {e}")
                logger.warning("Download of %s from %s failed (attempt %d/%d): %s", name, host, attempt + 1, ATTEMPTS, e)
                continue
            if os.path.getsize(tmp) < min_bytes or (sha256 and _sha256(tmp) != sha256):
                failures.append(f"{host}: incomplete or damaged")
                logger.warning("Download of %s from %s is incomplete or damaged: starting over", name, host)
                os.remove(tmp)
                continue
            os.replace(tmp, dest)
            return dest
    raise RuntimeError(f"{name} could not be downloaded ({'; '.join(failures[-2:])})")


def _fetch(url: str, tmp: str) -> None:
    """Download into `tmp`, carrying on from what is already there when the server allows it."""
    have = os.path.getsize(tmp) if os.path.isfile(tmp) else 0
    headers = {"Range": f"bytes={have}-"} if have else {}
    logger.info("Downloading %s → %s%s", url, tmp, f" (from {have // (1 << 20)} MB)" if have else "")
    with requests.get(url, stream=True, timeout=60, headers=headers) as resp:
        if have and resp.status_code == 416:
            return  # nothing left to fetch: the checks decide
        resp.raise_for_status()
        # 206: the rest of the file; 200: the server ignored the range, the whole file again
        with open(tmp, "ab" if have and resp.status_code == 206 else "wb") as f:
            for chunk in resp.iter_content(chunk_size=_CHUNK):
                f.write(chunk)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(_CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()
