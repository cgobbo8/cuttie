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

logger = logging.getLogger(__name__)

PANNS_SR = 32000

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
    20: 1.0,   # Belly laugh
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


def _get_model():
    global _model
    if _model is None:
        from panns_inference import AudioTagging
        logger.info("Loading PANNs CNN14 model...")
        _model = AudioTagging(checkpoint_path=None, device="cpu")
        logger.info("PANNs CNN14 loaded")
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
    hop_sec: float = 2.5,
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


def _process_batch(model, batch_audio, batch_times, windows):
    """Process a batch of audio chunks through PANNs."""
    audio_array = np.stack(batch_audio)
    clipwise_output, _ = model.inference(audio_array)

    for j, time in enumerate(batch_times):
        scores = _compute_window_scores(clipwise_output[j])
        scores["time"] = time
        windows.append(scores)
