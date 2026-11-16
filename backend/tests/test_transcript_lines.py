"""A transcript is made of lines the length of a sentence, whatever the engine.

The AI that searches a live picks a passage by its first and last lines. An NVIDIA card
used to give one line per 30 seconds of speech (625 lines for a 7-hour live where an Apple
chip gives 8,000): the AI could only pick half minutes. The model is now asked for its
timestamps, long lines are cut on their dated words, and a live transcribed before is told
apart and transcribed again, once.
"""

import json
import os
import subprocess

import pytest

from app.services import live_search, llm_analyzer, transcriber, vod_transcript
from app.services.llm_analyzer import TranscriptionFailed


def _words(text: str, start: float, each: float = 0.4, gap: float = 0.05) -> list[dict]:
    """`text` said from `start`, one word every `each` seconds."""
    out = []
    for i, word in enumerate(text.split()):
        at = start + i * (each + gap)
        out.append({"word": word, "start": round(at, 3), "end": round(at + each, 3)})
    return out


# ── Lines cut on words ───────────────────────────────────────────────────────


def test_dated_words_are_cut_into_lines_the_way_speech_falls():
    # The end of a sentence ends a line
    said = _words("Ok ce soir j'ai pris mes responsabilités. Du coup je suis en code 6", 10.0)
    assert [t for _s, _e, t in transcriber.lines_from_words(said)] == ["Ok ce soir j'ai pris mes responsabilités.", "Du coup je suis en code 6"]
    # So does a silence between two words, with the times of the words themselves
    paused = _words("il y a une chance", 0.0) + _words("que tu répondes", 5.0)
    lines = transcriber.lines_from_words(paused)
    assert [(s, t) for s, _e, t in lines] == [(0.0, "il y a une chance"), (5.0, "que tu répondes")]
    assert lines[0][1] == paused[4]["end"]
    # Talk without a stop is cut anyway: no line much over LINE_SECONDS, sooner on a comma
    flood = _words(" ".join(["alors"] * 60), 0.0)
    assert max(e - s for s, e, _t in transcriber.lines_from_words(flood)) <= transcriber.LINE_SECONDS + 0.5
    comma = _words("un deux trois quatre cinq six sept huit, neuf dix onze douze", 0.0)
    assert transcriber.lines_from_words(comma)[0][2].endswith("huit,")
    # A one-word answer is not a line of its own, nothing said gives nothing
    assert [t for _s, _e, t in transcriber.lines_from_words(_words("Oui. Je te dis oui", 0.0))] == ["Oui. Je te dis oui"]
    assert transcriber.lines_from_words([]) == []


def test_a_line_too_long_for_a_sentence_is_cut_on_its_words():
    monologue = "Ok ce soir j'ai pris mes responsabilités pour une fois. " * 6
    dated = _words(monologue, 100.0)
    long = (100.0, dated[-1]["end"], " " + monologue.strip())
    short = (200.0, 202.0, " Bonsoir Ralen.")
    lines = transcriber.split_long([long, short], dated + _words("Bonsoir Ralen.", 200.0))
    # The half minute became sentences, in order, all its words kept; the short line is untouched
    assert len(lines) == 7 and lines[-1] == short
    assert " ".join(t for _s, _e, t in lines[:-1]) == monologue.strip()
    assert all(e - s < transcriber.LONG_LINE for s, e, _t in lines)
    assert lines[0][0] == 100.0 and lines[5][1] == dated[-1]["end"]
    # A long line with little said (the time spans a silence) stays whole
    quiet = (300.0, 314.0, " Pardon ? Vous rigolez, monsieur ?")
    assert transcriber.split_long([quiet], _words("Pardon ? Vous rigolez, monsieur ?", 300.0)) == [quiet]
    # Without dated words, or when the line's own are missing, nothing changes
    assert transcriber.split_long([long], []) == [long]
    assert transcriber.split_long([long], _words("autre chose ailleurs", 900.0)) == [long]


# ── The NVIDIA path ──────────────────────────────────────────────────────────


def test_the_nvidia_path_asks_the_model_for_its_timestamps(monkeypatch):
    import faster_whisper

    asked = {}

    class Pipeline:
        def __init__(self, model):
            pass

        def transcribe(self, audio, **options):
            asked.update(options)
            return iter([]), None

    monkeypatch.setattr(faster_whisper, "BatchedInferencePipeline", Pipeline)
    monkeypatch.setattr(transcriber, "_batch_size", 4)
    transcriber._transcribe_cuda(object(), [], words=True)
    # Left to itself the batched pipeline gives one line per 30 seconds of speech
    assert asked["without_timestamps"] is False
    assert asked["word_timestamps"] is True and asked["vad_filter"] is True


