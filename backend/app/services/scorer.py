"""Composite scoring and peak detection.

Combines normalized audio and chat signals into a single score per window,
then detects peaks with minimum distance between them.

Improvements over v1:
- Score smoothing (Gaussian) before peak detection for cleaner peaks
- Chat burst and emote density as additional signals
- Signal agreement bonus (when audio + chat both spike)
"""

from dataclasses import dataclass

import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks

from app.models.schemas import HotPoint, SignalBreakdown

# Default weights for composite score (base signals, total = 1.0)
# Bonus signals (agreement, classification, sentiment) are multiplicative, not additive
WEIGHTS = {
    "rms": 0.10,           # Volume alone is weak (loud != interesting)
    "chat_speed": 0.18,
    "flux": 0.12,
    "onset": 0.14,         # Onset strength: catches sudden sounds (screams, impacts)
    "pitch_var": 0.14,     # Voice pitch variation: streamer getting excited
    "centroid": 0.05,
    "zcr": 0.02,
    # Chat signals
    "chat_burst": 0.10,
    "emote_density": 0.08,
    "caps_ratio": 0.07,
}
# Note: vocal_excitement is added separately as a strong additive bonus (0.25)
# outside of these base weights — see classification section below

# Viewers asking for a clip: strong evidence, even on a small chat
CLIP_REQUEST_WEIGHT = 0.3
CLIP_REQUEST_FULL = 2  # requesters for the full bonus
CLIP_REQUEST_SPAN = 20.0  # seconds after the (lag-corrected) moment they can ask in

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


@dataclass
class ScoreTrack:
    """The live window by window: normalized signals and the smoothed composite score."""

    times: np.ndarray
    norm: dict[str, np.ndarray]
    excitement: np.ndarray
    speech: np.ndarray
    clip_requests: np.ndarray
    moods: list[str]
    score: np.ndarray

    def breakdown(self, idx: int) -> SignalBreakdown:
        """What the signals said at window `idx`."""
        return SignalBreakdown(
            rms=round(float(self.norm["rms"][idx]), 3),
            spectral_flux=round(float(self.norm["flux"][idx]), 3),
            pitch_variance=round(float(self.norm["pitch_var"][idx]), 3),
            spectral_centroid=round(float(self.norm["centroid"][idx]), 3),
            zcr=round(float(self.norm["zcr"][idx]), 3),
            chat_speed=round(float(self.norm["chat_speed"][idx]), 3),
            vocal_excitement=round(float(self.excitement[idx]), 3),
            speech_presence=round(float(self.speech[idx]), 3),
            clip_requests=int(self.clip_requests[max(0, idx - 2) : idx + 3].max()),
        )

    def signals_between(self, start: float, end: float) -> tuple[SignalBreakdown, str]:
        """A passage found otherwise (by the AI, "clip" said): its strongest window's signals, as a peak's."""
        inside = np.where((self.times >= start) & (self.times <= end))[0]
        if len(inside) == 0:
            inside = np.array([int(np.argmin(np.abs(self.times - (start + end) / 2)))])
        idx = int(inside[np.argmax(self.score[inside])])
        return self.breakdown(idx), self.moods[idx]


def compute_scores(
    audio_features: list[dict],
    chat_features: list[dict],
    total_duration: float = 0,
    top_n: int = 20,
    hop_sec: float = 2.5,
    classification_features: list[dict] | None = None,
    chat_lag: float = 0.0,
) -> list[HotPoint]:
    """Compute composite scores and detect peak hot points.

    Chat reacts `chat_lag` seconds after what happens on stream: the chat
    window at t + chat_lag scores the moment at t.
    """
    track = score_track(audio_features, chat_features, hop_sec, classification_features, chat_lag)
    return peaks(track, top_n, hop_sec) if track else []


def score_track(
    audio_features: list[dict],
    chat_features: list[dict],
    hop_sec: float = 2.5,
    classification_features: list[dict] | None = None,
    chat_lag: float = 0.0,
) -> ScoreTrack | None:
    """The composite score of every window of the live, and the signals behind it."""
    if not audio_features:
        return None

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
    clip_requests = np.zeros(n)

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
        requesters = [c.get("clip_requesters", []) for c in chat_features]
        for i, t in enumerate(times):
            # Viewers asking for a clip in the seconds after the moment (each counted once)
            span = (chat_times_arr >= t + chat_lag) & (chat_times_arr < t + chat_lag + CLIP_REQUEST_SPAN)
            clip_requests[i] = len({a for j in np.where(span)[0] for a in requesters[j]})
            diffs = np.abs(chat_times_arr - (t + chat_lag))
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
    norm_speech = _normalize(speech_presence) if has_classification else np.zeros(n)
    norm_excite = _normalize(vocal_excitement) if has_classification else np.zeros(n)
    norm_game = _normalize(game_audio) if has_classification else np.zeros(n)

    if has_classification:

        # Boost: loud + streamer speaking = streamer is reacting
        voice_energy = norm_speech * norm["rms"]
        score *= 1.0 + 0.15 * _normalize(voice_energy)

        # Strong boost: vocal excitement (laughter, screaming) — rare but gold
        # Additive and high weight: this is the strongest signal for virality
        score += 0.25 * norm_excite

        # Dampen: loud game audio without speech = just game noise
        game_only = np.clip(norm_game - norm_speech, 0, 1)
        score *= 1.0 - 0.15 * game_only

    # Viewers asked for a clip: additive, like vocal excitement
    score += CLIP_REQUEST_WEIGHT * np.clip(clip_requests / CLIP_REQUEST_FULL, 0, 1)

    # Smooth score curve for cleaner peak detection
    return ScoreTrack(
        times=times,
        norm=norm,
        excitement=norm_excite,
        speech=norm_speech,
        clip_requests=clip_requests,
        moods=dominant_moods,
        score=gaussian_filter1d(score, sigma=SMOOTH_SIGMA),
    )


def peaks(track: ScoreTrack, top_n: int = 20, hop_sec: float = 2.5) -> list[HotPoint]:
    """The top_n peaks of the live's score, at least MIN_PEAK_DISTANCE_SEC apart."""
    score_smooth = track.score

    # Find peaks on smoothed curve with minimum distance
    min_distance = max(1, int(MIN_PEAK_DISTANCE_SEC / hop_sec))
    peak_indices, _ = find_peaks(score_smooth, distance=min_distance, prominence=0.05)

    if len(peak_indices) == 0:
        peak_indices = np.argsort(score_smooth)[::-1][:top_n]

    # Sort by smoothed score descending and take top N
    sorted_peaks = sorted(peak_indices, key=lambda i: score_smooth[i], reverse=True)[:top_n]

    return [
        HotPoint(
            timestamp_seconds=round(float(track.times[idx]), 1),
            timestamp_display=seconds_to_display(track.times[idx]),
            score=round(float(score_smooth[idx]), 3),
            signals=track.breakdown(idx),
            chat_mood=track.moods[idx],
        )
        for idx in sorted_peaks
    ]
