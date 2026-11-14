"""The AI searching a live with tools: the sound index, the tools, the search loop (the model is faked)."""

import json
import os
from types import SimpleNamespace

import numpy as np
import pytest

from app.services import live_agent, live_tools, openai_client, sound_index
from app.services import live_search as ls
from app.services.provider_errors import ProviderUnavailable
from app.services.vod_transcript import VodTranscript


def _index():
    """10 minutes of live: speech nearly all along, gunfire around 2:00, a shout at 5:00, nobody speaks from 8:00 to 8:20."""
    groups = list(sound_index.GROUPS)
    scores = np.zeros((600, len(groups)), dtype=np.float16)
    loud = np.full(600, -30.0, dtype=np.float32)
    speech, gunfire = groups.index("speech"), groups.index("gunfire")
    scores[:, speech] = 0.9
    scores[480:500, speech] = 0.05
    scores[118:123, gunfire] = [0.3, 0.8, 0.9, 0.6, 0.2]
    scores[400:402, gunfire] = 0.2
    loud[300:304] = -12.0
    loud[118:123] = -20.0
    return sound_index.SoundIndex(groups, scores, loud)


def test_the_sound_index_finds_where_to_look():
    index = _index()
    peaks = index.peaks("gunfire")
    assert [(p["at"], p["score"]) for p in peaks] == [("0:01:59", 0.9), ("0:06:40", 0.2)]
    assert peaks[0]["seconds"] == 3.0  # over half its peak for 3 s
    assert index.peaks("explosion") == [] and index.peaks("unknown") == []
    # People speaking much louder than they usually do here
    raised = index.raised_voices()
    assert raised[0]["at"] == "0:05:00" and raised[0]["over_db"] > 10
    assert index.loudest()[0]["at"] == "0:05:00"
    assert index.quiet() == [{"time": 480.0, "seconds": 20.0}]
    heard = index.heard(117, 124)
    assert heard["sounds"] == {"gunfire": 0.9} and heard["over_db"] == 10.0 and heard["speech_share"] == 0.9


