"""Model downloads that survive a host timing out (Zenodo answered 504 on the streamer's PC)."""

import hashlib

import pytest
import requests

from app.services import downloads, panns_files

DATA = b"cnn14-weights-" * 1000
SHA = hashlib.sha256(DATA).hexdigest()


class Response:
    def __init__(self, status: int, body: bytes = b""):
        self.status_code = status
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"{self.status_code} Server Error")

    def iter_content(self, chunk_size=1):
        for i in range(0, len(self._body), 4096):
            yield self._body[i : i + 4096]


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(downloads, "BACKOFF", (0.0, 0.0))


def test_a_host_timing_out_hands_over_to_the_next(monkeypatch, tmp_path):
    asked = []

    def get(url, **kwargs):
        asked.append(url)
        return Response(504) if "zenodo" in url else Response(200, DATA)

    monkeypatch.setattr(downloads.requests, "get", get)
    dest = tmp_path / "model.pth"
    downloads.download_if_missing(["https://zenodo.org/m", "https://huggingface.co/m"], str(dest), min_bytes=len(DATA), sha256=SHA)

    assert dest.read_bytes() == DATA
    assert asked == ["https://zenodo.org/m"] * downloads.ATTEMPTS + ["https://huggingface.co/m"]


def test_a_cut_download_carries_on_where_it_stopped(monkeypatch, tmp_path):
    dest = tmp_path / "model.pth"
    (tmp_path / "model.pth.part").write_bytes(DATA[:5000])
    ranges = []

    def get(url, headers=None, **kwargs):
        ranges.append((headers or {}).get("Range"))
        start = int(headers["Range"].split("=")[1].rstrip("-")) if headers and "Range" in headers else 0
        return Response(206 if start else 200, DATA[start:])

    monkeypatch.setattr(downloads.requests, "get", get)
    downloads.download_if_missing("https://zenodo.org/m", str(dest), min_bytes=len(DATA), sha256=SHA)

    assert ranges == ["bytes=5000-"]
    assert dest.read_bytes() == DATA


def test_a_damaged_file_is_never_kept(monkeypatch, tmp_path):
    monkeypatch.setattr(downloads.requests, "get", lambda url, **k: Response(200, b"<html>maintenance</html>" * 100))
    dest = tmp_path / "model.pth"
    with pytest.raises(RuntimeError, match="could not be downloaded"):
        downloads.download_if_missing(["https://zenodo.org/m", "https://huggingface.co/m"], str(dest), sha256=SHA)
    assert not dest.exists()
    assert not (tmp_path / "model.pth.part").exists()


def test_a_file_already_there_is_not_fetched_again(monkeypatch, tmp_path):
    dest = tmp_path / "model.pth"
    dest.write_bytes(DATA)
    monkeypatch.setattr(downloads.requests, "get", lambda *a, **k: pytest.fail("fetched again"))
    assert downloads.download_if_missing("https://zenodo.org/m", str(dest), min_bytes=len(DATA)) == str(dest)


def test_the_model_files_land_where_panns_looks(monkeypatch, tmp_path):
    monkeypatch.setattr(panns_files, "PANNS_DIR", str(tmp_path))
    monkeypatch.setattr(panns_files, "LABELS_PATH", str(tmp_path / "class_labels_indices.csv"))
    monkeypatch.setattr(panns_files, "CHECKPOINT_PATH", str(tmp_path / "Cnn14_16k_mAP=0.438.pth"))
    fetched = []
    monkeypatch.setattr(panns_files, "download_if_missing", lambda urls, dest, **k: fetched.append((urls, k)) or dest)

    assert panns_files.ensure() == str(tmp_path / "Cnn14_16k_mAP=0.438.pth")
    # The 527 AudioSet labels ship with Cuttie: no request for them
    assert (tmp_path / "class_labels_indices.csv").read_text().count("\n") == 528
    urls, options = fetched[0]
    assert urls[0].startswith("https://zenodo.org/") and urls[1].startswith("https://huggingface.co/")
    assert options["sha256"] == panns_files.CHECKPOINT_SHA256


def test_prefetch_never_fails_the_worker(monkeypatch, tmp_path):
    monkeypatch.setattr(panns_files, "CHECKPOINT_PATH", str(tmp_path / "missing.pth"))

    def down():
        raise RuntimeError("every host is down")

    monkeypatch.setattr(panns_files, "ensure", down)
    panns_files.prefetch()  # logs, doesn't raise
