"""Speech to text with word timings, through Groq, OpenRouter or this computer.

The "transcription" setting picks the engine:
- "auto" (default): this computer when it is fast at it (Apple chip, NVIDIA
  GPU), else Groq when a Groq key is set, else OpenRouter
- "groq": Whisper large-v3 turbo on Groq, the fastest cloud (~1-2 s per minute
  of audio), but the free tier caps the audio per hour: too little for a whole live
- "openrouter": the same model through OpenRouter, no extra key (~5-15 s per
  minute, about 0.012 $ per hour of audio)
- "local": Whisper large-v3 turbo on this computer, free. Apple chips run it on
  their GPU (mlx-whisper, ~35x real time on an M1 Max without word timings),
  NVIDIA GPUs through CTranslate2 (faster-whisper), anything else on the CPU
  (about real time: too slow for a whole live)

A cloud engine that keeps refusing (rate limits, errors) or this computer
failing hands the audio to OpenRouter: its key is required for the analysis
anyway.
"""

import importlib.util
import logging
import os
import platform
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
MLX_REPO = "mlx-community/whisper-large-v3-turbo"


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
    """The engine the settings ask for, if it can run; else the fastest one
    available: Groq with its key (a 7-hour live in under a minute, ~0.04 $ per
    hour; its free tier's hourly cap sends the rest to OpenRouter), then this
    computer when its GPU makes it fast, then OpenRouter."""
    choice = settings.get("transcription", default="auto")
    if choice in ENGINES and has_key(choice):
        return choice
    if has_key("groq"):
        return "groq"
    if local_backend() in ("mlx", "cuda"):
        return "local"
    return "openrouter"


def fallback_for(engine: str) -> str | None:
    """Where audio goes when `engine` can't do it."""
    return "openrouter" if engine != "openrouter" and has_key("openrouter") else None


def transcribe(audio_path: str, engine: str, words: bool = True) -> Transcript:
    """Transcribe one file. `words=False` lets this computer skip word timings
    (2.5x faster on an Apple chip); cloud engines always give them. Provider
    errors propagate (rate limits included)."""
    if engine == "local":
        return _local(audio_path, words)
    client = get_groq_client() if engine == "groq" else get_openrouter_client()
    with open(audio_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model=CLOUD_MODELS[engine],
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )
    segments = [(s.start, s.end, s.text) for s in (getattr(result, "segments", None) or [])]
    word_list = tidy_words([{"word": w.word, "start": w.start, "end": w.end} for w in (getattr(result, "words", None) or [])])
    return Transcript((result.text or "").strip(), segments, word_list)


# ── This computer ────────────────────────────────────────────────────────────

_local_model = None
_load_lock = threading.Lock()
_run_lock = threading.Lock()  # one transcription at a time on the GPU
_cuda_failed = False
_batch_size: int | None = None  # 30 s chunks transcribed at once on the GPU


def _cuda_dlls() -> None:
    """On Windows, CTranslate2 loads cuBLAS / cuDNN from the DLL search path:
    point it at the copies PyTorch (CUDA build) or the nvidia-* wheels ship."""
    if sys.platform != "win32":
        return
    dirs = []
    try:
        import torch

        dirs.append(os.path.join(os.path.dirname(torch.__file__), "lib"))
    except Exception as e:  # torch missing or CPU build: other copies, or the CPU
        logger.debug(f"No CUDA libraries from torch: {e}")
    for package in ("nvidia.cublas", "nvidia.cudnn"):
        try:
            spec = importlib.util.find_spec(package)
        except (ImportError, ValueError):
            spec = None
        for location in (spec.submodule_search_locations or []) if spec else []:
            dirs.append(os.path.join(location, "bin"))
    for d in dirs:
        if os.path.isdir(d):
            os.add_dll_directory(d)


def local_device() -> str:
    """"cuda" when an NVIDIA GPU is usable by CTranslate2, else "cpu"."""
    if _cuda_failed:
        return "cpu"
    _cuda_dlls()
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


def local_backend() -> str:
    """How this computer runs Whisper: "mlx" (Apple chip GPU), "cuda" (NVIDIA
    GPU), or "cpu" (slow)."""
    if sys.platform == "darwin" and platform.machine() == "arm64" and importlib.util.find_spec("mlx_whisper"):
        return "mlx"
    return local_device()