def test_the_sound_index_is_kept_next_to_the_transcript(monkeypatch, tmp_path):
    monkeypatch.setattr(sound_index, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    assert sound_index.load("job") is None
    index = _index()
    (tmp_path / "job").mkdir()
    np.savez_compressed(sound_index.index_path("job"), version=sound_index.VERSION, groups=np.array(index.groups), scores=index.scores, loud=index.loud, hop=1.0)
    again = sound_index.load("job")
    assert again.groups == index.groups and again.peaks("gunfire")[0]["at"] == "0:01:59"
    # Every group is made of classes the model knows
    assert all(indexes for indexes in sound_index._class_indexes().values())


def _tools(monkeypatch, with_sounds=True):
    transcript = VodTranscript(segments=[
        (100.0, 103.0, " Bon là franchement c'est calme."),
        (117.0, 119.0, " Attention ça tire !"),
        (119.5, 122.0, " À couvert, à couvert !"),
        (300.0, 303.0, " Mais c'est pas possible putain !"),
    ])
    monkeypatch.setattr(live_tools, "load_cached", lambda job_id: transcript)
    monkeypatch.setattr(live_tools.live_search, "read_chat", lambda job_id: [{"timestamp": 125.0, "author": "lea", "text": "ça tire fort"}, {"timestamp": 126.0, "author": "Nightbot", "text": "ça tire"}])
    monkeypatch.setattr(live_tools.sound_index, "load", lambda job_id: _index() if with_sounds else None)
    return live_tools.LiveTools("job", duration=600.0)


def test_the_tools_answer_little_and_exactly(monkeypatch):
    tools = _tools(monkeypatch)
    assert [s["name"] for s in tools.specs()] == ["overview", "best_moments", "search_speech", "search_chat", "chat_peaks", "find_sounds", "loud_moments", "read"]
    # The line's time to the tenth, and what it takes to say: its 3 s hold silence (this transcript has no timed words)
    assert tools.call("search_speech", {"words": "calme"}) == {"found": 1, "moments": [{"at": "0:01:40.0", "seconds": 1.5, "said": "Bon là franchement c'est calme."}]}
    # Words said over two lines: the time of the last one too
    assert tools.call("search_speech", {"words": "tire couvert"})["moments"] == [
        {"at": "0:01:57.0", "seconds": 2.8, "said": "Attention ça tire ! À couvert, à couvert !", "last_line_at": "0:01:59.5"},
    ]
    chat = tools.call("search_chat", {"words": "tire"})
    # Moved back onto the stream, the bot left out, with what was said then
    assert chat["found"] == 1 and chat["moments"][0]["messages"] == ["lea: ça tire fort"] and "ça tire" in chat["moments"][0]["said_then"]
    sounds = tools.call("find_sounds", {"kind": "gunfire"})
    assert sounds["moments"][0] == {"at": "0:01:59", "seconds": 3.0, "sure": 0.9, "said_then": "Attention ça tire ! À couvert, à couvert !"}
    assert tools.call("loud_moments", {"kind": "raised_voices"})["moments"][0]["said_then"] == "Mais c'est pas possible putain !"
    assert tools.call("loud_moments", {"kind": "quiet"})["moments"] == [{"at": "0:08:00", "seconds": 20.0}]
    read = tools.call("read", {"start": "0:01:55", "end": "0:02:05"})
    assert read["said"] == ["[0:01:57.0] (1.3 s) Attention ça tire !", "[0:01:59.5] (1.5 s) À couvert, à couvert !"]
    # What a moment given by its lines lasts once cut; nobody speaks there: the time between the two
    assert round(tools.spoken("0:01:57.0", "0:01:59.5"), 1) == 2.8 and round(tools.spoken("0:01:57.0", "0:01:57.0"), 1) == 1.3
    assert tools.spoken("0:09:00", "0:09:08") == 8.0 and tools.spoken("0:09:00", None) == 2.0 and tools.spoken("soon", None) == 0.0
    assert read["chat"] == ["[0:02:00] lea: ça tire fort", "[0:02:01] Nightbot: ça tire"] and read["heard"]["sounds"] == {"gunfire": 0.9}
    assert tools.call("read", {"start": "0:09:00", "end": "0:09:10"})["said"] == ["(nobody speaks)"]
    # Mistakes come back as data, never as a crash; a kind of sound that doesn't exist is answered with those that do
    assert "error" in tools.call("nope", {}) and "error" in tools.call("read", {"when": "now"})
    assert "gunfire" in tools.call("find_sounds", {"kind": "anger"})["error"] and "raised_voices" in tools.call("loud_moments", {"kind": "angry"})["error"]


def test_the_chat_s_bursts_are_found_whatever_its_size(monkeypatch):
    def chat(*groups):
        return [{"timestamp": t, "author": author, "text": text} for t, author, text in groups]

    # A small chat (a message every minute and a half): four messages from three viewers in 20 s stand out
    quiet = [(90.0 * i, f"v{i % 5}", "salut") for i in range(1, 30)]
    burst = [(1030.0, "lea", "MDRRR"), (1033.0, "bob", "mdrrr"), (1036.0, "zoe", "il est tombé"), (1041.0, "lea", "clip ça"), (1042.0, "Nightbot", "!clip"), (1043.0, "bob", "!clip")]
    spam = [(2000.0 + i, "solo", f"spam {i}") for i in range(6)]
    peaks = ls.chat_peaks(chat(*quiet, *burst, *spam), lag=5.0, duration=3600.0)
    assert len(peaks) == 1
    peak = peaks[0]
    # On the stream's clock: what they react to came before their first message; the bot, the commands and one viewer alone don't count
    assert (peak["start"], peak["end"]) == (1017.0, 1039.0) and (peak["messages"], peak["viewers"]) == (4, 3)
    assert peak["lines"] == ["lea: MDRRR (x2)", "zoe: il est tombé", "lea: clip ça"] and peak["clip_requests"] == 1 and peak["usual"] == 0.2
    # A big chat (five messages a second): only what is well over its pace is a burst, the strongest first,
    # each starting where its messages pour in (not where the 20 s around it begin)
    busy = [(i / 5, f"v{i % 400}", "gg") for i in range(5 * 600)]
    wave = [(300.0 + i / 40, f"w{i}", "KEKW") for i in range(400)] + [(450.0 + i / 30, f"x{i}", "LETSGO") for i in range(300)]
    peaks = ls.chat_peaks(chat(*busy, *wave), lag=5.0, duration=600.0)
    assert [round(p["start"]) for p in peaks] == [287, 437] and peaks[0]["viewers"] > peaks[1]["viewers"] > 300
    assert any("KEKW (x400)" in line for line in peaks[0]["lines"]) and any("LETSGO (x300)" in line for line in peaks[1]["lines"])
    # Nothing to say of a chat that never speeds up, or of no chat at all
    assert ls.chat_peaks(chat(*quiet), 5.0, 3600.0) == [] and ls.chat_peaks([], 5.0, 3600.0) == []

    tools = _tools(monkeypatch)
    monkeypatch.setattr(tools, "chat", chat(*quiet, *burst))
    monkeypatch.setattr(tools, "duration", 3600.0)
    told = tools.call("chat_peaks", {})
    assert told["found"] == 1 and told["usually"] == "about 0.2 messages in 20 seconds"
    assert told["moments"][0] == {"at": "0:16:57", "seconds": 22, "messages": 4, "viewers": 3, "wrote": ["lea: MDRRR (x2)", "zoe: il est tombé", "lea: clip ça"], "viewers_ask_for_a_clip": True, "said_then": ""}
    monkeypatch.setattr(tools, "chat", [])
    assert tools.call("chat_peaks", {}) == {"found": 0, "note": "the chat never wrote much at once in this live"}


def test_the_moments_the_analysis_rated_are_all_there(monkeypatch):
    from app.services import db

    def hot_point(t, score, name, category, summary, clip):
        return SimpleNamespace(timestamp_seconds=t, final_score=score, score=score, clip_name=name, clip_filename=clip, llm=SimpleNamespace(category=category, summary=summary))

    # What the worker kept: the two moments it clipped, with what the AI saw
    clipped = [hot_point(300.0, 0.86, "Tigre", "fun", "Ils paniquent face à un tigre.", "tigre.mp4"), hot_point(119.4, 0.7, "Fusillade", "action", "Ça tire devant l'hôpital.", "tirs.mp4")]
    monkeypatch.setattr(db, "get_job", lambda job_id: SimpleNamespace(hot_points=clipped))
    # What the app kept: every candidate the analysis rated, the dropped ones too (their summary since it is kept)
    rated = [
        {"t": 300, "state": "kept", "score": 0.86, "name": "Tigre", "category": "fun"},
        {"t": 119.4, "state": "kept", "score": 0.7, "name": "Fusillade", "category": "action"},
        {"t": 450.2, "state": "dropped", "score": 0.46, "name": "Urgence Brulure", "category": "fun"},
        {"t": 520.0, "state": "dropped", "score": 0.31, "name": "Commande Geante", "category": "fun", "what": "Il commande pour dix."},
        {"t": 560.0, "state": "clip", "score": 0.5, "name": "Clip 0:09:20"},
        {"t": 580.0, "state": "pending"},
        {"state": "kept"},
    ]
    tools = _tools(monkeypatch)
    monkeypatch.setattr(tools, "moments", rated)
    best = tools.call("best_moments", {})
    assert best["found"] == 5
    assert best["moments"][0] == {"at": "0:05:00", "score": 86, "kind": "fun", "name": "Tigre", "what": "Ils paniquent face à un tigre.", "clip": True}
    assert [(m["at"], m["score"], m["clip"]) for m in best["moments"]] == [("0:05:00", 86, True), ("0:01:59", 70, True), ("0:09:20", 50, True), ("0:07:30", 46, False), ("0:08:40", 31, False)]
    # Dropped moments: their name always, what happens when the analysis kept it; the one asked for on the stream is said so
    assert "what" not in best["moments"][3] and best["moments"][4]["what"] == "Il commande pour dix." and best["moments"][2]["asked_for_on_stream"] is True
    # Without the app's list (an older app), the clipped moments are still known
    monkeypatch.setattr(tools, "moments", [])
    alone = tools.call("best_moments", {})
    assert [m["name"] for m in alone["moments"]] == ["Tigre", "Fusillade"] and alone["moments"][1]["what"] == "Ça tire devant l'hôpital."
    # No analysis left in the worker: nothing, not a crash
    monkeypatch.setattr(db, "get_job", lambda job_id: None)
    assert tools.call("best_moments", {}) == {"found": 0, "moments": []}
    assert tools.call("overview", {})["title"] is None


def test_a_live_never_listened_to_has_no_sound_tools(monkeypatch):
    tools = _tools(monkeypatch, with_sounds=False)
    assert [s["name"] for s in tools.specs()] == ["overview", "best_moments", "search_speech", "search_chat", "chat_peaks", "read"]
    assert "error" in tools.call("find_sounds", {"kind": "gunfire"})
    assert "heard" not in tools.call("read", {"start": 100, "end": 110})


class FakeModel:
    """Plays a model: each step is the tool calls it makes (or a plain text answer)."""

    def __init__(self, steps):
        self.steps = list(steps)
        self.seen = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        # The conversation as it was at this step (the search keeps adding to the same list)
        self.seen.append({**kwargs, "messages": list(kwargs["messages"])})
        step = self.steps.pop(0) if self.steps else [("answer", {"moments": [], "note": "forced"})]
        usage = SimpleNamespace(prompt_tokens=1000, completion_tokens=50, cost=0.001)
        if isinstance(step, str):
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=step, tool_calls=None))], usage=usage)
        calls = [SimpleNamespace(id=f"c{len(self.seen)}_{i}", function=SimpleNamespace(name=name, arguments=json.dumps(args))) for i, (name, args) in enumerate(step)]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="", tool_calls=calls))], usage=usage)


