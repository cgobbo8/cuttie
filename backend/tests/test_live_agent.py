"""The AI searching a live with tools: the sound index, the tools, the search loop (the model is faked)."""

import json
from types import SimpleNamespace

import numpy as np
import pytest

from app.services import live_agent, live_tools, sound_index
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
    assert [s["name"] for s in tools.specs()] == ["overview", "search_speech", "search_chat", "find_sounds", "loud_moments", "read"]
    assert tools.call("search_speech", {"words": "calme"}) == {"found": 1, "moments": [{"at": "0:01:40", "seconds": 3.0, "said": "Bon là franchement c'est calme."}]}
    chat = tools.call("search_chat", {"words": "tire"})
    # Moved back onto the stream, the bot left out, with what was said then
    assert chat["found"] == 1 and chat["moments"][0]["messages"] == ["lea: ça tire fort"] and "ça tire" in chat["moments"][0]["said_then"]
    sounds = tools.call("find_sounds", {"kind": "gunfire"})
    assert sounds["moments"][0] == {"at": "0:01:59", "seconds": 3.0, "sure": 0.9, "said_then": "Attention ça tire ! À couvert, à couvert !"}
    assert tools.call("loud_moments", {"kind": "raised_voices"})["moments"][0]["said_then"] == "Mais c'est pas possible putain !"
    assert tools.call("loud_moments", {"kind": "quiet"})["moments"] == [{"at": "0:08:00", "seconds": 20.0}]
    read = tools.call("read", {"start": "0:01:55", "end": "0:02:05"})
    assert read["said"] == ["[0:01:57] Attention ça tire !", "[0:01:59] À couvert, à couvert !"]
    assert read["chat"] == ["[0:02:00] lea: ça tire fort", "[0:02:01] Nightbot: ça tire"] and read["heard"]["sounds"] == {"gunfire": 0.9}
    assert tools.call("read", {"start": "0:09:00", "end": "0:09:10"})["said"] == ["(nobody speaks)"]
    # Mistakes come back as data, never as a crash
    assert "error" in tools.call("nope", {}) and "error" in tools.call("read", {"when": "now"})


def test_a_live_never_listened_to_has_no_sound_tools(monkeypatch):
    tools = _tools(monkeypatch, with_sounds=False)
    assert [s["name"] for s in tools.specs()] == ["overview", "search_speech", "search_chat", "read"]
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
        [("answer", {"moments": [{"start": "0:01:57", "end": "0:02:02", "quote": "Attention ça tire", "why": "Fusillade", "score": 90}], "note": "Une fusillade."})],
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
    assert hits[0].text == "Attention ça tire !" and hits[0].start <= 117.0 and hits[0].end >= 119.0


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
