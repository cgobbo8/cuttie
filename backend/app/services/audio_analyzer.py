"""Audio feature extraction using librosa.

Analyzes audio in overlapping windows and extracts:
- RMS Energy (volume → cris, hype)
- Spectral Centroid (brightness → excited voice)
- Spectral Flux (sudden spectral changes → transitions)
- Pitch Variance via YIN on voiced frames (voice going up → excitement)
- Zero Crossing Rate (noise/screams detection)
"""

import logging

import librosa
import numpy as np

logger = logging.getLogger(__name__)

# Processing constants
DEFAULT_SR = 11025
FRAME_LENGTH = 2048
HOP_LENGTH = 512

# For very long VODs, process in chunks to manage memory
CHUNK_DURATION = 1800  # 30 minutes

# Pitch tracking range and voicing gate
PITCH_FMIN = librosa.note_to_hz("C2")
PITCH_FMAX = librosa.note_to_hz("C7")
VOICED_F0_RANGE = (70.0, 1000.0)  # YIN pins unvoiced frames near the search bounds
MIN_VOICED_FRAMES = 10  # per window, below that the variance is meaningless


def _compute_spectral_flux(y: np.ndarray) -> np.ndarray:
    """Compute spectral flux (rate of change in the power spectrum)."""
    S = np.abs(librosa.stft(y, n_fft=FRAME_LENGTH, hop_length=HOP_LENGTH))
    flux = np.sqrt(np.sum(np.diff(S, axis=1) ** 2, axis=0))
    # Pad to match other features' length
    return np.concatenate([[0], flux])


def _voiced_f0(y: np.ndarray, sr: int, rms: np.ndarray) -> np.ndarray:
    """Per-frame f0 (Hz) via YIN, NaN where the frame isn't voiced.

    YIN is ~100x faster than pYIN (the previous implementation, which took ~90%
    of the audio step) but has no voicing decision, so silent/quiet frames and
    estimates stuck at the search bounds are masked out.
    """
    f0 = librosa.yin(y, fmin=PITCH_FMIN, fmax=PITCH_FMAX, sr=sr,
                     frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)
    n = min(len(f0), len(rms))
    f0, rms = f0[:n], rms[:n]
    voiced = (rms > np.median(rms)) & (f0 > VOICED_F0_RANGE[0]) & (f0 < VOICED_F0_RANGE[1])
    return np.where(voiced, f0, np.nan)


def _extract_frame_features(y: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Extract all frame-level features from an audio signal."""
    rms = librosa.feature.rms(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    flux = _compute_spectral_flux(y)

    # Onset strength: detects when excitement "starts" (transients, attacks)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    f0 = _voiced_f0(y, sr, rms)

    # Ensure all arrays have the same length
    min_len = min(len(rms), len(centroid), len(zcr), len(flux), len(onset_env), len(f0))
    return {
        "rms": rms[:min_len],
        "centroid": centroid[:min_len],
        "zcr": zcr[:min_len],
        "flux": flux[:min_len],
        "onset": onset_env[:min_len],
        "f0": f0[:min_len],
    }


def _aggregate_to_windows(
    features: dict[str, np.ndarray],
    sr: int,
    window_sec: float,
    hop_sec: float,
    time_offset: float = 0.0,
) -> list[dict]:
    """Aggregate frame-level features into time windows."""
    frames_per_window = int(window_sec * sr / HOP_LENGTH)
    frames_per_hop = int(hop_sec * sr / HOP_LENGTH)
    n_frames = len(features["rms"])

    windows = []
    for start in range(0, n_frames - frames_per_window + 1, frames_per_hop):
        end = start + frames_per_window
        time = time_offset + start * HOP_LENGTH / sr

        # Pitch variance over the voiced frames of the window
        f0 = features["f0"][start:end]
        voiced = f0[~np.isnan(f0)]
        pitch_var = float(np.var(voiced)) if len(voiced) >= MIN_VOICED_FRAMES else 0.0

        window = {
            "time": time,
            "rms": float(np.mean(features["rms"][start:end])),
            "centroid": float(np.mean(features["centroid"][start:end])),
            "zcr": float(np.mean(features["zcr"][start:end])),
            "flux": float(np.mean(features["flux"][start:end])),
            "onset": float(np.mean(features["onset"][start:end])),
            "pitch_var": pitch_var,
        }
        windows.append(window)

    return windows


def analyze_audio(
    filepath: str,
    sr: int = DEFAULT_SR,
    window_sec: float = 5.0,
    hop_sec: float = 2.5,
) -> list[dict]:
    """Analyze audio file and return per-window features.

    For long files (>30min), processes in chunks to manage memory.
    """
    duration = librosa.get_duration(path=filepath)

    if duration <= CHUNK_DURATION:
        y, sr = librosa.load(filepath, sr=sr, mono=True)
        features = _extract_frame_features(y, sr)
        return _aggregate_to_windows(features, sr, window_sec, hop_sec)

    # Process in chunks for long VODs
    all_windows = []
    overlap_sec = window_sec

    offset = 0.0
    while offset < duration:
        chunk_dur = min(CHUNK_DURATION + overlap_sec, duration - offset)
        y, sr = librosa.load(filepath, sr=sr, mono=True, offset=offset, duration=chunk_dur)

        features = _extract_frame_features(y, sr)
        windows = _aggregate_to_windows(features, sr, window_sec, hop_sec, time_offset=offset)
        del y  # Free memory

        if all_windows and windows:
            last_time = all_windows[-1]["time"]
            windows = [w for w in windows if w["time"] > last_time]

        all_windows.extend(windows)
        offset += CHUNK_DURATION

    return all_windows