def test_the_search_goes_through_the_tools_then_answers(monkeypatch):
    tools = _tools(monkeypatch)
    model = FakeModel([
        [("find_sounds", {"kind": "gunfire"}), ("search_speech", {"words": "tire"})],
        [("read", {"start": "0:01:50", "end": "0:02:10"})],
        [("answer", {"moments": [{"start": "0:01:57.0", "end": "0:01:59.5", "quote": "Attention ça tire", "why": "Fusillade", "score": 90}], "note": "Une fusillade."})],
    ])
    run = live_agent.Searcher(tools, model, "some/model").search("les moments où ça pète")
    assert run.finished and run.steps == 3 and run.tool_calls == 3 and run.note == "Une fusillade."
    assert [t["tool"] for t in run.trace] == ["find_sounds", "search_speech", "read"]
    assert (run.tokens_in, run.tokens_out, round(run.cost, 3)) == (3000, 150, 0.003)
    # The model saw each tool's answer before its next step
    second = model.seen[1]["messages"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "tool", "tool"]
    assert json.loads(second[3]["content"])["moments"][0]["at"] == "0:01:59"
    assert "listen" not in [f["function"]["name"] for f in model.seen[0]["tools"]]

    hits = live_agent.to_hits(run, tools)
    assert len(hits) == 1 and hits[0].sources == ["ai"] and hits[0].why == "Fusillade" and hits[0].score == 0.9
    # The two lines it named, whole: from the first one's start to the last one's end
    assert hits[0].text == "Attention ça tire ! À couvert, à couvert !" and (hits[0].start, hits[0].end) == (117.0, 122.0) and hits[0].spoken


def test_claude_is_asked_to_keep_what_it_was_sent(monkeypatch):
    tools = _tools(monkeypatch)
    # Claude's input is only cached when asked: every step would pay full price for the whole conversation
    claude = FakeModel([[("answer", {"moments": [], "note": "rien"})]])
    live_agent.Searcher(tools, claude, "anthropic/claude-haiku-5.5").search("x")
    assert claude.seen[0]["extra_body"]["cache_control"] == {"type": "ephemeral"}
    # The others do it by themselves
    other = FakeModel([[("answer", {"moments": [], "note": "rien"})]])
    live_agent.Searcher(tools, other, "openai/gpt-6-luna").search("x")
    assert "cache_control" not in other.seen[0]["extra_body"] and other.seen[0]["extra_body"]["usage"] == {"include": True}


