"""Audio feature extraction using librosa.

Analyzes audio in overlapping windows and extracts:
- RMS Energy (volume → cris, hype)
- Spectral Centroid (brightness → excited voice)
- Spectral Flux (sudden spectral changes → transitions)
- Pitch Variance via pyin (voice going up → excitement)
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

# Pitch analysis on sampled windows instead of full signal (much faster)
PITCH_WINDOW_SEC = 5.0  # Analyze pitch in 5-second windows
PITCH_SAMPLE_EVERY = 5  # Analyze every Nth window (skip some for speed)


def _compute_spectral_flux(y: np.ndarray) -> np.ndarray:
    """Compute spectral flux (rate of change in the power spectrum)."""
    S = np.abs(librosa.stft(y, n_fft=FRAME_LENGTH, hop_length=HOP_LENGTH))
    flux = np.sqrt(np.sum(np.diff(S, axis=1) ** 2, axis=0))
    # Pad to match other features' length
    return np.concatenate([[0], flux])


def _extract_frame_features(y: np.ndarray, sr: int) -> dict[str, np.ndarray]:
    """Extract all frame-level features (except pitch) from an audio signal."""
    rms = librosa.feature.rms(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    flux = _compute_spectral_flux(y)

    # Onset strength: detects when excitement "starts" (transients, attacks)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP_LENGTH)

    # Ensure all arrays have the same length
    min_len = min(len(rms), len(centroid), len(zcr), len(flux), len(onset_env))
    return {
        "rms": rms[:min_len],
        "centroid": centroid[:min_len],
        "zcr": zcr[:min_len],
        "flux": flux[:min_len],
        "onset": onset_env[:min_len],
    }


def _compute_pitch_variance_for_window(y_window: np.ndarray, sr: int) -> float:
    """Compute pitch variance for a short audio window using pyin."""
    try:
        f0, _, _ = librosa.pyin(
            y_window,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
            hop_length=HOP_LENGTH,
        )
        var = float(np.nanvar(f0))
        return var if not np.isnan(var) else 0.0
    except Exception as e:
        logger.warning("Pitch variance computation failed for window: %s", e)
        return 0.0


def _aggregate_to_windows(
    features: dict[str, np.ndarray],
    y: np.ndarray,
    sr: int,
    window_sec: float,
    hop_sec: float,
    time_offset: float = 0.0,
    compute_pitch: bool = True,
) -> list[dict]:
    """Aggregate frame-level features into time windows, with sampled pitch analysis."""
    frames_per_window = int(window_sec * sr / HOP_LENGTH)
    frames_per_hop = int(hop_sec * sr / HOP_LENGTH)
    samples_per_window = int(window_sec * sr)
    n_frames = len(features["rms"])

    windows = []
    for idx, start in enumerate(range(0, n_frames - frames_per_window + 1, frames_per_hop)):
        end = start + frames_per_window
        time = time_offset + start * HOP_LENGTH / sr

        # Compute pitch only for sampled windows (every Nth)
        pitch_var = 0.0
        if compute_pitch and idx % PITCH_SAMPLE_EVERY == 0:
            sample_start = int(start * HOP_LENGTH)
            sample_end = min(sample_start + samples_per_window, len(y))
            if sample_end > sample_start:
                pitch_var = _compute_pitch_variance_for_window(y[sample_start:sample_end], sr)

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

    # Interpolate pitch for skipped windows
    if compute_pitch and PITCH_SAMPLE_EVERY > 1:
        _interpolate_pitch(windows)

    return windows


def _interpolate_pitch(windows: list[dict]) -> None:
    """Fill in pitch_var for skipped windows via linear interpolation."""
    n = len(windows)
    computed_indices = [i for i in range(n) if i % PITCH_SAMPLE_EVERY == 0]

    for ci in range(len(computed_indices) - 1):
        i_start = computed_indices[ci]
        i_end = computed_indices[ci + 1]
        v_start = windows[i_start]["pitch_var"]
        v_end = windows[i_end]["pitch_var"]

        for j in range(i_start + 1, i_end):
            t = (j - i_start) / (i_end - i_start)
            windows[j]["pitch_var"] = v_start + t * (v_end - v_start)


def analyze_audio(
    filepath: str,
    sr: int = DEFAULT_SR,
    window_sec: float = 5.0,
    hop_sec: float = 2.5,
) -> list[dict]:
    """Analyze audio file and return per-window features.

    For long files (>30min), processes in chunks to manage memory.
    Pitch is always computed but sampled (every Nth window) for speed.
    """
    duration = librosa.get_duration(path=filepath)

    if duration <= CHUNK_DURATION:
        y, sr = librosa.load(filepath, sr=sr, mono=True)
        features = _extract_frame_features(y, sr)
        return _aggregate_to_windows(features, y, sr, window_sec, hop_sec)

    # Process in chunks for long VODs
    all_windows = []
    overlap_sec = window_sec

    offset = 0.0
    while offset < duration:
        chunk_dur = min(CHUNK_DURATION + overlap_sec, duration - offset)
        y, sr = librosa.load(filepath, sr=sr, mono=True, offset=offset, duration=chunk_dur)

        features = _extract_frame_features(y, sr)
        windows = _aggregate_to_windows(
            features, y, sr, window_sec, hop_sec, time_offset=offset
        )
        del y  # Free memory

        if all_windows and windows:
            last_time = all_windows[-1]["time"]
            windows = [w for w in windows if w["time"] > last_time]

        all_windows.extend(windows)
        offset += CHUNK_DURATION

    return all_windows
