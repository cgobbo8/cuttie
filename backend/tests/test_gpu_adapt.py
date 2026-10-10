"""Cuttie adapts to the NVIDIA card: a GTX 1050 (Pascal, 2 GB) as well as an RTX 4070 Super."""

import types

import pytest
import torch

from app.services import device, transcriber

GB = 1024**3


def _card(monkeypatch, vram_gb: float, works: str | None = None):
    monkeypatch.delenv("CUTTIE_DEVICE", raising=False)
    monkeypatch.setattr(device, "_device", None)
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "get_device_name", lambda index=0: "NVIDIA GeForce GTX 1050")
    monkeypatch.setattr(torch.cuda, "get_device_properties", lambda index=0: types.SimpleNamespace(total_memory=vram_gb * GB))
    monkeypatch.setattr(device, "_cuda_works", lambda: works)


def test_a_big_card_runs_the_models(monkeypatch):
    _card(monkeypatch, 12)
    assert device.get_device().type == "cuda"


def test_a_small_card_is_left_to_whisper(monkeypatch):
    _card(monkeypatch, 2)
    assert device.get_device().type == "cpu"


def test_a_card_this_pytorch_cannot_use_falls_back_to_the_cpu(monkeypatch):
    _card(monkeypatch, 8, works="RuntimeError: CUDA error: no kernel image is available for execution on the device")
    assert device.get_device().type == "cpu"


def test_whisper_uses_int8_where_float16_is_refused(monkeypatch):
    import ctranslate2

    # GTX 10xx (Pascal): no efficient float16
    monkeypatch.setattr(ctranslate2, "get_supported_compute_types", lambda dev, index=0: {"float32", "int8", "int8_float32"})
    assert transcriber._cuda_compute_type() == "int8"
    # RTX: float16 as before
    monkeypatch.setattr(ctranslate2, "get_supported_compute_types", lambda dev, index=0: {"float32", "float16", "int8", "int8_float16", "int8_float32"})
    assert transcriber._cuda_compute_type() == "float16"


@pytest.mark.parametrize("vram_gb, batch", [(2, 2), (4, 4), (8, 8), (12, 16)])
def test_chunks_at_once_follow_the_gpu_memory(monkeypatch, vram_gb, batch):
    monkeypatch.setattr(transcriber, "_batch_size", None)
    monkeypatch.setattr(torch.cuda, "get_device_properties", lambda index=0: types.SimpleNamespace(total_memory=vram_gb * GB))
    assert transcriber._cuda_batch_size() == batch


def test_out_of_memory_retries_with_fewer_chunks(monkeypatch):
    import faster_whisper

    tried = []

    class Pipeline:
        def __init__(self, model):
            pass

        def transcribe(self, audio, word_timestamps, vad_filter, batch_size):
            tried.append(batch_size)
            if batch_size > 2:
                raise RuntimeError("CUDA failed with error out of memory")
            return iter(["segment"]), None

    monkeypatch.setattr(faster_whisper, "BatchedInferencePipeline", Pipeline)
    monkeypatch.setattr(transcriber, "_batch_size", 8)
    assert transcriber._transcribe_cuda(object(), [], words=True) == ["segment"]
    assert tried == [8, 4, 2]
    assert transcriber._cuda_batch_size() == 2  # remembered for the next chunks

    # Any other error is not a memory problem: it goes up
    def broken(self, *args, **kwargs):
        raise RuntimeError("cuDNN failed")

    monkeypatch.setattr(Pipeline, "transcribe", broken)
    with pytest.raises(RuntimeError, match="cuDNN"):
        transcriber._transcribe_cuda(object(), [], words=True)
