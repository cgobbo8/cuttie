"""Live analysis timeline: intensity curve, chat activity, candidate entries."""

from types import SimpleNamespace

from app.services import timeline


def test_energy_curve_is_normalized_and_evenly_sampled():
    # 1 h of quiet talk with one loud minute in the middle
    windows = [{"time": t, "rms": 0.3 if 1800 <= t < 1860 else 0.02} for t in range(0, 3600, 5)]
    curve = timeline.energy_curve(windows, 3600, points=120)
    assert len(curve) == 120
    assert all(0 <= v <= 1 for v in curve)
    peak = curve.index(max(curve))
    assert 55 <= peak <= 63  # the loud minute sits at the middle of the live
    assert curve[5] < 0.2


def test_energy_curve_handles_no_audio():
    assert timeline.energy_curve([], 3600) == []


def test_chat_histogram_counts_messages_per_slice():
    messages = [{"timestamp": t} for t in (10, 20, 1790, 1795, 1799, 3599)] + [{"text": "no time"}]
    counts = timeline.chat_histogram(messages, 3600, bins=4)
    assert counts == [2, 3, 0, 1]


def test_candidate_entry():
    hp = SimpleNamespace(
        timestamp_seconds=9044.31,
        final_score=0.7469,
        clip_name="Sauvetage Helico Fail",
        llm=SimpleNamespace(category="fail"),
    )
    assert timeline.candidate(hp, "kept") == {
        "t": 9044.3,
        "state": "kept",
        "score": 0.747,
        "name": "Sauvetage Helico Fail",
        "category": "fail",
    }
    pending = SimpleNamespace(timestamp_seconds=12.0, final_score=None, clip_name="", llm=None)
    assert timeline.candidate(pending, "pending") == {"t": 12.0, "state": "pending"}