def test_what_faster_whisper_gives_becomes_lines_and_dated_words():
    class Word:
        def __init__(self, word, start, end):
            self.word, self.start, self.end = word, start, end

    class Segment:
        def __init__(self, start, end, text, words=None):
            self.start, self.end, self.text, self.words = start, end, text, words

    monologue = "Ok ce soir j'ai pris mes responsabilités pour une fois. " * 6
    dated = [Word(" " + w["word"], w["start"], w["end"]) for w in _words(monologue, 0.0)]
    tr = transcriber._transcript_of(iter([Segment(0.0, dated[-1].end, " " + monologue, dated), Segment(40.0, 41.0, " Bonsoir.", [Word(" Bonsoir.", 40.0, 41.0)])]))
    # One 27-second segment and a short one: seven lines, every word dated, the text whole
    assert len(tr.segments) == 7 and tr.segments[-1] == (40.0, 41.0, " Bonsoir.")
    assert len(tr.words) == len(monologue.split()) + 1 and tr.words[0] == {"word": "Ok", "start": 0.0, "end": 0.4}
    assert tr.text == f"{monologue.strip()} Bonsoir."
    # Without word timings (an Apple chip on a whole live) the lines are the model's own
    assert transcriber._transcript_of([Segment(0.0, 2.0, " Salut")]).segments == [(0.0, 2.0, " Salut")]


def test_only_an_nvidia_card_dates_the_words_of_a_whole_live(monkeypatch):
    for backend, dated in (("cuda", True), ("mlx", False), ("cpu", False)):
        monkeypatch.setattr(transcriber, "local_backend", lambda backend=backend: backend)
        assert transcriber.whole_live_words() is dated


# ── A live transcribed in half-minute lines ──────────────────────────────────

HALF_MINUTE = " ".join(["alors"] * 70)


@pytest.fixture
def live(tmp_path, monkeypatch):
    """A 5-second "live" in 2-second chunks, its sound "downloaded" again from a file, a fake engine."""
    wav = tmp_path / "live.wav"
    subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "5", str(wav)], check=True)
    state = {"calls": [], "fail": set(), "downloads": [], "folder": tmp_path / "transcripts"}

    def fake_transcribe(path, engine=None, words=True):
        state["calls"].append({"engine": engine, "words": words})
        if len(state["calls"]) in state["fail"]:
            raise TranscriptionFailed("nobody could")
        return "salut toi", 1.0, [(0.2, 0.9, " salut"), (1.0, 1.6, " toi")], [{"word": "salut", "start": 0.2, "end": 0.9}, {"word": "toi", "start": 1.0, "end": 1.6}]

    def fake_download(url, folder):
        state["downloads"].append(url)
        if url == "gone":
            raise RuntimeError("the live left Twitch")
        os.makedirs(folder, exist_ok=True)
        return str(wav)

    from app.services import downloader, paths

    monkeypatch.setattr(vod_transcript, "CHUNK_SECONDS", 2.0)
    monkeypatch.setattr(vod_transcript, "transcript_dir", lambda job_id: str(state["folder"] / job_id))
    monkeypatch.setattr(llm_analyzer, "_transcribe_audio", fake_transcribe)
    monkeypatch.setattr(downloader, "download_audio", fake_download)
    monkeypatch.setattr(paths, "work_dir", lambda *parts: str(tmp_path / "work" / "_".join(parts)))
    monkeypatch.setattr(transcriber, "chosen_engine", lambda: "openrouter")
    monkeypatch.setattr(transcriber, "local_backend", lambda: "cuda")
    return state


def _write(state, job_id: str, chunks: list[dict]) -> None:
    folder = state["folder"] / job_id
    folder.mkdir(parents=True, exist_ok=True)
    for i, chunk in enumerate(chunks):
        (folder / f"chunk_{i:03d}.json").write_text(json.dumps(chunk), encoding="utf-8")


def _coarse(start: float) -> dict:
    """A chunk as an NVIDIA card wrote it up to 0.2.5: one line per half minute, no dated word."""
    return {"start": start, "segments": [[start, start + 27.0, HALF_MINUTE], [start + 30.0, start + 58.0, HALF_MINUTE]], "words": []}


