"""Speech to text with word timings, through Groq, OpenRouter or this PC.

The "transcription" setting picks the engine:
- "auto" (default): Groq when a Groq key is set, else OpenRouter
- "groq": Whisper large-v3 turbo on Groq, the fastest (~1-2 s per minute of audio)
- "openrouter": the same model through OpenRouter, no extra key (~5-15 s per
  minute, about 0.012 $ per hour of audio)
- "local": faster-whisper on this PC, free; fast on an NVIDIA GPU, slow on a CPU

A cloud engine that keeps refusing (rate limits, errors) hands the segment to
OpenRouter: its key is required for the analysis anyway.
"""

import logging
import os
import sys
import threading
from dataclasses import dataclass, field

from app.services import paths, settings
from app.services.openai_client import get_groq_client, get_openrouter_client

logger = logging.getLogger(__name__)

ENGINES = ("groq", "openrouter", "local")
CHOICES = ("auto", *ENGINES)
CLOUD_MODELS = {"groq": "whisper-large-v3-turbo", "openrouter": "openai/whisper-large-v3-turbo"}
LOCAL_MODEL = "large-v3-turbo"


@dataclass
class Transcript:
    text: str
    segments: list[tuple[float, float, str]] = field(default_factory=list)
    words: list[dict] = field(default_factory=list)


def tidy_words(words: list[dict]) -> list[dict]:
    """Same word list whatever the engine: plain floats, no stray spaces, and
    French elisions / trailing punctuation glued back ("l" + "'hôpital")."""
    out: list[dict] = []
    for w in words:
        text = str(w["word"]).strip()
        if not text:
            continue
        start, end = float(w["start"]), float(w["end"])
        if out and (text[0] in "'’" or all(c in ".,!?;:…»)" for c in text)):
            out[-1]["word"] += text
            out[-1]["end"] = max(out[-1]["end"], end)
            continue
        out.append({"word": text, "start": start, "end": end})
    return out


def has_key(engine: str) -> bool:
    if engine == "groq":
        return bool(settings.get("groq_api_key", "GROQ_API_KEY"))
    if engine == "openrouter":
        return bool(settings.get("openrouter_api_key", "OPENROUTER_API_KEY"))
    return engine == "local"


def chosen_engine() -> str:
    """The engine the settings ask for, if it can run; else Groq / OpenRouter."""
    choice = settings.get("transcription", default="auto")
    if choice in ENGINES and has_key(choice):
        return choice
    return "groq" if has_key("groq") else "openrouter"


def fallback_for(engine: str) -> str | None:
    """Where a segment goes when `engine` can't do it."""
    return "openrouter" if engine != "openrouter" and has_key("openrouter") else None


def transcribe(audio_path: str, engine: str) -> Transcript:
    """Transcribe one file with word timings. Provider errors propagate (rate limits included)."""
    if engine == "local":
        return _local(audio_path)
    client = get_groq_client() if engine == "groq" else get_openrouter_client()
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model=CLOUD_MODELS[engine],
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
    segments = [(s.start, s.end, s.text) for s in (getattr(result, "segments", None) or [])]
    words = tidy_words([{"word": w.word, "start": w.start, "end": w.end} for w in (getattr(result, "words", None) or [])])
    return Transcript((result.text or "").strip(), segments, words)


# ── This PC ──────────────────────────────────────────────────────────────────

_local_model = None
_load_lock = threading.Lock()
_run_lock = threading.Lock()  # one transcription at a time on the GPU


def _cuda_dlls() -> None:
    """On Windows, CTranslate2 loads cuBLAS / cuDNN from the DLL search path:
    point it at the copies PyTorch (CUDA build) ships, when there are some."""
    if sys.platform != "win32":
        return
    try:
        import torch

        lib = os.path.join(os.path.dirname(torch.__file__), "lib")
        if os.path.isdir(lib):
            os.add_dll_directory(lib)
    except Exception as e:  # torch missing or CPU build: the CPU path still works
        logger.debug(f"No CUDA libraries from torch: {e}")


def local_device() -> str:
    """"cuda" when an NVIDIA GPU is usable, else "cpu"."""
    _cuda_dlls()
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


def local_model_dir() -> str:
    return os.path.join(paths.DATA_DIR, "models", "whisper")


def _get_local_model():
    global _local_model
    with _load_lock:
        if _local_model is None:
            from faster_whisper import WhisperModel

            device = local_device()
            logger.info(f"Loading Whisper {LOCAL_MODEL} on {device} (downloaded once, ~1.6 GB)...")
            try:
                _local_model = WhisperModel(
                    LOCAL_MODEL,
                    device=device,
                    compute_type="float16" if device == "cuda" else "int8",
                    download_root=local_model_dir(),
                )
            except Exception as e:
                if device == "cpu":
                    raise
                # CUDA libraries missing or too old: the CPU still works, slowly
                logger.warning(f"Whisper on the GPU failed ({e}), using the CPU")
                _local_model = WhisperModel(LOCAL_MODEL, device="cpu", compute_type="int8", download_root=local_model_dir())
        return _local_model


def _decode(audio_path: str):
    """16 kHz mono float32 samples, decoded by ffmpeg (faster-whisper's own decoder,
    PyAV, changed its API under it)."""
    import subprocess

    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", audio_path, "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
        check=True,
        capture_output=True,
        timeout=120,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def _local(audio_path: str) -> Transcript:
    model = _get_local_model()
    audio = _decode(audio_path)
    with _run_lock:
        segments, _info = model.transcribe(
            audio,
            word_timestamps=True,
            vad_filter=True,
            beam_size=5 if model.model.device == "cuda" else 1,
        )
        out = Transcript(text="")
        texts = []
        words = []
        for s in segments:
            out.segments.append((float(s.start), float(s.end), s.text))
            texts.append(s.text.strip())
            words += [{"word": w.word, "start": w.start, "end": w.end} for w in s.words or []]
    out.words = tidy_words(words)
    out.text = " ".join(t for t in texts if t)
    return out