def local_model_dir() -> str:
    """Where the local model is (downloaded once, ~1.6 GB)."""
    name = "whisper-mlx" if local_backend() == "mlx" else "whisper"
    return os.path.join(paths.DATA_DIR, "models", name)


def _mlx_model() -> str:
    with _load_lock:
        target = local_model_dir()
        if not os.path.isfile(os.path.join(target, "config.json")):
            from huggingface_hub import snapshot_download

            logger.info(f"Downloading Whisper {MLX_REPO} for the Apple chip (once, ~1.6 GB)...")
            snapshot_download(MLX_REPO, local_dir=target)
        return target


def _cuda_compute_type() -> str:
    """float16 on recent NVIDIA cards; int8 on a GTX 10xx (Pascal), where
    CTranslate2 refuses float16 (no faster than float32 there)."""
    import ctranslate2

    supported = ctranslate2.get_supported_compute_types("cuda")
    return next((kind for kind in ("float16", "int8_float16", "int8") if kind in supported), "float32")


def _cuda_batch_size() -> int:
    """How many chunks the GPU's memory holds at once (16 on 10 GB and more, 2 on 2 GB)."""
    global _batch_size
    if _batch_size is None:
        try:
            import torch

            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
        except Exception:
            vram_gb = 4.0
        _batch_size = 16 if vram_gb >= 10 else 8 if vram_gb >= 6 else 4 if vram_gb >= 3.5 else 2
    return _batch_size


def _transcribe_cuda(model, audio, words: bool) -> list:
    """Batched on the GPU; when its memory runs out, fewer chunks at a time from then on."""
    global _batch_size
    from faster_whisper import BatchedInferencePipeline

    while True:
        try:
            segments, _info = BatchedInferencePipeline(model=model).transcribe(
                audio, word_timestamps=words, vad_filter=True, batch_size=_cuda_batch_size()
            )
            return list(segments)
        except RuntimeError as e:
            if "out of memory" not in str(e).lower() or _cuda_batch_size() == 1:
                raise
            _batch_size = _cuda_batch_size() // 2
            logger.warning(f"GPU memory full: {_batch_size} chunk(s) at a time from now on")


def _get_local_model():
    global _local_model, _cuda_failed
    with _load_lock:
        if _local_model is None:
            from faster_whisper import WhisperModel

            device = local_device()
            logger.info(f"Loading Whisper {LOCAL_MODEL} on {device} (downloaded once, ~1.6 GB)...")
            try:
                _local_model = WhisperModel(
                    LOCAL_MODEL,
                    device=device,
                    compute_type=_cuda_compute_type() if device == "cuda" else "int8",
                    download_root=local_model_dir(),
                )
            except Exception as e:
                if device == "cuda":
                    # CUDA libraries missing or too old: this audio goes to the
                    # fallback engine (the CPU would take as long as the audio),
                    # and "auto" stops picking this computer
                    logger.warning(f"Whisper on the GPU failed ({e}): falling back, CPU from now on if asked")
                    _cuda_failed = True
                raise
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
        timeout=600,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32)


def _local(audio_path: str, words: bool = True) -> Transcript:
    if local_backend() == "mlx":
        return _local_mlx(audio_path, words)
    model = _get_local_model()
    audio = _decode(audio_path)
    with _run_lock:
        if model.model.device == "cuda":
            segments = _transcribe_cuda(model, audio, words)
        else:
            segments, _info = model.transcribe(audio, word_timestamps=words, vad_filter=True, beam_size=1)
        out = Transcript(text="")
        texts = []
        word_list = []
        for s in segments:
            out.segments.append((float(s.start), float(s.end), s.text))
            texts.append(s.text.strip())
            word_list += [{"word": w.word, "start": w.start, "end": w.end} for w in s.words or []]
    out.words = tidy_words(word_list)
    out.text = " ".join(t for t in texts if t)
    return out


def _local_mlx(audio_path: str, words: bool) -> Transcript:
    import mlx_whisper

    model = _mlx_model()
    audio = _decode(audio_path)
    with _run_lock:
        result = mlx_whisper.transcribe(audio, path_or_hf_repo=model, word_timestamps=words, condition_on_previous_text=False)
    segments = [(float(s["start"]), float(s["end"]), s["text"]) for s in result.get("segments", [])]
    word_list = [{"word": w["word"], "start": w["start"], "end": w["end"]} for s in result.get("segments", []) for w in s.get("words", [])]
    return Transcript(" ".join(t.strip() for _s, _e, t in segments if t.strip()), segments, tidy_words(word_list))
