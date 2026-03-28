"""Test the scoring and normalization logic."""

import numpy as np
import pytest

from app.services.scorer import WEIGHTS, _normalize, compute_scores, seconds_to_display


class TestNormalize:
    def test_basic_normalization(self):
        """Values above the median should get positive scores, capped at 1.0."""
        arr = np.array([0.0, 1.0, 2.0, 3.0, 10.0])
        result = _normalize(arr)
        assert result.shape == arr.shape
        # All values should be in [0, 1]
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_all_zeros(self):
        """Array of all zeros should normalize to all zeros (no variance)."""
        arr = np.zeros(10)
        result = _normalize(arr)
        np.testing.assert_array_equal(result, np.zeros(10))

    def test_constant_values(self):
        """Constant values (no variance) should normalize to all zeros."""
        arr = np.full(10, 5.0)
        result = _normalize(arr)
        np.testing.assert_array_equal(result, np.zeros(10))

    def test_handles_nan(self):
        """NaN values should be treated as zero."""
        arr = np.array([np.nan, 1.0, 2.0, 3.0, 4.0])
        result = _normalize(arr)
        assert not np.any(np.isnan(result))
        assert np.all(result >= 0.0)
        assert np.all(result <= 1.0)

    def test_median_is_zero_point(self):
        """Values at or below the median should normalize to 0."""
        arr = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
        result = _normalize(arr)
        median_val = np.median(arr)  # 5.5
        # Values below the median should be clipped to 0
        for i, v in enumerate(arr):
            if v <= median_val:
                assert result[i] == 0.0

    def test_high_values_clipped_at_one(self):
        """Values above the 95th percentile should be clipped to 1.0."""
        arr = np.concatenate([np.zeros(95), np.array([100.0, 200.0, 300.0, 400.0, 500.0])])
        result = _normalize(arr)
        # The extreme outliers should be clipped at 1.0
        assert result[-1] == 1.0

    def test_single_element(self):
        """A single-element array should normalize to zero (no variance)."""
        arr = np.array([42.0])
        result = _normalize(arr)
        np.testing.assert_array_equal(result, np.zeros(1))

    def test_tiny_variance(self):
        """When ceiling - baseline < 1e-8, should return zeros."""
        arr = np.array([1.0, 1.0, 1.0 + 1e-10])
        result = _normalize(arr)
        np.testing.assert_array_equal(result, np.zeros(3))


class TestWeights:
    def test_weights_sum_to_one(self):
        """Base signal weights should sum to approximately 1.0."""
        total = sum(WEIGHTS.values())
        assert abs(total - 1.0) < 1e-6, f"Weights sum to {total}, expected 1.0"

    def test_all_weights_positive(self):
        """All weights should be strictly positive."""
        for name, weight in WEIGHTS.items():
            assert weight > 0, f"Weight for '{name}' is not positive: {weight}"

    def test_expected_signals_present(self):
        """All expected signal names should be in the weights dict."""
        expected = {
            "rms", "chat_speed", "flux", "onset", "pitch_var",
            "centroid", "zcr", "chat_burst", "emote_density", "caps_ratio",
        }
        assert set(WEIGHTS.keys()) == expected


class TestSecondsToDisplay:
    def test_zero(self):
        assert seconds_to_display(0) == "00:00:00"

    def test_simple_minutes(self):
        assert seconds_to_display(125) == "00:02:05"

    def test_hours(self):
        assert seconds_to_display(3661) == "01:01:01"

    def test_float_truncates(self):
        assert seconds_to_display(59.9) == "00:00:59"


class TestComputeScores:
    def _make_audio_features(self, n: int, spike_at: int | None = None):
        """Create dummy audio features with an optional spike."""
        features = []
        for i in range(n):
            val = 0.1
            if spike_at is not None and i == spike_at:
                val = 1.0
            features.append({
                "time": i * 2.5,
                "rms": val,
                "centroid": val,
                "zcr": val,
                "flux": val,
                "onset": val,
                "pitch_var": val,
            })
        return features

    def test_empty_features_returns_empty(self):
        """No audio features should produce no hot points."""
        assert compute_scores([], []) == []

    def test_returns_hot_points(self):
        """Should return HotPoint objects with valid fields."""
        audio = self._make_audio_features(100, spike_at=50)
        result = compute_scores(audio, [], top_n=5)
        assert len(result) > 0
        assert len(result) <= 5
        for hp in result:
            assert hp.timestamp_seconds >= 0
            assert hp.score >= 0
            assert hp.signals is not None

    def test_spike_detected_near_top(self):
        """A clear, sustained spike in all signals should appear in the top results."""
        # Build a wide spike (indices 95-105) so it survives Gaussian smoothing
        audio = self._make_audio_features(200, spike_at=None)
        for i in range(95, 106):
            for key in ("rms", "centroid", "zcr", "flux", "onset", "pitch_var"):
                audio[i][key] = 1.0
        result = compute_scores(audio, [], top_n=10)
        timestamps = [hp.timestamp_seconds for hp in result]
        spike_center = 100 * 2.5  # 250.0
        # Allow tolerance due to smoothing shifting the peak slightly
        close_enough = any(abs(t - spike_center) <= 20.0 for t in timestamps)
        assert close_enough, f"Spike near {spike_center}s not found in top results: {timestamps}"

    def test_with_chat_features(self):
        """Should incorporate chat features without error."""
        audio = self._make_audio_features(50)
        chat = [
            {"time": i * 2.5, "chat_speed": 0.5, "chat_burst": 0.0,
             "emote_density": 0.0, "caps_ratio": 0.0, "sentiment_intensity": 0.0,
             "dominant_mood": ""}
            for i in range(50)
        ]
        result = compute_scores(audio, chat, top_n=5)
        assert len(result) > 0

    def test_top_n_respected(self):
        """Should never return more than top_n results."""
        audio = self._make_audio_features(200)
        result = compute_scores(audio, [], top_n=3)
        assert len(result) <= 3

    def test_scores_are_non_negative(self):
        """All returned scores should be non-negative."""
        audio = self._make_audio_features(100)
        result = compute_scores(audio, [], top_n=10)
        for hp in result:
            assert hp.score >= 0

    def test_with_classification_features(self):
        """Should handle audio classification features (PANNs) without error."""
        audio = self._make_audio_features(50)
        classification = [
            {"time": i * 2.5, "speech_presence": 0.3, "vocal_excitement": 0.1, "game_audio": 0.2}
            for i in range(50)
        ]
        result = compute_scores(audio, [], top_n=5, classification_features=classification)
        assert len(result) > 0
