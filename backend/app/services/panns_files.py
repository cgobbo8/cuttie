"""The PANNs CNN14 files (laughs, shouts, speech: audio events), fetched once to
~/panns_data where panns_inference expects them (it would use `wget`, missing
on Windows). The checkpoint (358 MB) comes from Zenodo, or the same file on
Hugging Face when Zenodo times out; the label list ships with Cuttie.

Fetched in the background when the worker starts, so the first analysis
doesn't wait for it (or fail when the hosts are down).
"""

import logging
import os
import shutil
import threading
from pathlib import Path

from app.services.downloads import download_if_missing

logger = logging.getLogger(__name__)

PANNS_DIR = os.path.join(str(Path.home()), "panns_data")
CHECKPOINT_PATH = os.path.join(PANNS_DIR, "Cnn14_16k_mAP=0.438.pth")
LABELS_PATH = os.path.join(PANNS_DIR, "class_labels_indices.csv")
CHECKPOINT_URLS = [
    "https://zenodo.org/records/3987831/files/Cnn14_16k_mAP=0.438.pth?download=1",
    "https://huggingface.co/niobures/PANNs/resolve/main/models/pretrained/Cnn14_16k_mAP%3D0.438.pth",
]
CHECKPOINT_SHA256 = "e2ee543a27919542c2ea03eabaa70b24dcd4e6c8e05621de6b67a94e4c5058e6"
CHECKPOINT_MIN_BYTES = 350_000_000
# AudioSet's 527 labels (CC BY 4.0, Google), first served from storage.googleapis.com
_LABELS_ASSET = Path(__file__).resolve().parents[2] / "assets" / "panns" / "class_labels_indices.csv"

_lock = threading.Lock()


def ensure() -> str:
    """The checkpoint's path, fetched first if needed (one download at a time)."""
    with _lock:
        if not os.path.isfile(LABELS_PATH):
            os.makedirs(PANNS_DIR, exist_ok=True)
            shutil.copyfile(_LABELS_ASSET, LABELS_PATH)
        return download_if_missing(CHECKPOINT_URLS, CHECKPOINT_PATH, min_bytes=CHECKPOINT_MIN_BYTES, sha256=CHECKPOINT_SHA256)


def prefetch() -> None:
    """At the worker's start: fetch what's missing, without failing anything."""
    try:
        if not os.path.isfile(CHECKPOINT_PATH):
            ensure()
            logger.info("Audio events model ready")
    except Exception as e:
        logger.warning(f"Audio events model not fetched yet (next try when an analysis needs it): {e}")
