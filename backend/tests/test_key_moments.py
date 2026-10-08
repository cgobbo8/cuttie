"""Key moments are timed to the second, on the clip's own clock."""

import json
import types

from app.models.schemas import HotPoint, KeyMoment, LlmAnalysis, SignalBreakdown
from app.services import llm_analyzer, pipeline
from app.services.transcript_format import format_labeled_transcript


def _w(word, start, speaker=None):
    out = {"word": word, "start": start, "end": start + 0.3}
    if speaker:
        out["speaker"] = speaker
    return out


def test_transcript_lines_follow_speakers_pauses_and_length():
    words = [_w("salut", 0.0, "Falkarst"), _w("chat", 0.4, "Falkarst"), _w("wesh", 1.0, "SPEAKER_01")]
    words += [_w("après", 4.0, "SPEAKER_01")]  # long pause: new line
    words += [_w(f"m{i}", 5.0 + i * 0.3, "SPEAKER_01") for i in range(16)]  # long turn: split
    lines = format_labeled_transcript(words).split("\n")
    assert lines[0] == "[0.0s] Falkarst: salut chat"
    assert lines[1] == "[1.0s] SPEAKER_01: wesh"
    assert lines[2].startswith("[4.0s] SPEAKER_01: après m0")
    assert len(lines) == 4 and lines[3].startswith("[8.9s] SPEAKER_01: m13")


def test_transcript_without_diarization_has_times_but_no_labels():
    assert format_labeled_transcript([_w("oh", 2.0), _w("non", 2.4)]) == "[2.0s] oh non"


class _FakeClient:
    base_url = types.SimpleNamespace(host="openrouter.ai")

    def __init__(self, content):
        message = types.SimpleNamespace(content=content)
        response = types.SimpleNamespace(choices=[types.SimpleNamespace(message=message, finish_reason="stop")])
        self.chat = types.SimpleNamespace(completions=types.SimpleNamespace(create=lambda **_: response))


def test_key_moment_times_are_kept_not_snapped_to_frames(monkeypatch):
    answer = {
        "clip_name": "Pneus Crevés",
        "virality_score": 0.7,
        "key_moments": [
            {"time": 58.4, "label": "Découverte des pneus crevés"},
            {"time": 9.6, "label": "Collision volontaire"},
            {"time": 80, "label": "Hors du clip"},
        ],
    }
    monkeypatch.setattr(llm_analyzer, "get_openrouter_client", lambda: _FakeClient(json.dumps(answer)))
    frames = [{"time": t, "path": "/nonexistent.jpg"} for t in (0.0, 13.0, 26.0, 39.0, 52.0, 65.0)]

    llm, _ = llm_analyzer._call_unified_llm(frames, "prompt", None, duration=65.0)

    assert [k.time for k in llm.key_moments] == [9.6, 58.4, 65.0]


def test_key_moments_move_onto_the_extracted_clip(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "CLIPS_DIR", str(tmp_path))
    job = tmp_path / "job"
    job.mkdir()
    # The LLM analyzed from 100 s; the clip was cut from 97 s, 60 s long
    (job / "pneus_meta.json").write_text(json.dumps({"vod_start": 97.0, "vod_end": 157.0}))
    hp = HotPoint(
        timestamp_seconds=120,
        timestamp_display="0:02:00",
        score=0.5,
        signals=SignalBreakdown(),
        clip_start=100.0,
        clip_end=165.0,
        clip_filename="pneus.mp4",
        llm=LlmAnalysis(key_moments=[KeyMoment(time=10.0, label="a"), KeyMoment(time=59.0, label="b")]),
    )

    pipeline._shift_key_moments("job", [hp])

    assert [k.time for k in hp.llm.key_moments] == [13.0, 60.0]