def test_a_model_that_answers_in_text_or_never_stops_still_ends(monkeypatch):
    tools = _tools(monkeypatch)
    text = live_agent.Searcher(tools, FakeModel(['Voilà : {"moments": [], "note": "rien"}']), "m").search("x")
    assert text.finished and text.moments == [] and text.note == "rien"
    # Talks instead of searching: nudged once, then it answers
    chatty = FakeModel(["Je réfléchis.", [("answer", {"moments": [], "note": "ok"})]])
    assert live_agent.Searcher(tools, chatty, "m").search("x").steps == 2
    assert chatty.seen[1]["messages"][-1]["role"] == "user"
    # Never answers: the last step forces the answer tool
    loop = FakeModel([[("read", {"start": 0, "end": 10})]] * 3)
    run = live_agent.Searcher(tools, loop, "m").search("x", max_steps=4)
    assert run.finished and run.steps == 4 and loop.seen[3]["tool_choice"] == {"type": "function", "function": {"name": "answer"}}


def test_listening_goes_to_the_model_that_hears(monkeypatch):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_agent, "live_audio_url", lambda url: "https://vod/audio_only/index.m3u8")
    fetched = []
    monkeypatch.setattr(live_agent, "fetch_audio", lambda url, start, seconds: fetched.append((start, seconds)) or "bXAz")
    model = FakeModel([[("listen", {"start": "0:05:00", "end": "0:05:10", "question": "est-il en colère ?"})], "Un homme crie, très en colère.", [("answer", {"moments": [], "note": "ok"})]])
    searcher = live_agent.Searcher(tools, model, "agent/model", vod_url="https://www.twitch.tv/videos/1", ears_model="ears/model")
    run = searcher.search("pète les plombs")
    assert fetched == [(300.0, 10.0)] and run.listens == 1 and run.finished
    # The ears got the sound and the question, on their own model; the agent got what they heard
    ears = model.seen[1]
    assert ears["model"] == "ears/model" and ears["messages"][0]["content"][1]["input_audio"] == {"data": "bXAz", "format": "mp3"}
    assert "est-il en colère" in ears["messages"][0]["content"][0]["text"]
    assert json.loads(model.seen[2]["messages"][-1]["content"]) == {"from": "0:05:00", "to": "0:05:10", "heard": "Un homme crie, très en colère."}
    assert "listen" in [f["function"]["name"] for f in model.seen[0]["tools"]]
    # No more than a dozen listens
    searcher.run.listens = live_agent.MAX_LISTENS
    assert "error" in searcher.listen("0:01:00", "0:01:10")


def test_a_snippet_is_fetched_whatever_the_ffmpeg(monkeypatch, tmp_path):
    import subprocess

    monkeypatch.setattr(live_agent.paths, "WORK_DIR", str(tmp_path))
    monkeypatch.setitem(live_agent._snippet, "format", "mp3")
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        if "libmp3lame" in command:
            raise subprocess.CalledProcessError(1, command, stderr=b"Unknown encoder 'libmp3lame'")
        if len(commands) == 2:
            # A connection that stalls: dropped, tried once more
            raise subprocess.TimeoutExpired(command, 25)
        with open(command[-1], "wb") as f:
            f.write(b"RIFF" + b"0" * 2000)
        return None

    monkeypatch.setattr(live_agent.subprocess, "run", run)
    audio = live_agent.fetch_audio("https://vod/audio_only/index.m3u8", 300.0, 12.0)
    # No MP3 encoder in this ffmpeg: WAV instead, from now on, and the ears are told so
    assert audio and live_agent.snippet_format() == "wav" and len(commands) == 3
    assert "pcm_s16le" in commands[1] and "-rw_timeout" in commands[1] and commands[1][commands[1].index("-ss") + 1] == "300.00"
    assert list(tmp_path.iterdir()) == []
    # It never answers: given up after two tries, nothing left behind
    monkeypatch.setattr(live_agent.subprocess, "run", lambda command, **kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired(command, 25)))
    assert live_agent.fetch_audio("https://vod/audio_only/index.m3u8", 300.0, 12.0) is None and list(tmp_path.iterdir()) == []


# ── The search as the app runs it (live_search), the model still faked ───────


class Watched(FakeModel):
    """A fake model that also notes what the app says the AI is doing when each step is asked.
    A step that is an exception is raised: the provider failing."""

    def __init__(self, steps):
        super().__init__(steps)
        self.doing = []

    def create(self, **kwargs):
        self.doing.append(ls.doing("job"))
        if self.steps and isinstance(self.steps[0], Exception):
            self.seen.append(kwargs)
            raise self.steps.pop(0)
        return super().create(**kwargs)