def _read(state, job_id: str, index: int) -> dict:
    return json.loads((state["folder"] / job_id / f"chunk_{index:03d}.json").read_text(encoding="utf-8"))


def test_a_live_in_half_minute_lines_is_told_apart(live):
    _write(live, "nvidia", [_coarse(0.0), _coarse(600.0), _coarse(1200.0)])
    assert vod_transcript.coarse_chunks("nvidia") == [0, 1, 2]
    shape = vod_transcript.shape(vod_transcript.load_cached("nvidia").segments)
    assert (shape["lines"], shape["median"], shape["long"], shape["words"]) == (6, 28.0, 1.0, 0)
    assert "6 lines of 28.0 s" in vod_transcript.told(shape) and "100%" in vod_transcript.told(shape)
    # An Apple chip: sentences, a rare long line, no dated word either: left alone
    sentences = [[i * 3.0, i * 3.0 + 2.0, "bon là franchement c'est calme"] for i in range(150)] + [[500.0, 520.0, HALF_MINUTE]]
    _write(live, "apple", [{"start": 0.0, "segments": sentences, "words": []}])
    assert vod_transcript.coarse_chunks("apple") == []
    # A cloud engine: long lines but every word dated (the search cuts on the words): left alone
    _write(live, "groq", [{**_coarse(0.0), "words": [{"word": "alors", "start": 0.0, "end": 0.3}]}])
    assert vod_transcript.coarse_chunks("groq") == []
    # Written since lines are sentences, or never transcribed at all: nothing to do
    _write(live, "new", [{**_coarse(0.0), "lines": vod_transcript.LINES}])
    assert vod_transcript.coarse_chunks("new") == [] and vod_transcript.coarse_chunks("unknown") == []


def test_a_live_in_half_minute_lines_is_transcribed_again_once(live):
    _write(live, "job", [_coarse(0.0), _coarse(2.0), _coarse(4.0)])
    progress = []
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1", on_chunk=lambda done, total: progress.append((done, total))) is True
    # Its sound came back once, this computer did every chunk again (whatever the settings' engine), words dated on an NVIDIA card
    assert live["downloads"] == ["https://twitch.tv/videos/1"]
    assert live["calls"] == [{"engine": "local", "words": True}] * 3 and progress[-1] == (3, 3)
    tr = vod_transcript.load_cached("job")
    assert [round(s, 1) for s, _e, _t in tr.segments] == [0.2, 1.0, 2.2, 3.0, 4.2, 5.0] and len(tr.words) == 6
    assert _read(live, "job", 1)["lines"] == vod_transcript.LINES
    # Done for good: neither told apart nor downloaded again
    assert vod_transcript.coarse_chunks("job") == []
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1") is False and len(live["downloads"]) == 1
    # The sound it downloaded is not left on the disk
    assert not any(name.endswith(".wav") for _root, _dirs, files in os.walk(live["folder"].parent / "work") for name in files)


def test_a_chunk_that_cannot_be_done_again_keeps_what_it_had(live):
    _write(live, "job", [_coarse(0.0), _coarse(2.0), _coarse(4.0)])
    live["fail"].add(2)
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1") is True
    done = [_read(live, "job", i).get("lines") == vod_transcript.LINES for i in range(3)]
    assert sorted(done) == [False, True, True]
    # Nothing was lost: the chunk that failed still says its half minutes
    assert any(t == HALF_MINUTE for _s, _e, t in vod_transcript.load_cached("job").segments)
    # One pass, not one at every question
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1") is False and len(live["downloads"]) == 1


def test_a_live_that_cannot_be_transcribed_again_stays_as_it_was(live, monkeypatch):
    _write(live, "job", [_coarse(0.0), _coarse(2.0)])
    before = vod_transcript.load_cached("job").segments
    # The live left Twitch: nothing changes, and it will be tried again
    assert vod_transcript.refine("job", "gone") is False
    assert vod_transcript.load_cached("job").segments == before and vod_transcript.coarse_chunks("job") == [0, 1]
    # No link to the live, or no fast engine on this computer: not even downloaded
    assert vod_transcript.refine("job", None) is False
    monkeypatch.setattr(transcriber, "local_backend", lambda: "cpu")
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1") is False
    assert live["downloads"] == ["gone"] and live["calls"] == []


