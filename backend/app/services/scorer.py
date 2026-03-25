"""Composite scoring and peak detection.

Combines normalized audio and chat signals into a single score per window,
then detects peaks with minimum distance between them.

Improvements over v1:
- Score smoothing (Gaussian) before peak detection for cleaner peaks
- Chat burst and emote density as additional signals
- Signal agreement bonus (when audio + chat both spike)
"""

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

from app.models.schemas import HotPoint, SignalBreakdown

# Default weights for composite score
WEIGHTS = {
    "rms": 0.20,
    "chat_speed": 0.20,
    "flux": 0.15,
    "pitch_var": 0.12,
    "centroid": 0.08,
    "zcr": 0.03,
    # New chat signals
    "chat_burst": 0.10,
    "emote_density": 0.07,
    "caps_ratio": 0.05,
}

# Minimum distance between peaks in seconds
MIN_PEAK_DISTANCE_SEC = 60.0

# Smoothing sigma (in windows). ~3 windows = 7.5s smoothing at 2.5s hop
SMOOTH_SIGMA = 2.5


def seconds_to_display(s: float) -> str:
    h, remainder = divmod(int(s), 3600)
    m, sec = divmod(remainder, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}"


def _normalize(arr: np.ndarray) -> np.ndarray:
    """Min-max normalize to [0, 1], handling NaN and edge cases."""
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
    """Compute composite scores and detect peak hot points."""
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

    # Build chat arrays aligned to audio time grid
    chat_speed = np.zeros(n)
    chat_burst = np.zeros(n)
    emote_density = np.zeros(n)
    caps_ratio = np.zeros(n)

    if chat_features:
        chat_times_arr = np.array([c["time"] for c in chat_features])
        chat_arrays = {
            "chat_speed": np.array([c["chat_speed"] for c in chat_features]),
            "chat_burst": np.array([c.get("chat_burst", 0) for c in chat_features]),
            "emote_density": np.array([c.get("emote_density", 0) for c in chat_features]),
            "caps_ratio": np.array([c.get("caps_ratio", 0) for c in chat_features]),
        }
        for i, t in enumerate(times):
            diffs = np.abs(chat_times_arr - t)
            nearest = np.argmin(diffs)
            if diffs[nearest] < hop_sec:
                chat_speed[i] = chat_arrays["chat_speed"][nearest]
                chat_burst[i] = chat_arrays["chat_burst"][nearest]
                emote_density[i] = chat_arrays["emote_density"][nearest]
                caps_ratio[i] = chat_arrays["caps_ratio"][nearest]

    # Normalize all signals to [0, 1]
    norm = {
        "rms": _normalize(rms),
        "chat_speed": _normalize(chat_speed),
        "flux": _normalize(flux),
        "pitch_var": _normalize(pitch_var),
        "centroid": _normalize(centroid),
        "zcr": _normalize(zcr),
        "chat_burst": _normalize(chat_burst),
        "emote_density": _normalize(emote_density),
        "caps_ratio": _normalize(caps_ratio),
    }

    # Compute composite score
    score = np.zeros(n)
    for signal_name, weight in WEIGHTS.items():
        score += weight * norm[signal_name]

    # Signal agreement bonus: when audio AND chat both spike, boost score
    audio_combined = (norm["rms"] + norm["flux"]) / 2
    chat_combined = norm["chat_speed"]
    agreement = audio_combined * chat_combined  # high only when both high
    score += 0.15 * _normalize(agreement)

    # Smooth score curve for cleaner peak detection
    score_smooth = gaussian_filter1d(score, sigma=SMOOTH_SIGMA)

    # Find peaks on smoothed curve with minimum distance
    min_distance = max(1, int(MIN_PEAK_DISTANCE_SEC / hop_sec))
    peak_indices, _ = find_peaks(score_smooth, distance=min_distance, prominence=0.05)

    if len(peak_indices) == 0:
        peak_indices = np.argsort(score_smooth)[::-1][:top_n]

    # Sort by smoothed score descending and take top N
    sorted_peaks = sorted(peak_indices, key=lambda i: score_smooth[i], reverse=True)[:top_n]

    # Build HotPoint objects (use raw score for display, smoothed for ranking)
    hot_points = []
    for idx in sorted_peaks:
        hot_points.append(
            HotPoint(
                timestamp_seconds=round(float(times[idx]), 1),
                timestamp_display=seconds_to_display(times[idx]),
                score=round(float(score_smooth[idx]), 3),
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
