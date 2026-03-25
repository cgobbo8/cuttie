"""Composite scoring and peak detection.

Combines normalized audio and chat signals into a single score per window,
then detects peaks with minimum distance between them.
"""

import numpy as np
from scipy.signal import find_peaks

from app.models.schemas import HotPoint, SignalBreakdown

# Default weights for composite score
WEIGHTS = {
    "rms": 0.25,
    "chat_speed": 0.25,
    "flux": 0.20,
    "pitch_var": 0.15,
    "centroid": 0.10,
    "zcr": 0.05,
}

# If pitch is unavailable (skipped for long VODs), redistribute its weight
WEIGHTS_NO_PITCH = {
    "rms": 0.30,
    "chat_speed": 0.30,
    "flux": 0.20,
    "pitch_var": 0.0,
    "centroid": 0.10,
    "zcr": 0.10,
}

# Minimum distance between peaks in seconds
MIN_PEAK_DISTANCE_SEC = 60.0


def seconds_to_display(s: float) -> str:
    h, remainder = divmod(int(s), 3600)
    m, sec = divmod(remainder, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _normalize(arr: np.ndarray) -> np.ndarray:
    """Min-max normalize to [0, 1], handling NaN and edge cases."""
    # Replace NaN with 0 before normalizing
    clean = np.nan_to_num(arr, nan=0.0)
    mn = np.min(clean)
    mx = np.max(clean)
    if mx - mn < 1e-8:
        return np.zeros_like(clean)
    return (clean - mn) / (mx - mn)


def compute_scores(
    audio_features: list[dict],
    chat_features: list[dict],
    total_duration: float = 0,
    top_n: int = 20,
    hop_sec: float = 2.5,
) -> list[HotPoint]:
    """Compute composite scores and detect peak hot points.

    Args:
        audio_features: List of dicts with time, rms, centroid, zcr, flux, pitch_var
        chat_features: List of dicts with time, chat_speed
        total_duration: VOD duration in seconds
        top_n: Maximum number of hot points to return
        hop_sec: Hop between windows in seconds (for peak distance calculation)

    Returns:
        List of HotPoint sorted by score descending
    """
    if not audio_features:
        return []

    n = len(audio_features)

    # Extract audio signals
    times = np.array([w["time"] for w in audio_features])
    rms = np.array([w["rms"] for w in audio_features])
    centroid = np.array([w["centroid"] for w in audio_features])
    zcr = np.array([w["zcr"] for w in audio_features])
    flux = np.array([w["flux"] for w in audio_features])
    pitch_var = np.array([w["pitch_var"] for w in audio_features])

    # Build chat speed array aligned to audio time grid
    chat_speed = np.zeros(n)
    if chat_features:
        chat_times_arr = np.array([c["time"] for c in chat_features])
        chat_speeds_arr = np.array([c["chat_speed"] for c in chat_features])
        for i, t in enumerate(times):
            # Find nearest chat window (within hop_sec tolerance)
            diffs = np.abs(chat_times_arr - t)
            nearest = np.argmin(diffs)
            if diffs[nearest] < hop_sec:
                chat_speed[i] = chat_speeds_arr[nearest]

    # Normalize all signals to [0, 1]
    norm = {
        "rms": _normalize(rms),
        "chat_speed": _normalize(chat_speed),
        "flux": _normalize(flux),
        "pitch_var": _normalize(pitch_var),
        "centroid": _normalize(centroid),
        "zcr": _normalize(zcr),
    }

    # Check if pitch was actually computed (all NaN means it was skipped)
    has_pitch = not np.all(np.isnan(pitch_var))
    weights = WEIGHTS if has_pitch else WEIGHTS_NO_PITCH

    # Compute composite score
    score = np.zeros(n)
    for signal_name, weight in weights.items():
        score += weight * norm[signal_name]

    # Find peaks with minimum distance
    min_distance = max(1, int(MIN_PEAK_DISTANCE_SEC / hop_sec))
    peak_indices, properties = find_peaks(score, distance=min_distance, prominence=0.05)

    if len(peak_indices) == 0:
        # Fallback: just take the top scoring windows
        peak_indices = np.argsort(score)[::-1][:top_n]

    # Sort by score descending and take top N
    sorted_peaks = sorted(peak_indices, key=lambda i: score[i], reverse=True)[:top_n]

    # Build HotPoint objects
    hot_points = []
    for idx in sorted_peaks:
        hot_points.append(
            HotPoint(
                timestamp_seconds=round(float(times[idx]), 1),
                timestamp_display=seconds_to_display(times[idx]),
                score=round(float(score[idx]), 3),
                signals=SignalBreakdown(
                    rms=round(float(norm["rms"][idx]), 3),
                    spectral_flux=round(float(norm["flux"][idx]), 3),
                    pitch_variance=round(float(norm["pitch_var"][idx]), 3),
                    spectral_centroid=round(float(norm["centroid"][idx]), 3),
                    zcr=round(float(norm["zcr"][idx]), 3),
                    chat_speed=round(float(norm["chat_speed"][idx]), 3),
                ),
            )
        )

    return hot_points
