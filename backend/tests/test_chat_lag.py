"""Chat timing: how late chat reacts, and viewers asking for a clip."""

import numpy as np

from app.services.chat_analyzer import DEFAULT_CHAT_LAG, analyze_chat, estimate_chat_lag
from app.services.scorer import compute_scores

HOP = 2.5


def _audio(n: int, spikes: list[int]) -> list[dict]:
    rng = np.random.default_rng(1)
    feats = []
    for i in range(n):
        base = rng.normal(0.2, 0.02)
        hit = 1.0 if i in spikes else 0.0
        feats.append({
            "time": i * HOP, "rms": base + hit, "flux": base + hit, "onset": base + hit,
            "centroid": 0.3, "zcr": 0.1, "pitch_var": 0.1,
        })
    return feats


def _chat(n: int, spikes: list[int], lag_windows: int) -> list[dict]:
    rng = np.random.default_rng(2)
    feats = []
    for i in range(n):
        speed = 0.2 + rng.random() * 0.1 + (2.0 if (i - lag_windows) in spikes else 0.0)
        feats.append({"time": i * HOP, "chat_speed": speed})
    return feats


def test_finds_how_late_chat_reacts():
    n = 1440  # one hour
    spikes = list(range(30, n - 20, 47))
    lag = estimate_chat_lag(_audio(n, spikes), _chat(n, spikes, lag_windows=3))
    assert lag == 3 * HOP


def test_falls_back_when_chat_is_too_quiet():
    n = 1440
    audio = _audio(n, [100, 400])
    quiet = [{"time": i * HOP, "chat_speed": 0.0} for i in range(n)]
    assert estimate_chat_lag(audio, quiet) == DEFAULT_CHAT_LAG
    assert estimate_chat_lag(audio[:50], quiet[:50]) == DEFAULT_CHAT_LAG


def test_collects_viewers_asking_for_a_clip():
    messages = [
        {"timestamp": 101.0, "author": "a", "text": "CLIP"},
        {"timestamp": 102.0, "author": "a", "text": "clip it"},
        {"timestamp": 103.0, "author": "b", "text": "clippez ça"},
        {"timestamp": 103.5, "author": "c", "text": "eclipse incoming"},
        {"timestamp": 104.0, "author": "nightbot", "text": "clip"},
    ]
    windows = analyze_chat(messages, 200)
    asked = set().union(*(set(w["clip_requesters"]) for w in windows))
    assert asked == {"a", "b"}


def test_clip_requests_after_a_moment_raise_it():
    n = 240
    # Two identical moments
    audio = _audio(n, [40, 41, 42, 160, 161, 162])
    chat = [{"time": i * HOP, "chat_speed": 0.2, "clip_requesters": []} for i in range(n)]
    # Two viewers ask for a clip ~10 s after the second one (chat lag 5 s)
    chat[165]["clip_requesters"] = ["a"]
    chat[166]["clip_requesters"] = ["a", "b"]
    hps = compute_scores(audio, chat, total_duration=n * HOP, top_n=50, chat_lag=5.0)
    near = lambda t: min(hps, key=lambda hp: abs(hp.timestamp_seconds - t))
    asked = near(161 * HOP)
    plain = near(41 * HOP)
    assert abs(asked.timestamp_seconds - 161 * HOP) <= 3 * HOP
    assert abs(plain.timestamp_seconds - 41 * HOP) <= 3 * HOP
    assert hps[0] is asked
    assert asked.signals.clip_requests == 2
    assert plain.signals.clip_requests == 0
    assert asked.score > plain.score
