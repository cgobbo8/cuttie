"""What this computer can do, measured in a few seconds without downloading
Whisper (first launch, to tell whether a Groq key is worth it).

How fast Whisper would transcribe here comes from a matrix product on the GPU
(single precision: half precision is crippled on some cards, like the GTX 16xx),
scaled from machines where both were measured. Telling voices apart runs on
the CPU everywhere: its model (26 MB) is timed on a few windows.
"""

import logging
import platform
import subprocess
import time

import numpy as np

from app.services import transcriber

logger = logging.getLogger(__name__)

# (TFLOPS of a 2048² single-precision matrix product, Whisper large-v3-turbo × real time), measured
CALIBRATION = {
    # M1 Max (mlx-whisper): a 7 h 39 live in 11 to 14 min
    "mlx": (6.4, 35.0),
    # GTX 1650 Max-Q, 4 GB (faster-whisper, float16 without tensor cores, batch 4): the same live in 99 min
    "cuda": (2.1, 4.6),
}
# In proportion (recent cards also have tensor cores and room for bigger batches: rather more);
# past this, the rest of the work sets the pace
MAX_REALTIME = 60.0
# Below this, faster-whisper doesn't fit on the card
MIN_CUDA_VRAM_GB = 2.0

# Telling voices apart in one analysis: 1.5 s windows every 0.75 s over the speech of
# 50 passages of ~75 s (about 60 % speech) and 12 passages of 20 s for the streamer's voice
VOICE_WINDOWS = round((50 * 75 * 0.6 + 12 * 20) / 0.75)

_cached: dict | None = None


def whisper_realtime(backend: str, tflops: float) -> float | None:
    """How many times faster than real time Whisper would run here, None when it can't run locally."""
    reference = CALIBRATION.get(backend)
    if reference is None or tflops <= 0:
        return None
    ref_tflops, ref_speed = reference
    return round(min(MAX_REALTIME, max(1.0, ref_speed * tflops / ref_tflops)), 1)


def _matmul_tflops(device: str, n: int = 2048, rounds: int = 3, iters: int = 20) -> float:
    import torch

    sync = torch.cuda.synchronize if device == "cuda" else torch.mps.synchronize
    a = torch.randn(n, n, device=device)
    b = torch.randn(n, n, device=device)
    for _ in range(3):
        a @ b
    sync()
    best = 0.0
    for _ in range(rounds):
        t0 = time.perf_counter()
        for _ in range(iters):
            a @ b
        sync()
        best = max(best, 2 * n**3 * iters / (time.perf_counter() - t0) / 1e12)
    return round(best, 2)


def _gpu(backend: str) -> dict:
    """The card and its measured throughput (cuda / mlx), or what the CPU is."""
    try:
        import torch

        if backend == "cuda" and torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            vram = round(props.total_memory / 1024**3, 1)
            return {"name": props.name, "vram_gb": vram, "tflops": _matmul_tflops("cuda") if vram >= MIN_CUDA_VRAM_GB else 0.0}
        if backend == "mlx" and torch.backends.mps.is_available():
            return {"name": _apple_chip(), "vram_gb": None, "tflops": _matmul_tflops("mps")}
    except Exception as e:
        logger.warning(f"GPU measure failed: {e}")
        return {"name": None, "vram_gb": None, "tflops": 0.0, "error": f"{type(e).__name__}: {e}"}
    return {"name": None, "vram_gb": None, "tflops": 0.0}


def _apple_chip() -> str:
    try:
        out = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True, timeout=5).stdout.strip()
        return out or "Apple Silicon"
    except Exception:
        return "Apple Silicon"


def _voices() -> dict:
    """Seconds the voice model needs for one analysis on this CPU (downloads it once, 26 MB)."""
    try:
        from app.services import speaker_diarizer

        speaker_diarizer._get_embedder()
        audio = (0.05 * np.random.default_rng(0).standard_normal(16000 * 40)).astype(np.float32)
        windows = [(i * 0.75, i * 0.75 + 1.5, 0) for i in range(48)]
        speaker_diarizer._embed(audio, windows[:8])  # warm up
        t0 = time.perf_counter()
        speaker_diarizer._embed(audio, windows)
        per_window = (time.perf_counter() - t0) / len(windows)
        return {"seconds": round(per_window * VOICE_WINDOWS)}
    except Exception as e:
        logger.warning(f"Voice model measure failed: {e}")
        return {"seconds": None, "error": f"{type(e).__name__}: {e}"}


def cached() -> dict | None:
    """The profile when it was already measured (a journal export doesn't run the benchmark)."""
    return _cached


def profile() -> dict:
    """This computer, measured once per run of the worker."""
    global _cached
    if _cached is None:
        backend = transcriber.local_backend()
        gpu = _gpu(backend)
        _cached = {
            "backend": backend,
            "gpu": gpu,
            "cpu": platform.processor() or platform.machine(),
            "whisper_realtime": whisper_realtime(backend, gpu.get("tflops") or 0.0),
            "voices": _voices(),
        }
        logger.info(f"Machine: {_cached}")
    return _cached
