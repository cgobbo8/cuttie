"""Audio feature extraction using librosa.

Analyzes audio in overlapping windows and extracts:
- RMS Energy (volume → cris, hype)
- Spectral Centroid (brightness → excited voice)
- Spectral Flux (sudden spectral changes → transitions)
- Pitch Variance via pyin (voice going up → excitement)
- Zero Crossing Rate (noise/screams detection)
"""

import librosa
import numpy as np

# Processing constants
DEFAULT_SR = 11025
FRAME_LENGTH = 2048
HOP_LENGTH = 512

# For very long VODs, process in chunks to manage memory
CHUNK_DURATION = 1800  # 30 minutes


def _compute_spectral_flux(y: np.ndarray) -> np.ndarray:
    """Compute spectral flux (rate of change in the power spectrum)."""
    S = np.abs(librosa.stft(y, n_fft=FRAME_LENGTH, hop_length=HOP_LENGTH))
    flux = np.sqrt(np.sum(np.diff(S, axis=1) ** 2, axis=0))
    # Pad to match other features' length
    return np.concatenate([[0], flux])


def _extract_frame_features(
    y: np.ndarray, sr: int, skip_pitch: bool = False
) -> dict[str, np.ndarray]:
    """Extract all frame-level features from an audio signal."""
    rms = librosa.feature.rms(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP_LENGTH)[0]
    zcr = librosa.feature.zero_crossing_rate(y=y, frame_length=FRAME_LENGTH, hop_length=HOP_LENGTH)[0]
    flux = _compute_spectral_flux(y)

    # Ensure all arrays have the same length (trim to shortest)
    min_len = min(len(rms), len(centroid), len(zcr), len(flux))
    features = {
        "rms": rms[:min_len],
        "centroid": centroid[:min_len],
        "zcr": zcr[:min_len],
        "flux": flux[:min_len],
    }

    if not skip_pitch:
        f0, voiced, _ = librosa.pyin(
            y,
            fmin=librosa.note_to_hz("C2"),
            fmax=librosa.note_to_hz("C7"),
            sr=sr,
            hop_length=HOP_LENGTH,
        )
        features["f0"] = f0[:min_len]
    else:
        features["f0"] = np.full(min_len, np.nan)

    return features


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

        window = {
            "time": time,
            "rms": float(np.mean(features["rms"][start:end])),
            "centroid": float(np.mean(features["centroid"][start:end])),
            "zcr": float(np.mean(features["zcr"][start:end])),
            "flux": float(np.mean(features["flux"][start:end])),
            "pitch_var": float(np.nanvar(features["f0"][start:end])),
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
    For very long files (>1h), skips pitch analysis (pyin is slow).
    """
    # Get duration without loading entire file
    duration = librosa.get_duration(path=filepath)
    skip_pitch = duration > 3600  # Skip pyin for VODs > 1h

    if duration <= CHUNK_DURATION:
        # Short enough to process in one go
        y, sr = librosa.load(filepath, sr=sr, mono=True)
        features = _extract_frame_features(y, sr, skip_pitch=skip_pitch)
        return _aggregate_to_windows(features, sr, window_sec, hop_sec)

    # Process in chunks for long VODs
    all_windows = []
    overlap_sec = window_sec  # Overlap chunks by one window to avoid edge artifacts

    offset = 0.0
    while offset < duration:
        chunk_dur = min(CHUNK_DURATION + overlap_sec, duration - offset)
        y, sr = librosa.load(filepath, sr=sr, mono=True, offset=offset, duration=chunk_dur)

        features = _extract_frame_features(y, sr, skip_pitch=skip_pitch)
        windows = _aggregate_to_windows(features, sr, window_sec, hop_sec, time_offset=offset)
        del y  # Free memory

        if all_windows and windows:
            # Remove overlapping windows from the new chunk
            last_time = all_windows[-1]["time"]
            windows = [w for w in windows if w["time"] > last_time]

        all_windows.extend(windows)
        offset += CHUNK_DURATION

    return all_windows
