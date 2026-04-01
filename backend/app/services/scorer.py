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

# Default weights for composite score (base signals, total = 1.0)
# Bonus signals (agreement, classification, sentiment) are multiplicative, not additive
WEIGHTS = {
    "rms": 0.18,
    "chat_speed": 0.18,
    "flux": 0.12,
    "onset": 0.10,       # Onset strength: catches moment transitions
    "pitch_var": 0.10,
    "centroid": 0.05,
    "zcr": 0.02,
    # Chat signals
    "chat_burst": 0.10,
    "emote_density": 0.08,
    "caps_ratio": 0.07,
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
    """Baseline-relative normalization to [0, 1].

    Uses median as baseline and clips at 95th percentile.
    This gives more meaningful scores than min-max: a quiet stream
    won't have artificial 100% peaks.
    """
    clean = np.nan_to_num(arr, nan=0.0)
    baseline = np.median(clean)
    ceiling = np.percentile(clean, 95)
    if ceiling - baseline < 1e-8:
        return np.zeros_like(clean)
    normed = (clean - baseline) / (ceiling - baseline)
    return np.clip(normed, 0.0, 1.0)


def compute_scores(
    audio_features: list[dict],
    chat_features: list[dict],
    total_duration: float = 0,
    top_n: int = 20,
    hop_sec: float = 2.5,
    classification_features: list[dict] | None = None,
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
    onset = np.array([w.get("onset", 0) for w in audio_features])
    pitch_var = np.array([w["pitch_var"] for w in audio_features])

    # Build chat arrays aligned to audio time grid
    chat_speed = np.zeros(n)
    chat_burst = np.zeros(n)
    emote_density = np.zeros(n)
    caps_ratio = np.zeros(n)
    sentiment_intensity = np.zeros(n)
    dominant_moods: list[str] = [""] * n

    if chat_features:
        chat_times_arr = np.array([c["time"] for c in chat_features])
        chat_arrays = {
            "chat_speed": np.array([c["chat_speed"] for c in chat_features]),
            "chat_burst": np.array([c.get("chat_burst", 0) for c in chat_features]),
            "emote_density": np.array([c.get("emote_density", 0) for c in chat_features]),
            "caps_ratio": np.array([c.get("caps_ratio", 0) for c in chat_features]),
            "sentiment_intensity": np.array([c.get("sentiment_intensity", 0) for c in chat_features]),
        }
        chat_moods = [c.get("dominant_mood", "") for c in chat_features]
        for i, t in enumerate(times):
            diffs = np.abs(chat_times_arr - t)
            nearest = np.argmin(diffs)
            if diffs[nearest] < hop_sec:
                chat_speed[i] = chat_arrays["chat_speed"][nearest]
                chat_burst[i] = chat_arrays["chat_burst"][nearest]
                emote_density[i] = chat_arrays["emote_density"][nearest]
                caps_ratio[i] = chat_arrays["caps_ratio"][nearest]
                sentiment_intensity[i] = chat_arrays["sentiment_intensity"][nearest]
                dominant_moods[i] = chat_moods[nearest]

    # Align audio classification features (speech, excitement, game)
    speech_presence = np.zeros(n)
    vocal_excitement = np.zeros(n)
    game_audio = np.zeros(n)

    if classification_features:
        cls_times = np.array([c["time"] for c in classification_features])
        cls_speech = np.array([c["speech_presence"] for c in classification_features])
        cls_excite = np.array([c["vocal_excitement"] for c in classification_features])
        cls_game = np.array([c["game_audio"] for c in classification_features])
        for i, t in enumerate(times):
            diffs = np.abs(cls_times - t)
            nearest = np.argmin(diffs)
            if diffs[nearest] < hop_sec:
                speech_presence[i] = cls_speech[nearest]
                vocal_excitement[i] = cls_excite[nearest]
                game_audio[i] = cls_game[nearest]

    # Normalize all signals to [0, 1]
    norm = {
        "rms": _normalize(rms),
        "chat_speed": _normalize(chat_speed),
        "flux": _normalize(flux),
        "onset": _normalize(onset),
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

    # ── Multiplicative modifiers (boost peaks, don't inflate baseline) ──

    # Signal agreement: when audio AND chat both spike, multiply score
    audio_combined = (norm["rms"] + norm["flux"]) / 2
    chat_combined = norm["chat_speed"]
    agreement = audio_combined * chat_combined  # high only when both high
    # Boost up to 1.3x when both signals agree
    score *= 1.0 + 0.3 * _normalize(agreement)

    # Semantic sentiment: boost when chat shows strong sentiment
    norm_sentiment = _normalize(sentiment_intensity)
    has_sentiment = np.any(sentiment_intensity > 0.05)
    if has_sentiment:
        score *= 1.0 + 0.15 * norm_sentiment

    # Audio classification signals (PANNs CNN14)
    has_classification = np.any(speech_presence > 0.05)
    if has_classification:
        norm_speech = _normalize(speech_presence)
        norm_excite = _normalize(vocal_excitement)
        norm_game = _normalize(game_audio)

        # Boost: loud + streamer speaking = streamer is reacting
        voice_energy = norm_speech * norm["rms"]
        score *= 1.0 + 0.15 * _normalize(voice_energy)

        # Strong boost: vocal excitement (laughter, screaming) — rare but gold
        # Additive here is OK because it's genuinely rare and should spike
        score += 0.10 * norm_excite

        # Dampen: loud game audio without speech = just game noise
        game_only = np.clip(norm_game - norm_speech, 0, 1)
        score *= 1.0 - 0.15 * game_only

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
                    vocal_excitement=round(float(vocal_excitement[idx]), 3),
                    speech_presence=round(float(speech_presence[idx]), 3),
                ),
                chat_mood=dominant_moods[idx],
            )
        )

    return hot_points
