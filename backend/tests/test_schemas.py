"""Test Pydantic schemas validation."""

import pytest
from pydantic import ValidationError

from app.models.schemas import (
    AnalyzeRequest,
    HotPoint,
    JobResponse,
    JobStatus,
    KeyMoment,
    LlmAnalysis,
    SignalBreakdown,
    StepTiming,
)


class TestJobStatus:
    def test_all_pipeline_statuses_are_valid(self):
        """All expected pipeline statuses should be valid enum members."""
        valid_statuses = [
            "PENDING",
            "DOWNLOADING_AUDIO",
            "DOWNLOADING_CHAT",
            "ANALYZING_AUDIO",
            "ANALYZING_CHAT",
            "SCORING",
            "ANALYZING_CLIPS",
            "CLIPPING",
            "LLM_ANALYSIS",
            "DONE",
            "ERROR",
        ]
        for status in valid_statuses:
            assert JobStatus(status).value == status

    def test_invalid_status_raises(self):
        """An unknown status string should raise a ValueError."""
        with pytest.raises(ValueError):
            JobStatus("INVALID_STATUS")

    def test_status_is_str_enum(self):
        """JobStatus members should behave as strings."""
        assert JobStatus.DONE == "DONE"
        assert isinstance(JobStatus.PENDING, str)


class TestSignalBreakdown:
    def test_defaults_to_zero(self):
        """All fields should default to 0.0."""
        s = SignalBreakdown()
        assert s.rms == 0.0
        assert s.spectral_flux == 0.0
        assert s.pitch_variance == 0.0
        assert s.spectral_centroid == 0.0
        assert s.zcr == 0.0
        assert s.chat_speed == 0.0

    def test_explicit_values(self):
        s = SignalBreakdown(rms=0.8, spectral_flux=0.5, chat_speed=1.2)
        assert s.rms == 0.8
        assert s.spectral_flux == 0.5
        assert s.chat_speed == 1.2


class TestLlmAnalysis:
    def test_defaults(self):
        llm = LlmAnalysis()
        assert llm.transcript == ""
        assert llm.speech_rate == 0.0
        assert llm.category == ""
        assert llm.virality_score == 0.0
        assert llm.summary == ""
        assert llm.is_clipable is True
        assert llm.key_moments == []
        assert llm.narrative == ""

    def test_with_key_moments(self):
        km = KeyMoment(time=12.5, label="big play", description="clutch moment")
        llm = LlmAnalysis(key_moments=[km])
        assert len(llm.key_moments) == 1
        assert llm.key_moments[0].label == "big play"


class TestHotPoint:
    def test_minimal_construction(self):
        hp = HotPoint(
            timestamp_seconds=120.5,
            timestamp_display="00:02:00",
            score=0.85,
            signals=SignalBreakdown(),
        )
        assert hp.timestamp_seconds == 120.5
        assert hp.final_score is None
        assert hp.clip_filename is None
        assert hp.vertical_filename is None
        assert hp.llm is None
        assert hp.chat_mood == ""
        assert hp.clip_name == ""

    def test_with_final_score_and_llm(self):
        hp = HotPoint(
            timestamp_seconds=60.0,
            timestamp_display="00:01:00",
            score=0.5,
            final_score=0.72,
            signals=SignalBreakdown(rms=0.9),
            llm=LlmAnalysis(virality_score=0.8, category="clutch"),
        )
        assert hp.final_score == 0.72
        assert hp.llm.virality_score == 0.8
        assert hp.llm.category == "clutch"


class TestAnalyzeRequest:
    def test_valid_url(self):
        req = AnalyzeRequest(url="https://www.twitch.tv/videos/123456")
        assert req.url == "https://www.twitch.tv/videos/123456"

    def test_missing_url_raises(self):
        with pytest.raises(ValidationError):
            AnalyzeRequest()


class TestJobResponse:
    def test_minimal_response(self):
        jr = JobResponse(job_id="abc-123", status=JobStatus.PENDING)
        assert jr.job_id == "abc-123"
        assert jr.status == JobStatus.PENDING
        assert jr.hot_points is None
        assert jr.error is None
        assert jr.step_timings is None

    def test_full_response(self):
        jr = JobResponse(
            job_id="xyz",
            status=JobStatus.DONE,
            progress="10/10",
            vod_title="Stream title",
            vod_game="Fortnite",
            vod_duration_seconds=7200.0,
            streamer="streamer_name",
            view_count=1500,
            stream_date="2026-03-15",
            step_timings={"SCORING": StepTiming(start=1000.0, duration_seconds=5.2)},
            hot_points=[],
        )
        assert jr.vod_title == "Stream title"
        assert jr.step_timings["SCORING"].duration_seconds == 5.2


class TestStepTiming:
    def test_in_progress(self):
        """A step in progress has no duration yet."""
        st = StepTiming(start=1711648000.0)
        assert st.duration_seconds is None

    def test_completed(self):
        st = StepTiming(start=1711648000.0, duration_seconds=12.3)
        assert st.duration_seconds == 12.3
