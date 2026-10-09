"""The whole live transcribed once, read for the pre-sort: windows, "clip" said
anywhere, chunks cached and resumed."""

import subprocess

import pytest

from app.models.schemas import HotPoint, SignalBreakdown
from app.services import llm_analyzer, transcriber, vod_transcript
from app.services.llm_analyzer import MAX_KEYWORD_MOMENTS, TranscriptionFailed, _from_live_transcript, _keyword_moments
from app.services.vod_transcript import VodTranscript


def test_reads_a_window_of_the_live():
    tr = VodTranscript(
        segments=[(10.0, 12.0, " Bon on y va"), (58.0, 61.0, " attention"), (90.0, 92.0, " trop tard")],
        words=[{"word": "attention", "start": 59.0, "end": 60.0}],
    )
    text, segments, words = tr.window(50.0, 80.0)
    assert text == "attention"
    assert segments == [(8.0, 11.0, " attention")]
    assert words == [{"word": "attention", "start": 9.0, "end": 10.0}]
    # A candidate reads its own window, with a speech rate
    hp = HotPoint(timestamp_seconds=60.0, timestamp_display="0:01:00", score=0.5, signals=SignalBreakdown(), clip_start=50.0, clip_end=80.0)
    text, rate, start, *_ = _from_live_transcript(tr, hp, 3600.0)
    assert (text, start) == ("attention", 50.0)
    assert rate == pytest.approx(1 / 30)


def test_finds_clip_requests_anywhere_in_the_live():
    segments = [
        (100.0, 102.0, " clip ça clip ça"),
        (130.0, 131.0, " CLIP !"),  # same burst: the last one counts
        (900.0, 902.0, " j'ai regardé tes clips hier"),
        (2000.0, 2001.0, " il faut clipper ça"),
        (2500.0, 2501.0, " une éclipse"),  # not the word
    ]
    assert _keyword_moments(VodTranscript(segments=segments)) == [130.5, 901.0, 2000.5]
    # Too many: requests first, then the earliest mentions, in time order
    many = [(i * 100.0, i * 100.0 + 1, " les clips") for i in range(30)] + [(5000.0, 5001.0, " clip ça")]
    moments = _keyword_moments(VodTranscript(segments=many))
    assert len(moments) == MAX_KEYWORD_MOMENTS
    assert 5000.5 in moments
    assert moments == sorted(moments)


@pytest.fixture
def live(tmp_path, monkeypatch):
    """A 5-second "live" cut in 2-second chunks, transcribed by a fake engine"""
    wav = tmp_path / "live.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "5", str(wav)], check=True)
    calls: list[dict] = []
    state = {"fail": set(), "calls": calls}

    def fake_transcribe(path, engine=None, words=True):
        calls.append({"engine": engine, "words": words})
        if len(calls) in state["fail"]:
            raise TranscriptionFailed("nobody could")
        return "salut", 1.0, [(0.5, 1.5, " salut")], ([{"word": "salut", "start": 0.5, "end": 1.0}] if words else [])

    monkeypatch.setattr(vod_transcript, "CHUNK_SECONDS", 2.0)
    monkeypatch.setattr(vod_transcript, "transcript_dir", lambda job_id: str(tmp_path / "transcripts" / job_id))
    monkeypatch.setattr(llm_analyzer, "_transcribe_audio", fake_transcribe)
    monkeypatch.setattr(transcriber, "chosen_engine", lambda: "local")
    state["wav"] = str(wav)
    return state


def test_transcribes_the_live_by_chunks_and_resumes(live):
    progress: list[tuple[int, int]] = []
    tr = vod_transcript.transcribe_vod("job-1", live["wav"], 5.0, on_chunk=lambda d, t: progress.append((d, t)))
    # 3 chunks (0-2, 2-4, 4-5 s), times moved onto the live, this computer without word timings
    assert [s for s, _e, _t in tr.segments] == [0.5, 2.5, 4.5]
    assert tr.words == [] and all(c["words"] is False for c in live["calls"])
    assert progress[-1] == (3, 3) and tr.failed == 0
    # A retry (or a restart) picks the chunks up from disk
    again = vod_transcript.transcribe_vod("job-1", live["wav"], 5.0)
    assert len(live["calls"]) == 3
    assert again.segments == tr.segments


def test_counts_the_chunks_nobody_could_transcribe(live):
    live["fail"].add(2)
    tr = vod_transcript.transcribe_vod("job-2", live["wav"], 5.0)
    assert (tr.failed, tr.total, len(tr.segments)) == (1, 3, 2)


def test_squashes_whisper_loops_on_music():
    assert vod_transcript.squash_repeats("I was a a a a a a a a the the the the the I was") == "I was a a a the the the I was"
    # Real repetitions stay
    assert vod_transcript.squash_repeats("non non non !") == "non non non !"

