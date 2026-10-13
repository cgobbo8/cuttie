"""Audio event classification using PANNs (Pre-trained Audio Neural Networks).

Uses CNN14 trained on AudioSet (527 classes) to distinguish:
- Speech presence (streamer is talking/reacting)
- Vocal excitement (laughter, screaming, shouting — rare but very strong signal)
- Game audio (music, explosions, gunshots)

Key insight: on Twitch streams, the "Speech" class dominates. What matters is:
1. Is the streamer talking? (speech_presence) — engaged = more interesting
2. Are there ANY vocal excitement markers? (vocal_excitement) — rare gold
3. Is it just game noise without voice? (game_audio) — less interesting
"""

import logging

import librosa
import numpy as np

from app.services.device import get_device
from app.services import panns_files

logger = logging.getLogger(__name__)

# The VOD audio is 16 kHz: the 16 kHz CNN14 checkpoint matches it. The 32 kHz one
# fed 16 kHz audio heard everything an octave up and twice as fast (laughter
# scored ~0.01 instead of ~0.6 on real clips)
PANNS_SR = 16000

# AudioSet class indices
_SPEECH_CLASSES = {
    0: 1.0,    # Speech
    1: 1.0,    # Male speech
    2: 1.0,    # Female speech
}

# Excitement classes — rare on Twitch but very strong when they fire
_EXCITEMENT_CLASSES = {
    8: 1.0,    # Shout
    10: 0.8,   # Whoop
    11: 1.0,   # Yell
    12: 1.0,   # Battle cry
    14: 1.0,   # Screaming
    16: 1.0,   # Laughter
    18: 0.8,   # Giggle
    19: 0.7,   # Snicker
    20: 1.0,   # Belly laugh
    21: 0.6,   # Chuckle, chortle
    44: 0.7,   # Gasp
    66: 0.9,   # Cheering
}

_GAME_AUDIO_CLASSES = {
    137: 0.8,   # Music
    287: 0.6,   # Thunder
    426: 1.0,   # Explosion
    427: 1.0,   # Gunshot, gunfire
    428: 0.9,   # Machine gun
    436: 0.8,   # Boom
    469: 0.7,   # Smash, crash
}

_model = None

def _load_checkpoint(path: str) -> dict:
    """The checkpoint keeps its training sampler state as numpy arrays: allow just
    those types instead of turning off torch's weights-only loading."""
    import torch

    reconstruct = getattr(np, "_core", None)
    reconstruct = (reconstruct or np.core).multiarray._reconstruct
    allowed = [
        (reconstruct, "numpy.core.multiarray._reconstruct"),
        np.ndarray,
        np.dtype,
        type(np.dtype(np.float64)),
        type(np.dtype(np.float32)),
        type(np.dtype(np.int64)),
    ]
    import warnings

    with torch.serialization.safe_globals(allowed), warnings.catch_warnings():
        # Old numpy pickles: harmless deprecation noise on load
        warnings.simplefilter("ignore", getattr(np, "exceptions", np).VisibleDeprecationWarning)
        return torch.load(path, map_location="cpu", weights_only=True)


def _get_model():
    global _model
    if _model is None:
        checkpoint = panns_files.ensure()
        from panns_inference.models import Cnn14

        device = get_device()
        logger.info(f"Loading PANNs CNN14 (16 kHz) on {device}...")
        model = Cnn14(sample_rate=PANNS_SR, window_size=512, hop_size=160, mel_bins=64, fmin=50, fmax=8000, classes_num=527)
        model.load_state_dict(_load_checkpoint(checkpoint)["model"])
        model.eval()
        model.to(device)
        _model = (model, device)
        logger.info(f"PANNs CNN14 loaded on {device}")
    return _model


def _compute_window_scores(probs: np.ndarray) -> dict:
    """Extract speech_presence, vocal_excitement, game_audio from PANNs output."""
    # Speech presence: max of speech classes (streamer is talking)
    speech = max(probs[idx] for idx in _SPEECH_CLASSES)

    # Vocal excitement: weighted sum of excitement classes
    # These are rare (often 0.001-0.01) but relative differences matter
    excitement = sum(probs[idx] * w for idx, w in _EXCITEMENT_CLASSES.items())

    # Game audio: weighted sum
    game = sum(probs[idx] * w for idx, w in _GAME_AUDIO_CLASSES.items())

    return {
        "speech_presence": float(speech),
        "vocal_excitement": float(excitement),
        "game_audio": float(game),
    }


def classify_audio(
    filepath: str,
    window_sec: float = 5.0,
    hop_sec: float = 5.0,
) -> list[dict]:
    """Classify audio events per window using PANNs CNN14.

    Returns list of dicts with: time, speech_presence, vocal_excitement, game_audio
    """
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
            _process_batch(model, batch_audio, batch_times, windows)
            batch_audio = []
            batch_times = []
            if len(windows) % 500 == 0:
                logger.info(f"  Classification progress: {len(windows)}/{n_windows}")

    if batch_audio:
        _process_batch(model, batch_audio, batch_times, windows)

    logger.info(f"Classification done: {len(windows)} windows")
    return windows


def _infer(net, device, batch_audio) -> np.ndarray:
    import torch

    with torch.no_grad():
        return net(torch.from_numpy(np.stack(batch_audio)).to(device))["clipwise_output"].cpu().numpy()


def _process_batch(model, batch_audio, batch_times, windows):
    """Process a batch of audio chunks through PANNs. When the GPU's memory runs
    out (a 4 GB card also holds Whisper, transcribing the live alongside), the
    model moves to the CPU for good: slower, but the analysis goes on."""
    global _model
    import torch

    net, device = _model or model
    try:
        clipwise_output = _infer(net, device, batch_audio)
    except RuntimeError as e:
        if device.type != "cuda" or "out of memory" not in str(e).lower():
            raise
        logger.warning("PANNs: GPU memory full, carrying on with the CPU")
        torch.cuda.empty_cache()
        net.to("cpu")
        _model = (net, torch.device("cpu"))
        clipwise_output = _infer(net, _model[1], batch_audio)

    for j, time in enumerate(batch_times):
        scores = _compute_window_scores(clipwise_output[j])
        scores["time"] = time
        windows.append(scores)
