"""Voice reference passages, and Whisper surviving rate limits."""

import types

import httpx
import pytest
from openai import RateLimitError

from app.services import llm_analyzer
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
    def __init__(self, failures: int):
        self.failures = failures
        self.calls = 0

    def create(self, **_):
        self.calls += 1
        if self.calls <= self.failures:
            response = httpx.Response(429, headers={"retry-after": "2"}, request=httpx.Request("POST", "https://groq.test"))
            raise RateLimitError("rate limited", response=response, body=None)
        return types.SimpleNamespace(
            text="clip ça",
            segments=[types.SimpleNamespace(start=0.0, end=1.0, text="clip ça")],
            words=[types.SimpleNamespace(word="clip", start=0.0, end=0.4), types.SimpleNamespace(word="ça", start=0.5, end=0.8)],
        )


def _client(transcriptions):
    return types.SimpleNamespace(audio=types.SimpleNamespace(transcriptions=transcriptions))


def test_whisper_waits_out_rate_limits(tmp_path, monkeypatch):
    audio = tmp_path / "seg.mp3"
    audio.write_bytes(b"x")
    transcriptions = _Transcriptions(failures=2)
    monkeypatch.setattr(llm_analyzer, "get_groq_client", lambda: _client(transcriptions))
    waits: list[float] = []
    monkeypatch.setattr(llm_analyzer._time, "sleep", lambda s: waits.append(s))
    monkeypatch.setattr(llm_analyzer, "_whisper_gate", llm_analyzer._RateGate())

    text, _rate, _segments, words = llm_analyzer._transcribe_audio(str(audio))

    assert text == "clip ça" and len(words) == 2
    assert transcriptions.calls == 3
    assert waits and max(waits) <= 2.5


def test_whisper_reports_a_segment_it_could_not_transcribe(tmp_path, monkeypatch):
    audio = tmp_path / "seg.mp3"
    audio.write_bytes(b"x")
    monkeypatch.setattr(llm_analyzer, "get_groq_client", lambda: _client(_Transcriptions(failures=99)))
    monkeypatch.setattr(llm_analyzer._time, "sleep", lambda s: None)
    monkeypatch.setattr(llm_analyzer, "_whisper_gate", llm_analyzer._RateGate())
    with pytest.raises(llm_analyzer.TranscriptionFailed):
        llm_analyzer._transcribe_audio(str(audio))