def _live(monkeypatch, tmp_path, steps):
    """A live as the worker has it (transcript, chat, sounds), and a faked model in place of OpenRouter."""
    tools = _tools(monkeypatch)
    monkeypatch.setattr(ls, "load_cached", lambda job_id: tools.transcript)
    monkeypatch.setattr(ls.paths, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    monkeypatch.setattr(sound_index, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    monkeypatch.setattr(live_agent.time, "sleep", lambda seconds: None)
    model = Watched(steps)
    monkeypatch.setattr(openai_client, "get_openrouter_client", lambda: model)
    return model


SHOTS = {"start": "0:01:57.0", "end": "0:01:57.0", "quote": "Attention ça tire", "why": "Fusillade", "score": 90}


def test_asking_the_ai_searches_with_tools_and_is_paid_once(monkeypatch, tmp_path):
    model = _live(monkeypatch, tmp_path, [
        [("find_sounds", {"kind": "gunfire"}), ("search_speech", {"words": "tire"})],
        [("read", {"start": "0:01:50", "end": "0:02:10"})],
        [("answer", {"moments": [SHOTS], "note": "Une fusillade, vérifiée."})],
    ])
    # What asking costs is said before asking; the live was never listened to here
    info = ls.info("job", 600.0)
    assert (info["ai_cost"], info["plan_cost"], info["max_cost"]) == (live_agent.TYPICAL_COST, live_agent.TYPICAL_PLAN_COST, live_agent.MAX_COST)
    assert info["transcript"] is True and info["sounds"] is False and info["dev"] is False

    found = ls.search_ai("job", "Les moments où ça pète", {}, 600.0)
    assert found["cached"] is False and found["cost"] == 0.003 and found["total"] == 1 and found["note"] == "Une fusillade, vérifiée."
    hit = found["hits"][0]
    assert hit["sources"] == ["ai"] and hit["text"] == "Attention ça tire !" and hit["why"] == "Fusillade" and (hit["start"], hit["end"]) == (117.0, 119.0)
    # Words said: the app cuts it on where they really are once it has its clip
    assert hit["spoken"] is True
    # The app could say what the AI was doing at each step, and nothing once it is over
    assert [d and (d["step"], d["detail"]) for d in model.doing] == [("thinking", ""), ("search_speech", "tire"), ("read", "0:01:50")]
    assert ls.doing("job") is None
    # The same question again (typed a little differently) is answered from the disk
    again = ls.search_ai("job", "les moments où ça pète ", {}, 600.0)
    assert again["cached"] is True and again["cost"] == 0.0 and again["hits"] == found["hits"] and again["note"] == found["note"] and len(model.seen) == 3

    monkeypatch.setattr(ls, "load_cached", lambda job_id: None)
    with pytest.raises(ls.NoTranscript):
        ls.search_ai("job", "autre chose", {}, 600.0)
    assert ls.info("job")["ai_cost"] is None


def test_the_search_knows_every_moment_the_analysis_rated(monkeypatch, tmp_path):
    from app.services import db

    monkeypatch.setattr(db, "get_job", lambda job_id: None)
    model = _live(monkeypatch, tmp_path, [
        [("best_moments", {}), ("chat_peaks", {})],
        [("answer", {"moments": [SHOTS], "note": "ok"})],
    ])
    # The app sends the candidates it kept from the analysis, dropped ones included
    rated = [{"t": 119.4, "state": "dropped", "score": 0.46, "name": "Fusillade devant l'hopital", "category": "action", "what": "Ça tire."}]
    ls.search_ai("job", "les meilleurs moments", {}, 600.0, moments=rated)
    best, peaks = (json.loads(m["content"]) for m in model.seen[1]["messages"][-2:])
    assert best == {"found": 1, "moments": [{"at": "0:01:59", "score": 46, "kind": "action", "name": "Fusillade devant l'hopital", "what": "Ça tire.", "clip": False}]}
    assert peaks["found"] == 0
    # What it is doing is told to the app by the tool's name
    assert [d and d["step"] for d in model.doing] == ["thinking", "chat_peaks"]
    names = [f["function"]["name"] for f in model.seen[0]["tools"]]
    assert names[:2] == ["overview", "best_moments"] and "chat_peaks" in names


def test_a_search_that_fails_says_why_and_leaves_nothing_behind(monkeypatch, tmp_path):
    # Neither the model nor the one that takes over ever answers: nothing is kept, the next try asks again
    model = _live(monkeypatch, tmp_path, ["Je réfléchis."] * (2 * live_agent.MAX_STEPS))
    with pytest.raises(RuntimeError, match="no answer after"):
        ls.search_ai("job", "rien", {}, 600.0)
    assert len(model.seen) == 2 * live_agent.MAX_STEPS and ls.doing("job") is None
    assert not (tmp_path / "job" / "search").exists()

    # No credits left: said as such (the app shows "recharge"), not as a search that found nothing
    class Refused(Exception):
        status_code = 402

    _live(monkeypatch, tmp_path, [Refused("no credits")])
    with pytest.raises(ProviderUnavailable) as refused:
        ls.search_ai("job", "rien", {}, 600.0)
    assert refused.value.reason == "credits" and ls.doing("job") is None


def test_another_model_takes_over_when_the_first_one_fails(monkeypatch, tmp_path):
    class Retired(Exception):
        status_code = 404

    model = _live(monkeypatch, tmp_path, [
        [("search_speech", {"words": "tire"})],
        Retired("no such model"),
        [("read", {"start": "0:01:50", "end": "0:02:10"})],
        [("answer", {"moments": [SHOTS], "note": "Trouvé par l'autre modèle."})],
    ])
    found = ls.search_ai("job", "ça pète", {}, 600.0)
    assert found["total"] == 1 and found["note"] == "Trouvé par l'autre modèle."
    assert [call["model"] for call in model.seen] == [live_agent.SEARCH_MODEL] * 2 + [live_agent.FALLBACK_MODEL] * 2
    # What the first model spent before failing is counted too
    assert found["cost"] == 0.003
    # The second one starts from scratch: it doesn't inherit a broken conversation
    assert [m["role"] for m in model.seen[2]["messages"]] == ["system", "user"]


def test_an_answer_cut_off_is_asked_again(monkeypatch):
    tools = _tools(monkeypatch)

    class Cut(FakeModel):
        def create(self, **kwargs):
            response = super().create(**kwargs)
            # The first answer comes back cut in the middle of its JSON
            if len(self.seen) == 1:
                response.choices[0].message.tool_calls[0].function.arguments = '{"moments": [{"start": "0:01:57", "end": "0:02'
            return response

    model = Cut([[("answer", {"moments": [SHOTS] * 30, "note": "long"})], [("answer", {"moments": [SHOTS], "note": "court"})]])
    run = live_agent.Searcher(tools, model, "m").search("ça pète")
    assert run.finished and run.steps == 2 and len(run.moments) == 1 and run.note == "court"
    assert "cut off" in json.loads(model.seen[1]["messages"][-1]["content"])["error"]


def test_a_dropped_connection_is_tried_again(monkeypatch, tmp_path):
    class APIConnectionError(Exception):
        pass

    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_agent.time, "sleep", lambda seconds: None)
    model = Watched([APIConnectionError("reset"), [("answer", {"moments": [SHOTS], "note": "ok"})]])
    run = live_agent.Searcher(tools, model, "m").search("ça pète")
    assert run.finished and run.steps == 1 and len(model.seen) == 2 and len(run.moments) == 1
    # Tried a few times, not for ever; a mistake that would come back is not tried again
    model = Watched([APIConnectionError("reset")] * 5)
    with pytest.raises(APIConnectionError):
        live_agent.Searcher(tools, model, "m").search("ça pète")
    assert len(model.seen) == live_agent.STEP_TRIES
    model = Watched([ValueError("bad request")])
    with pytest.raises(ValueError):
        live_agent.Searcher(tools, model, "m").search("ça pète")
    assert len(model.seen) == 1


def test_a_search_stops_spending_at_its_ceiling(monkeypatch):
    tools = _tools(monkeypatch)
    # Each step costs 0.001 $: with 0.002 $ to spend, the third step has to answer (the fake does when it has no step left)
    model = FakeModel([[("read", {"start": 0, "end": 10})]] * 2)
    run = live_agent.Searcher(tools, model, "m", max_cost=0.002).search("x")
    assert run.steps == 3 and run.finished and round(run.cost, 3) == 0.003
    assert [call["tool_choice"] for call in model.seen] == ["auto", "auto", {"type": "function", "function": {"name": "answer"}}]


def test_the_ai_plans_a_video_with_tools(monkeypatch, tmp_path):
    calm = {"start": "0:01:40.0", "end": "0:01:40.0", "quote": "franchement c'est calme", "why": "Il le dit", "score": 85}
    whole = {
        "title": "Du calme à la tempête",
        "sections": [
            {"title": "C'est calme", "moments": [calm]},
            {"title": "Rien trouvé", "moments": []},
            # The same shots given twice: kept once
            {"title": "Ça pète", "moments": [SHOTS, {**SHOTS, "start": "0:01:57", "end": "0:01:57", "why": "Encore"}]},
        ],
        "note": "Rien pour la partie du milieu.",
        "look": "  ma caméra en haut,\n le jeu en dessous ",
    }
    model = _live(monkeypatch, tmp_path, [
        [("search_speech", {"words": "calme"}), ("find_sounds", {"kind": "gunfire"})],
        # Its first part only, far from the length asked: sent back once
        [("plan", {"title": "Du calme", "sections": [{"title": "C'est calme", "moments": [calm]}], "note": ""})],
        [("plan", whole)],
    ])
    planned = ls.plan_video("job", "d'abord le calme, puis ça pète", 30.0, {}, 600.0)
    assert planned["title"] == "Du calme à la tempête" and planned["note"] == "Rien pour la partie du milieu."
    # What the description asks about the look is handed on as it was said (another step lays the video out)
    assert planned["look"] == "ma caméra en haut, le jeu en dessous"
    assert [(s["title"], len(s["hits"])) for s in planned["sections"]] == [("C'est calme", 1), ("Ça pète", 1)]
    assert planned["sections"][1]["hits"][0]["why"] == "Fusillade" and planned["cost"] == 0.003 and planned["cached"] is False
    # Planning has a model of its own (sorting moments between parts takes more than finding them), with more to spend
    assert [call["model"] for call in model.seen] == [live_agent.PLAN_MODEL] * 3 and live_agent.PLAN_MODEL != live_agent.SEARCH_MODEL
    assert ls.info("job", 600.0)["plan_max_cost"] == live_agent.PLAN_MAX_COST > live_agent.MAX_COST
    # It was told the video and its length, and had to end with `plan`
    first = model.seen[0]
    assert "le calme, puis ça pète" in first["messages"][1]["content"] and "about 30 seconds" in first["messages"][1]["content"]
    assert "whole video" in first["messages"][0]["content"]
    names = [f["function"]["name"] for f in first["tools"]]
    assert names[-1] == "plan" and "answer" not in names
    # What it was told of its short plan; the second one stands, even short (a live may have no more)
    sent_back = json.loads(model.seen[2]["messages"][-1]["content"])["error"]
    # Its length is what its lines take to say (1.5 s), not their rough times
    assert "1 part(s)" in sent_back and "2 seconds once cut on its words, for 30 asked" in sent_back
    # Asked again for the same video and length: free
    assert ls.plan_video("job", "D'abord le calme puis ça pète", 30.0, {}, 600.0)["cached"] is True and len(model.seen) == 3
    # A plan of about the length asked, with its note, is taken at once
    assert live_agent._short_plan({"sections": [{"title": "A", "moments": [{"start": "0:01:00", "end": "0:01:25"}]}], "note": "ok"}, 30.0) is None
    assert live_agent._short_plan({"sections": [{"title": "A", "moments": [{"start": "0:01:00", "end": "0:01:20"}]}], "note": " "}, 30.0)
    assert live_agent._short_plan({"sections": "nonsense"}, 30.0)
    # A model that answers in plain text is still understood
    text = live_agent.Searcher(_tools(monkeypatch), FakeModel(['{"title": "T", "sections": [{"title": "A", "moments": []}], "note": "n"}']), "m").plan("x", 60.0)
    assert text.finished and text.title == "T" and text.sections == [{"title": "A", "moments": []}] and text.note == "n"


def test_the_streamer_comes_back_to_a_planned_video(monkeypatch, tmp_path):
    calm = {"start": "0:01:40.0", "end": "0:01:40.0", "quote": "c'est calme", "why": "Il le dit", "score": 85}
    angry = {"start": "0:05:00.0", "end": "0:05:00.0", "quote": "c'est pas possible putain", "why": "Il craque", "score": 80}
    model = _live(monkeypatch, tmp_path, [
        [("search_speech", {"words": "possible"})],
        [("plan", {"title": "", "sections": [{"title": "C'est calme", "moments": [calm]}, {"title": "Ça pète", "moments": [SHOTS, angry]}], "note": "J'ai ajouté le moment où il craque."})],
    ])
    # The video as it is now: the streamer moved the first cut by hand (101-102.5 s, inside the line said "from 100 to 103 s")
    current = [{"title": "C'est calme", "items": [{"start": 101.0, "end": 102.5}]}, {"title": "Ça pète", "items": [{"start": 117.0, "end": 119.0}, {"start": 450.0, "end": 455.0}]}]
    changed = ls.revise_video("job", "d'abord le calme, puis ça pète", current, ["mets un titre"], "ajoute le moment où il craque à la fin", 600.0)
    assert changed["note"] == "J'ai ajouté le moment où il craque." and changed["cost"] == 0.002 and changed["cached"] is False
    assert [(s["title"], [(h["start"], h["end"]) for h in s["hits"]]) for s in changed["sections"]] == [
        ("C'est calme", [(100.0, 103.0)]), ("Ça pète", [(117.0, 119.0), (300.0, 303.0)]),
    ]
    # What it gave back as it was is not to be cut again, nor what is new
    assert [[h["recut"] for h in s["hits"]] for s in changed["sections"]] == [[False], [False, False]]
    # It was told what was first described, the video as lines it can give back as they are, what was asked before and now
    told = model.seen[0]["messages"]
    assert "asks for a change" in told[0]["content"] and model.seen[0]["model"] == live_agent.PLAN_MODEL
    assert "« d'abord le calme, puis ça pète »" in told[1]["content"] and "« ajoute le moment où il craque à la fin »" in told[1]["content"] and '"mets un titre"' in told[1]["content"]
    assert '{"start": "0:01:40.0", "end": "0:01:40.0", "said": "Bon là franchement c\'est calme."}' in told[1]["content"]
    # A passage cut on its words starts late in its first line (the line's time holds silence): that line is still part of it
    assert ls.as_lines(_tools(monkeypatch).transcript, 118.4, 121.0) == {"start": "0:01:57.0", "end": "0:01:59.5", "said": "Attention ça tire ! À couvert, à couvert !"}
    # A passage where nobody speaks keeps its own times
    assert '{"start": "0:07:30.0", "end": "0:07:35.0", "said": ""}' in told[1]["content"]
    # Asked for tighter cuts, it gives a passage of two lines back with its first line only: that one is to be cut again
    model.steps = [[("plan", {"sections": [{"title": "C'est calme", "moments": [calm]}, {"title": "Ça pète", "moments": [SHOTS]}], "note": "J'ai resserré un passage."})]]
    wide = [{"title": "C'est calme", "items": [{"start": 101.0, "end": 102.5}]}, {"title": "Ça pète", "items": [{"start": 117.0, "end": 121.5}]}]
    tighter = ls.revise_video("job", "x", wide, [], "des cuts plus agressifs", 600.0)
    assert [[h["recut"] for h in s["hits"]] for s in tighter["sections"]] == [[False], [True]]
    # Asked again: asked again (the video it starts from is never the same twice)
    model.steps = [[("plan", {"sections": [], "note": "Rien."})]]
    assert ls.revise_video("job", "x", current, [], "ajoute le moment où il craque à la fin", 600.0)["sections"] == []


def test_a_live_never_listened_to_is_listened_to_before_its_first_question(monkeypatch, tmp_path):
    model = _live(monkeypatch, tmp_path, [[("answer", {"moments": [], "note": "rien"})]])
    listened = []
    monkeypatch.setattr(sound_index, "ensure", lambda job_id, url: listened.append((job_id, url, ls.doing(job_id)["step"])))
    monkeypatch.setattr(live_agent, "live_audio_url", lambda url: None)
    found = ls.search_ai("job", "une sirène", {}, 600.0, url="https://www.twitch.tv/videos/1")
    assert listened == [("job", "https://www.twitch.tv/videos/1", "hearing")] and found["hits"] == [] and found["note"] == "rien"
    # The AI may listen to the live since it is still on Twitch
    assert "listen" in [f["function"]["name"] for f in model.seen[0]["tools"]]
    # Once the index is there, nothing is downloaded again; without the live's address, nothing either
    (tmp_path / "job").mkdir(exist_ok=True)
    (tmp_path / "job" / "sound.npz").write_bytes(b"x")
    assert ls.info("job")["sounds"] is True
    _live(monkeypatch, tmp_path, [[("answer", {"moments": [], "note": "rien"})]] * 2)
    monkeypatch.setattr(sound_index, "ensure", lambda job_id, url: listened.append("again"))
    ls.search_ai("job", "un klaxon", {}, 600.0, url="https://www.twitch.tv/videos/1")
    (tmp_path / "job" / "sound.npz").unlink()
    ls.search_ai("job", "une alarme", {}, 600.0)
    assert len(listened) == 1


# ── Making the sound index ───────────────────────────────────────────────────


def _fake_ears(monkeypatch):
    """The sound model replaced by one that scores "Speech" with each chunk's mean level (no weights to load)."""
    from app.services import audio_classifier

    speech = sound_index._class_indexes()["speech"][0]

    def infer(chunks, model=None):
        probs = np.zeros((len(chunks), 527), dtype=np.float32)
        probs[:, speech] = [min(1.0, float(np.abs(c).mean()) * 4) for c in chunks]
        return probs

    monkeypatch.setattr(audio_classifier, "infer", infer)


def _wav(path, seconds: float, rate: int = 16000, channels: int = 1):
    import soundfile

    rng = np.random.default_rng(7)
    t = np.arange(int(seconds * rate)) / rate
    # Quiet, then loud from 4 s on
    y = (rng.standard_normal(len(t)) * np.where(t < 4.0, 0.02, 0.2)).astype(np.float32)
    soundfile.write(str(path), np.stack([y] * channels, axis=1) if channels > 1 else y, rate, subtype="PCM_16")
    return y


def test_the_sound_index_is_made_by_stretches(monkeypatch, tmp_path):
    monkeypatch.setattr(sound_index, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    monkeypatch.setattr(sound_index, "BATCH", 4)
    _fake_ears(monkeypatch)
    y = _wav(tmp_path / "audio.wav", 10.5)
    index = sound_index.build(str(tmp_path / "audio.wav"), "job")
    # A 2 s window every second: 9 fit in 10.5 s, read in 3 stretches of 4
    assert index.scores.shape == (9, len(sound_index.GROUPS)) and index.loud.shape == (9,)
    expected = [20 * np.log10(np.sqrt(np.mean(y[i * 16000 : i * 16000 + 32000] ** 2))) for i in range(9)]
    assert np.allclose(index.loud, expected, atol=0.05)
    speech = index.scores[:, index.groups.index("speech")]
    assert speech[0] < 0.1 and speech[5] > 0.5
    # Kept next to the transcript, written whole
    kept = sound_index.load("job")
    assert kept is not None and np.array_equal(kept.loud, index.loud) and sorted(p.name for p in (tmp_path / "job").iterdir()) == ["sound.npz"]
    # Another kind of file (stereo, another rate) is listened to all the same
    _wav(tmp_path / "other.wav", 10.5, rate=22050, channels=2)
    other = sound_index.build(str(tmp_path / "other.wav"), "other")
    assert other.loud.shape == (9,) and other.loud[6] - other.loud[1] > 15
    # Shorter than a window: one window, padded
    _wav(tmp_path / "short.wav", 1.2)
    assert sound_index.build(str(tmp_path / "short.wav"), "short").loud.shape == (1,)


def test_a_live_analysed_before_is_listened_to_when_asked(monkeypatch, tmp_path):
    from app.services import downloader, paths

    monkeypatch.setattr(sound_index, "transcript_dir", lambda job_id: str(tmp_path / "transcripts" / job_id))
    monkeypatch.setattr(paths, "work_dir", lambda *parts: str(tmp_path.joinpath("work", *parts)))
    _fake_ears(monkeypatch)
    downloads = []

    def download(url, folder):
        downloads.append(url)
        (tmp_path / "work").mkdir(exist_ok=True)
        os.makedirs(folder, exist_ok=True)
        _wav(os.path.join(folder, "audio.wav"), 6.0)
        return os.path.join(folder, "audio.wav")

    monkeypatch.setattr(downloader, "download_audio", download)
    # Nothing to listen to without the live's address
    assert sound_index.ensure("job", None) is None and downloads == []
    index = sound_index.ensure("job", "https://www.twitch.tv/videos/1")
    assert index is not None and index.loud.shape == (5,) and downloads == ["https://www.twitch.tv/videos/1"]
    # The sound downloaded for it is not kept; asked again, the index on disk answers
    assert not (tmp_path / "work" / "sound_job").exists()
    assert sound_index.ensure("job", "https://www.twitch.tv/videos/1").loud.shape == (5,) and len(downloads) == 1

    # The live left Twitch: no index, and the search goes on without sounds
    def gone(url, folder):
        raise RuntimeError("404")

    monkeypatch.setattr(downloader, "download_audio", gone)
    assert sound_index.ensure("other", "https://www.twitch.tv/videos/2") is None
