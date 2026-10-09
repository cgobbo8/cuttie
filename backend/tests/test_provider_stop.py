"""An AI provider refusing every call (no credits, refused key) stops the analysis
with a clear message, instead of a silent fallback to the heuristic scores."""

import types

import httpx
import openai
import pytest

from app.services import llm_analyzer, pipeline, provider_errors, transcriber
from app.services.provider_errors import ProviderUnavailable, fatal_reason


def _status_error(status: int) -> openai.APIStatusError:
    response = httpx.Response(status, request=httpx.Request("POST", "https://openrouter.test"))
    return openai.APIStatusError(f"HTTP {status}", response=response, body=None)


def test_tells_refusals_for_good_from_the_rest():
    assert fatal_reason(_status_error(402)) == "credits"
    assert fatal_reason(_status_error(401)) == "key"
    # Rate limits, moderation, a provider down: worth a retry or another engine
    for status in (429, 403, 502, 503):
        assert fatal_reason(_status_error(status)) is None
    assert fatal_reason(TimeoutError()) is None
    assert fatal_reason(ProviderUnavailable("openrouter", "credits")) == "credits"
    assert "Crédits OpenRouter épuisés" in str(ProviderUnavailable("openrouter", "credits"))


class _Refusing:
    def __init__(self, error: Exception | None):
        self.error = error
        self.calls = 0

    def create(self, **_):
        self.calls += 1
        if self.error:
            raise self.error
        return types.SimpleNamespace(
            text="ok",
            segments=[types.SimpleNamespace(start=0.0, end=1.0, text="ok")],
            words=[types.SimpleNamespace(word="ok", start=0.0, end=0.4)],
        )


@pytest.fixture
def engines(tmp_path, monkeypatch):
    audio = tmp_path / "seg.mp3"
    audio.write_bytes(b"x")
    state = {"settings": {"groq_api_key": "g", "openrouter_api_key": "o"}, "audio": str(audio)}
    monkeypatch.setattr(transcriber.settings, "get", lambda key, env=None, default="": state["settings"].get(key, default))
    monkeypatch.setattr(transcriber, "local_backend", lambda: "cpu")
    monkeypatch.setattr(llm_analyzer._time, "sleep", lambda s: None)
    monkeypatch.setattr(llm_analyzer, "_whisper_gates", {e: llm_analyzer._RateGate() for e in transcriber.ENGINES})

    def use(groq: Exception | None, openrouter: Exception | None):
        state["groq"], state["openrouter"] = _Refusing(groq), _Refusing(openrouter)
        monkeypatch.setattr(transcriber, "get_groq_client", lambda: types.SimpleNamespace(audio=types.SimpleNamespace(transcriptions=state["groq"])))
        monkeypatch.setattr(transcriber, "get_openrouter_client", lambda: types.SimpleNamespace(audio=types.SimpleNamespace(transcriptions=state["openrouter"])))

    state["use"] = use
    return state


def test_whisper_stops_when_openrouter_has_no_credits(engines):
    engines["use"](groq=_status_error(402), openrouter=_status_error(402))
    with pytest.raises(ProviderUnavailable) as stop:
        llm_analyzer._transcribe_audio(engines["audio"])
    assert stop.value.reason == "credits"
    # Groq refusing its key still falls back on OpenRouter, which answers
    engines["use"](groq=_status_error(401), openrouter=None)
    text, *_ = llm_analyzer._transcribe_audio(engines["audio"])
    assert text == "ok"
    assert engines["groq"].calls == 1
    assert engines["openrouter"].calls == 1


def test_checks_openrouter_before_starting(monkeypatch):
    from app.services import openai_client

    def client(error):
        completions = types.SimpleNamespace(create=lambda **_: (_ for _ in ()).throw(error) if error else None)
        return types.SimpleNamespace(chat=types.SimpleNamespace(completions=completions))

    for error, expected in [(_status_error(402), "credits"), (_status_error(401), "key"), (_status_error(503), None), (None, None)]:
        monkeypatch.setattr(openai_client, "get_openrouter_client", lambda e=error: client(e))
        assert provider_errors.check_openrouter() == expected


def test_the_analysis_stops_with_what_to_do(tmp_path, monkeypatch):
    updates: list[dict] = []
    notices: list[dict] = []
    monkeypatch.setattr(pipeline, "work_dir", lambda *_: str(tmp_path / "audio"))
    monkeypatch.setattr(pipeline, "reset_notices", lambda job_id: None)
    monkeypatch.setattr(pipeline, "update_job", lambda job_id, **kw: updates.append(kw))
    monkeypatch.setattr(pipeline, "add_notice", lambda job_id, kind, **data: notices.append({"kind": kind, **data}))
    monkeypatch.setattr(pipeline, "check_openrouter", lambda: "credits")
    # Nothing gets downloaded
    monkeypatch.setattr(pipeline, "extract_metadata", lambda *_: pytest.fail("downloaded before checking the credits"))

    pipeline.run_pipeline_sync("job-1", "https://www.twitch.tv/videos/1")

    assert updates[-1]["status"] == "ERROR"
    assert "Crédits OpenRouter épuisés" in updates[-1]["error"]
    assert notices == [{"kind": "provider", "provider": "openrouter", "reason": "credits"}]
