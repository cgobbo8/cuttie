"""Voice reference passages, and Whisper surviving rate limits."""

import types

import httpx
import pytest
from openai import RateLimitError

from app.services import llm_analyzer, transcriber
from app.services.speaker_diarizer import pick_voice_reference


def test_learns_the_voice_from_speech_dense_passages_not_the_start():
    duration = 3600.0
    windows = []
    for i in range(int(duration / 5)):
        t = i * 5.0
        talking = 600 <= t < 700 or 1800 <= t < 1900 or 3000 <= t < 3100
        intro_music = t < 180
        windows.append({"time": t, "speech_presence": 0.9 if talking else 0.2, "game_audio": 0.8 if intro_music else 0.1})
    starts = pick_voice_reference(windows, duration)
    assert len(starts) == 3
    assert all(any(a <= s < b for a, b in [(600, 700), (1800, 1900), (3000, 3100)]) for s in starts)
    assert pick_voice_reference([], duration) == []


class _Transcriptions:
    """A provider that refuses `failures` times (429 with Retry-After) then answers"""

    def __init__(self, failures: int, retry_after: str = "2", error: Exception | None = None):
        self.failures = failures
        self.retry_after = retry_after
        self.error = error
        self.calls = 0

    def create(self, **_):
        self.calls += 1
        if self.error:
            raise self.error
        if self.calls <= self.failures:
            response = httpx.Response(429, headers={"retry-after": self.retry_after}, request=httpx.Request("POST", "https://stt.test"))
            raise RateLimitError("rate limited", response=response, body=None)
        return types.SimpleNamespace(
            text="clip ça",
            segments=[types.SimpleNamespace(start=0.0, end=1.0, text="clip ça")],
            words=[types.SimpleNamespace(word="clip", start=0.0, end=0.4), types.SimpleNamespace(word="ça", start=0.5, end=0.8)],
        )


def _client(transcriptions):
    return types.SimpleNamespace(audio=types.SimpleNamespace(transcriptions=transcriptions))


@pytest.fixture
def stt(tmp_path, monkeypatch):
    """Both cloud engines faked, keys configurable, no real waiting"""
    audio = tmp_path / "seg.mp3"
    audio.write_bytes(b"x")
    state = {"settings": {"groq_api_key": "g", "openrouter_api_key": "o"}, "groq": _Transcriptions(0), "openrouter": _Transcriptions(0), "waits": []}
    monkeypatch.setattr(transcriber.settings, "get", lambda key, env=None, default="": state["settings"].get(key, default))
    monkeypatch.setattr(transcriber, "get_groq_client", lambda: _client(state["groq"]))
    monkeypatch.setattr(transcriber, "get_openrouter_client", lambda: _client(state["openrouter"]))
    # A computer that is slow at Whisper (no Apple chip, no NVIDIA GPU): "auto" goes to the cloud
    monkeypatch.setattr(transcriber, "local_backend", lambda: "cpu")
    monkeypatch.setattr(llm_analyzer._time, "sleep", lambda s: state["waits"].append(s))
    monkeypatch.setattr(llm_analyzer, "_whisper_gates", {e: llm_analyzer._RateGate() for e in transcriber.ENGINES})
    state["audio"] = str(audio)
    return state


def test_picks_groq_with_a_key_else_the_chosen_engine(stt):
    assert transcriber.chosen_engine() == "groq"
    stt["settings"]["transcription"] = "local"
    assert transcriber.chosen_engine() == "local"
    del stt["settings"]["groq_api_key"]
    stt["settings"]["transcription"] = "groq"  # no key: can't
    assert transcriber.chosen_engine() == "openrouter"
    stt["settings"]["transcription"] = "auto"
    assert transcriber.chosen_engine() == "openrouter"


def test_auto_runs_on_this_computer_when_it_is_fast(stt, monkeypatch):
    for backend in ("mlx", "cuda"):
        monkeypatch.setattr(transcriber, "local_backend", lambda b=backend: b)
        assert transcriber.chosen_engine() == "local"
    # Asked for explicitly, the cloud wins
    stt["settings"]["transcription"] = "openrouter"
    assert transcriber.chosen_engine() == "openrouter"


def test_whisper_waits_out_short_rate_limits(stt):
    stt["groq"] = _Transcriptions(failures=2, retry_after="2")
    text, _rate, _segments, words = llm_analyzer._transcribe_audio(stt["audio"])
    assert text == "clip ça" and len(words) == 2
    assert stt["groq"].calls == 3 and stt["openrouter"].calls == 0
    assert stt["waits"] and max(stt["waits"]) <= 2.5


def test_openrouter_takes_over_when_groq_makes_us_wait_long(stt):
    stt["groq"] = _Transcriptions(failures=99, retry_after="60")
    text, *_ = llm_analyzer._transcribe_audio(stt["audio"])
    assert text == "clip ça"
    assert stt["groq"].calls == 1 and stt["openrouter"].calls == 1
    # The next segments go straight to OpenRouter while Groq is paused
    llm_analyzer._transcribe_audio(stt["audio"])
    assert stt["groq"].calls == 1 and stt["openrouter"].calls == 2


def test_openrouter_takes_over_when_groq_errors(stt):
    stt["groq"] = _Transcriptions(0, error=RuntimeError("boom"))
    assert llm_analyzer._transcribe_audio(stt["audio"])[0] == "clip ça"
    assert stt["openrouter"].calls == 1


def test_whisper_reports_a_segment_nobody_could_transcribe(stt):
    stt["settings"] = {"openrouter_api_key": "o"}
    stt["openrouter"] = _Transcriptions(failures=99, retry_after="1")
    with pytest.raises(llm_analyzer.TranscriptionFailed):
        llm_analyzer._transcribe_audio(stt["audio"])


def test_words_look_the_same_whatever_the_engine():
    import numpy as np

    words = [
        {"word": " l", "start": np.float64(4.64), "end": 4.68},
        {"word": "'hôpital", "start": 4.7, "end": 5.1},
        {"word": " vite", "start": 5.2, "end": 5.5},
        {"word": " !", "start": 5.5, "end": 5.6},
        {"word": "  ", "start": 5.6, "end": 5.7},
    ]
    tidy = transcriber.tidy_words(words)
    assert tidy == [{"word": "l'hôpital", "start": 4.64, "end": 5.1}, {"word": "vite!", "start": 5.2, "end": 5.6}]
    assert type(tidy[0]["start"]) is float
