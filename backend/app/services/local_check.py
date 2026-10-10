"""Run the local models once, to know what this computer can do (Settings >
Diagnostic): the GPU through PyTorch, Whisper on 30 seconds of audio, and the
voice model that tells speakers apart. The report says how fast, or the exact
error (a missing CUDA DLL, ...).
"""

import logging
import os
import tempfile
import time

import numpy as np

from app.services import transcriber

logger = logging.getLogger(__name__)

TEST_SECONDS = 30


def _gpu() -> dict:
    try:
        import torch

        from app.services.device import get_device

        device = get_device()
        x = torch.randn(2048, 2048, device=device)
        t0 = time.time()
        for _ in range(10):
            x = (x @ x) / 2048
        x.sum().item()  # waits for the GPU
        info: dict = {"device": device.type, "torch": torch.__version__, "matmul_ms": round((time.time() - t0) * 100, 1)}
        # The NVIDIA card, even when the PyTorch models stay on the CPU (small or unusable card)
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            info.update(
                name=props.name,
                vram_gb=round(props.total_memory / 1024**3, 1),
                capability=f"{props.major}.{props.minor}",
                cuda=torch.version.cuda,
                cudnn=torch.backends.cudnn.version(),
            )
        return info
    except Exception as e:
        logger.warning(f"GPU check failed: {e}")
        return {"error": f"{type(e).__name__}: {e}"}


def _audio(path: str, seconds: float) -> None:
    import soundfile as sf

    rng = np.random.default_rng(0)
    t = np.arange(int(16000 * seconds)) / 16000
    # A quiet hum with noise: enough for the model to run start to end
    sf.write(path, (0.05 * np.sin(2 * np.pi * 220 * t) + 0.01 * rng.standard_normal(t.size)).astype(np.float32), 16000)


def _whisper() -> dict:
    backend = transcriber.local_backend()
    report: dict = {"backend": backend, "model_ready": os.path.isdir(transcriber.local_model_dir()) and any(os.scandir(transcriber.local_model_dir()))}
    with tempfile.TemporaryDirectory() as tmp:
        warm, timed = os.path.join(tmp, "warm.wav"), os.path.join(tmp, "test.wav")
        _audio(warm, 5)
        _audio(timed, TEST_SECONDS)
        try:
            t0 = time.time()
            transcriber.transcribe(warm, "local", words=False)  # loads (or downloads) the model
            report["load_seconds"] = round(time.time() - t0, 1)
            t0 = time.time()
            transcriber.transcribe(timed, "local", words=False)
            seconds = time.time() - t0
            report.update(seconds=round(seconds, 2), realtime=round(TEST_SECONDS / max(seconds, 0.01), 1))
            if transcriber._local_model is not None and report["backend"] == "cuda":
                report.update(compute_type=transcriber._local_model.model.compute_type, batch_size=transcriber._cuda_batch_size())
        except Exception as e:
            logger.warning(f"Local Whisper check failed: {e}")
            report["error"] = f"{type(e).__name__}: {e}"
    # CUDA may have failed on load: then this computer is the CPU from now on
    report["backend_after"] = transcriber.local_backend()
    return report


def _voices() -> dict:
    """The speaker model (downloaded once, 26 MB) and the speech detector, on noise."""
    try:
        from app.services import speaker_diarizer

        t0 = time.time()
        speaker_diarizer._get_embedder()
        load = time.time() - t0
        audio = (0.05 * np.random.default_rng(0).standard_normal(16000 * 12)).astype(np.float32)
        t0 = time.time()
        speaker_diarizer._speech_regions(audio)
        embeddings = speaker_diarizer._embed(audio, [(i * 1.5, i * 1.5 + 1.5, 0) for i in range(8)])
        return {"load_seconds": round(load, 1), "seconds": round(time.time() - t0, 2), "dim": int(embeddings.shape[1])}
    except Exception as e:
        logger.warning(f"Voice model check failed: {e}")
        return {"error": f"{type(e).__name__}: {e}"}


def run() -> dict:
    return {"gpu": _gpu(), "whisper": _whisper(), "voices": _voices()}