def test_a_pass_that_was_interrupted_picks_up_where_it_stopped(live):
    _write(live, "job", [_coarse(0.0), {"start": 2.0, "lines": vod_transcript.LINES, "segments": [[2.2, 2.9, " salut"]], "words": []}, _coarse(4.0)])
    # The chunk already done again is not counted with the half minutes, nor done a third time
    assert vod_transcript.coarse_chunks("job") == [0, 2]
    assert vod_transcript.refine("job", "https://twitch.tv/videos/1") is True
    assert len(live["calls"]) == 2 and vod_transcript.coarse_chunks("job") == []


def test_a_new_analysis_writes_sentences_and_dates_words_on_an_nvidia_card(live, monkeypatch):
    wav = str(live["folder"].parent / "live.wav")
    monkeypatch.setattr(transcriber, "chosen_engine", lambda: "local")
    tr = vod_transcript.transcribe_vod("fresh", wav, 5.0)
    assert live["calls"] == [{"engine": "local", "words": True}] * 3 and len(tr.words) == 6
    assert _read(live, "fresh", 0)["lines"] == vod_transcript.LINES and vod_transcript.coarse_chunks("fresh") == []
    # An Apple chip still skips word timings on a whole live (2.5x faster without)
    monkeypatch.setattr(transcriber, "local_backend", lambda: "mlx")
    live["calls"].clear()
    vod_transcript.transcribe_vod("mac", wav, 5.0)
    assert live["calls"] == [{"engine": "local", "words": False}] * 3


# ── Before the AI works ──────────────────────────────────────────────────────


def test_a_live_in_half_minute_lines_is_transcribed_again_before_the_ai_reads_it(monkeypatch):
    from app.services import live_ideas

    events = []
    said = []

    def refine(job_id, url, on_chunk=None):
        events.append(("refine", job_id, url))
        on_chunk(12, 41)
        return True

    def read(job_id):
        events.append(("read", job_id))
        return None  # the test stops there: what matters is what came first

    monkeypatch.setattr(vod_transcript, "coarse_chunks", lambda job_id: [0, 1] if job_id in ("old", "older") else [])
    monkeypatch.setattr(vod_transcript, "refine", refine)
    monkeypatch.setattr(live_search, "load_cached", read)
    monkeypatch.setattr(live_ideas, "load_cached", read)
    monkeypatch.setattr(live_search, "_tell", lambda job_id, step, detail="": said.append((job_id, step, detail)))
    url = "https://twitch.tv/videos/1"

    # Every way the AI is sent to a live: the lines first, then the transcript (and the answers kept by its lines)
    asks = [
        lambda: live_search.search_ai("old", "le calme", {}, 3600.0, url=url),
        lambda: live_search.plan_video("old", "le calme puis la tempête", 90.0, {}, 3600.0, url=url),
        lambda: live_search.revise_video("old", "le calme", [], [], "plus court", 3600.0, url=url),
        lambda: live_ideas.suggest_videos("old", {}, 3600.0, url=url),
    ]
    for ask in asks:
        events.clear()
        with pytest.raises(live_search.NoTranscript):
            ask()
        assert events == [("refine", "old", url), ("read", "old")]
    # The app is told, with how far it is, and nothing is left on screen once it is done
    assert said[:2] == [("old", "relistening", ""), ("old", "relistening", "12/41")]
    assert live_search.doing("old") is None

    # A video made from several lives: each of them, said on the screen of the one being worked on
    events.clear()
    with pytest.raises(live_search.NoTranscript):
        live_search.plan_video("fine", "le calme", 90.0, {}, 3600.0, url=url, others=[{"job_id": "older", "url": "https://twitch.tv/videos/0", "duration": 100.0}])
    assert events == [("refine", "older", "https://twitch.tv/videos/0"), ("read", "fine")]
    # A live already in sentences, or one whose link is unknown, goes straight to the AI
    for ask in (lambda: live_search.search_ai("fine", "le calme", {}, 3600.0, url=url), lambda: live_search.search_ai("old", "le calme", {}, 3600.0)):
        events.clear()
        with pytest.raises(live_search.NoTranscript):
            ask()
        assert [kind for kind, *_ in events] == ["read"]


def test_the_logs_say_how_long_each_moment_lasts():
    hits = [{"start": 10.0, "end": 12.5}, {"start": 100.0, "end": 143.0}, {"start": 50.0, "end": 54.0}]
    assert live_search._lasts(hits) == "3 moments of 4.0 s (median), longest 43.0 s: 2.5, 43.0, 4.0"
    assert live_search._lasts([]) == "no moment"
