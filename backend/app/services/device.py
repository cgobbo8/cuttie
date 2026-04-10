"""Centralized torch device detection for ML models."""

import logging
import os

import torch

logger = logging.getLogger(__name__)

_device: torch.device | None = None


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
        _device = torch.device("cuda")
        name = torch.cuda.get_device_name(0)
        vram_gb = torch.cuda.get_device_properties(0).total_mem / 1024**3
        logger.info("NVIDIA GPU detected: %s (%.1f GB) — using CUDA", name, vram_gb)
    else:
        _device = torch.device("cpu")
        logger.info("No GPU detected — using CPU")

    return _device
