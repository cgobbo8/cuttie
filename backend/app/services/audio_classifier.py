"""Audio event classification using PANNs (Pre-trained Audio Neural Networks).

Uses CNN14 trained on AudioSet (527 classes) to classify audio events.
Categories are configurable via ClassificationConfig — the defaults detect:
- Speech presence (streamer is talking/reacting)
- Vocal excitement (laughter, screaming, shouting — rare but very strong signal)
- Game audio (music, explosions, gunshots)

Key insight: on Twitch streams, the "Speech" class dominates. What matters is:
1. Is the streamer talking? (speech_presence) — engaged = more interesting
2. Are there ANY vocal excitement markers? (vocal_excitement) — rare gold
3. Is it just game noise without voice? (game_audio) — less interesting
"""

from __future__ import annotations

import logging

import librosa
import numpy as np

from app.models.schemas import AudioCategoryGroup, ClassificationConfig

logger = logging.getLogger(__name__)

# PANNs works fine at 16kHz (half the memory, same quality for our classes)
PANNS_SR = 16000

_model = None


def _get_device() -> str:
    """Pick the best available torch device for PANNs inference."""
    import torch
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _get_model():
    global _model
    if _model is None:
        import torch
        from panns_inference import AudioTagging

        device = _get_device()
        logger.info(f"Loading PANNs CNN14 model on {device}...")

        # Load on CPU first (PANNs only supports cpu/cuda natively)
        at = AudioTagging(checkpoint_path=None, device="cpu")

        # Move model to MPS/CUDA if available
        if device != "cpu":
            at.model.to(device)
            at.device = device

        _model = at
        logger.info(f"PANNs CNN14 loaded on {device}")
    return _model


def _score_group(probs: np.ndarray, group: AudioCategoryGroup) -> float:
    """Score a single category group from PANNs probabilities."""
    if group.aggregation == "max":
        return float(max((probs[idx] * w for idx, w in group.classes.items()), default=0.0))
    # weighted_sum (default)
    return float(sum(probs[idx] * w for idx, w in group.classes.items()))


def _compute_window_scores(probs: np.ndarray, config: ClassificationConfig) -> dict:
    """Extract scores for all configured category groups from PANNs output."""
    scores = {
        "speech_presence": _score_group(probs, config.speech),
        "vocal_excitement": _score_group(probs, config.excitement),
        "game_audio": _score_group(probs, config.game_audio),
    }
    for name, group in config.extra_groups.items():
        scores[name] = _score_group(probs, group)
    return scores


def classify_audio(
    filepath: str,
    window_sec: float = 5.0,
    hop_sec: float = 5.0,
    config: ClassificationConfig | None = None,
) -> list[dict]:
    """Classify audio events per window using PANNs CNN14.

    Returns list of dicts with: time, speech_presence, vocal_excitement, game_audio,
    plus any extra groups defined in config.
    """
    if config is None:
        config = ClassificationConfig()

    model = _get_model()

    logger.info("Loading audio for PANNs classification...")
    y, sr = librosa.load(filepath, sr=PANNS_SR, mono=True)
    duration = len(y) / sr
    logger.info(f"Audio loaded: {duration:.0f}s at {sr}Hz")

    samples_per_window = int(window_sec * sr)
    samples_per_hop = int(hop_sec * sr)

    windows = []
    n_windows = max(1, int((len(y) - samples_per_window) / samples_per_hop) + 1)
    logger.info(f"Classifying {n_windows} windows with PANNs CNN14...")

    batch_size = 32
    batch_audio = []
    batch_times = []

    for i in range(0, len(y) - samples_per_window + 1, samples_per_hop):
        chunk = y[i:i + samples_per_window].astype(np.float32)
        time = i / sr
        batch_audio.append(chunk)
        batch_times.append(time)

        if len(batch_audio) >= batch_size:
            _process_batch(model, batch_audio, batch_times, windows, config)
            batch_audio = []
            batch_times = []
            if len(windows) % 500 == 0:
                logger.info(f"  Classification progress: {len(windows)}/{n_windows}")

    if batch_audio:
        _process_batch(model, batch_audio, batch_times, windows, config)

    logger.info(f"Classification done: {len(windows)} windows")
    return windows


def _process_batch(model, batch_audio, batch_times, windows, config: ClassificationConfig):
    """Process a batch of audio chunks through PANNs."""
    audio_array = np.stack(batch_audio)
    clipwise_output, _ = model.inference(audio_array)

    for j, time in enumerate(batch_times):
        scores = _compute_window_scores(clipwise_output[j], config)
        scores["time"] = time
        windows.append(scores)
