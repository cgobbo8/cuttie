"""Centralized torch device detection for ML models."""

import logging
import os

import torch

logger = logging.getLogger(__name__)

_device: torch.device | None = None

# Below this, the NVIDIA card is left to Whisper (the heaviest model, and it runs
# alongside the others): PyTorch models go to the CPU
MIN_TORCH_VRAM_GB = 3.0


def _cuda_works() -> str | None:
    """None when a small computation runs on the GPU, else why not (e.g. a card
    too old for this PyTorch build: "no kernel image is available")."""
    try:
        return None if float((torch.ones(8, device="cuda") * 2).sum().item()) == 16.0 else "wrong result"
    except Exception as e:
        return f"{type(e).__name__}: {e}"


def get_device() -> torch.device:
    """Detect best available device: MPS > CUDA > CPU.

    Set CUTTIE_DEVICE env var to override (e.g. "cpu", "cuda", "cuda:1", "mps").
    """
    global _device
    if _device is not None:
        return _device

    forced = os.getenv("CUTTIE_DEVICE")
    if forced:
        _device = torch.device(forced)
        logger.info("Device override via CUTTIE_DEVICE: %s", _device)
        return _device

    if torch.backends.mps.is_available():
        _device = torch.device("mps")
        logger.info("Apple Silicon detected — using MPS")
    elif torch.cuda.is_available():
        name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
        problem = _cuda_works()
        if problem:
            _device = torch.device("cpu")
            logger.warning("NVIDIA GPU %s unusable by PyTorch (%s) — using CPU", name, problem)
        elif vram_gb < MIN_TORCH_VRAM_GB:
            _device = torch.device("cpu")
            logger.info("NVIDIA GPU detected: %s (%.1f GB) — kept for Whisper, CPU for the other models", name, vram_gb)
        else:
            _device = torch.device("cuda")
            logger.info("NVIDIA GPU detected: %s (%.1f GB) — using CUDA", name, vram_gb)
    else:
        _device = torch.device("cpu")
        logger.info("No GPU detected — using CPU")

    return _device
