"""The local test (Settings > Diagnostic): how fast this computer transcribes, or the exact error."""

from app.services import local_check, transcriber


def test_reports_the_speed_or_the_exact_error(monkeypatch):
    monkeypatch.setattr(transcriber, "local_backend", lambda: "cuda")
    monkeypatch.setattr(transcriber, "transcribe", lambda path, engine, words=True: transcriber.Transcript(""))
    report = local_check._whisper()
    assert report["backend"] == "cuda" and "error" not in report
    assert report["realtime"] > 0

    def missing_dll(path, engine, words=True):
        raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")

    monkeypatch.setattr(transcriber, "transcribe", missing_dll)
    report = local_check._whisper()
    assert report["error"] == "RuntimeError: Library cublas64_12.dll is not found or cannot be loaded"


def test_reports_when_the_voice_model_cannot_load(monkeypatch):
    from app.services import speaker_diarizer

    def offline():
        raise OSError("Hugging Face unreachable")

    monkeypatch.setattr(speaker_diarizer, "_get_embedder", offline)
    assert local_check._voices() == {"error": "OSError: Hugging Face unreachable"}
