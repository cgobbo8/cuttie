"""Compilations the AI proposes on its own once a live is analysed: what comes back in the live,
the ideas it gives and how they are kept, and its eyes (the models are faked)."""

import json

import pytest

from app.services import live_agent, live_ideas, live_tools, openai_client, sound_index
from app.services import live_search as ls
from app.services.vod_transcript import VodTranscript
from tests.test_live_agent import FakeModel, _tools


def _lines(*texts: str, every: float = 30.0) -> VodTranscript:
    return VodTranscript(segments=[(i * every, i * every + 3.0, f" {text}") for i, text in enumerate(texts)])


def test_what_is_said_again_and_again_stands_out():
    live = _lines(
        "Franchement c'est calme ce soir.", "La brigade tigre arrive Maurice.", "Ouais c'est calme hein.", "Maurice appelle la brigade tigre.",
        "Trop calme, c'est calme.", "Brigade tigre, attendez Maurice.", "Qu'est-ce que c'est calme !", "On y va Maurice, brigade tigre.",
        "C'est calme, j'aime pas ça.", "Allez Maurice, la brigade tigre.", "Bon bah c'est calme.", "Maurice ? Brigade tigre ?",
    )
    said = {row["said"]: row for row in live_ideas.recurring(live)}
    # What people keep saying, with how many lines say it and when (a line that says it twice counts once)
    assert said["calme"]["times"] == 6 and said["calme"]["first"] == "0:00:00" and said["calme"]["last"] == "0:05:00"
    assert len(said["calme"]["at"]) >= 3 and "more_than_usual" not in said["calme"]
    # A phrase stands for the words it is made of when they are nearly always said together, and tells more than a word
    assert said["brigade tigre"]["times"] == 6 and "brigade" not in said and "tigre" not in said and list(said)[0] == "brigade tigre"
    # Hollow words never count on their own, nor a phrase that starts or ends on one
    assert set(said) == {"brigade tigre", "calme", "maurice"}

    # Next to the streamer's other lives, what is said every evening is not this live's
    usual = _lines(*["Maurice appelle la brigade tigre.", "La brigade tigre arrive Maurice.", "Allez Maurice, brigade tigre."] * 4)
    compared = live_ideas.recurring(live, [usual])
    assert [row["said"] for row in compared] == ["calme"] and compared[0]["more_than_usual"].startswith("x")

    # Said three times: not a pattern
    assert live_ideas.recurring(_lines("la brigade tigre", "rien", "brigade tigre", "rien du tout", "brigade tigre !")) == []


def test_the_tool_says_what_comes_back(monkeypatch):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_ideas, "_other_lives", lambda job_id: [])
    tools.transcript = _lines(*["Mais c'est pas possible !"] * 5)
    again = tools.call("recurring", {})
    assert again["found"] == 1 and again["phrases"][0]["said"] == "pas possible" and again["phrases"][0]["times"] == 5
    assert "no other live" in again["compared_with"]
    # A tool of the one that proposes videos: a search doesn't have it
    assert "recurring" not in [spec["name"] for spec in tools.specs()]


IDEA = {
    "title": "Qu'est-ce que c'est calme",
    "brief": "Fais-moi une vidéo en deux parties : d'abord tous les moments où quelqu'un dit que la soirée est calme, puis quand tout part en vrille.",
    "seconds": 60,
    "pitch": "« C'est calme » est dit 25 fois avant que tout s'emballe.",
    "tags": ["Running gag", "#ironie", "running gag", "une étiquette bien trop longue pour tenir ici"],
    "kind": "funny",
    "score": 86,
    "moments": ["0:01:40", "0:01:41", "0:05:00", "1:00:00", 117.0],
}


def test_ideas_are_checked_before_being_kept():
    ideas = live_ideas.clean_ideas(
        [
            {**IDEA, "title": "Faible", "score": 40},
            {**IDEA, "title": "Sans moments", "moments": ["0:01:40"]},
            {**IDEA, "title": "Sans demande", "brief": "trop court"},
            {**IDEA, "title": "Les kills", "brief": IDEA["brief"] + " Et les kills.", "score": 72, "kind": "nope", "seconds": 400, "tags": "kills"},
            "not an idea",
            IDEA,
            IDEA,
        ],
        duration=600.0,
    )
    # The best first; the weak one, the one with one moment, the one with nothing to build from and the copy are gone
    assert [idea["title"] for idea in ideas] == ["Qu'est-ce que c'est calme", "Les kills"]
    best, kills = ideas
    assert best["score"] == 86 and best["seconds"] == 60 and best["kind"] == "funny" and best["pitch"].startswith("« C'est calme »")
    # Tags: lowercase, once each, short; moments: live seconds, in order, those past the live's end or said twice left out
    assert best["tags"] == ["running gag", "ironie", "une étiquette bien trop "]
    assert best["moments"] == [100.0, 117.0, 300.0]
    assert kills["kind"] is None and kills["seconds"] == live_ideas.MAX_SECONDS and kills["tags"] == []
    # The same idea is named the same from one search to the next
    assert best["key"] == live_ideas.idea_key(IDEA["title"], IDEA["brief"]) and best["key"] != kills["key"] and len(best["key"]) == 12
    assert live_ideas.clean_ideas(None, 600.0) == [] and len(live_ideas.clean_ideas([{**IDEA, "title": f"Idée {i}", "brief": f"{IDEA['brief']} {i}"} for i in range(9)], 600.0)) == live_ideas.MAX_IDEAS


def test_the_ai_looks_through_the_live_and_proposes_videos(monkeypatch):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_ideas, "_other_lives", lambda job_id: [])
    model = FakeModel([
        [("overview", {}), ("recurring", {}), ("chat_peaks", {})],
        [("search_speech", {"words": "calme"})],
        [("suggest", {"ideas": [IDEA], "note": "Un running gag."})],
    ])
    monkeypatch.setattr(live_tools.LiveTools, "tool_overview", lambda self: {"title": "Soirée"})
    run = live_agent.Searcher(tools, model, "some/model").suggest(most=3)
    assert run.finished and run.ideas == [IDEA] and run.note == "Un running gag." and run.moments == []
    # It was told what a compilation is and how many to give, and had the tool that says what comes back, then `suggest` to end
    system = model.seen[0]["messages"][0]["content"]
    assert "compilations worth making" in system and "3 ideas at most" in system and "{" not in system.replace("{most}", "")
    names = [f["function"]["name"] for f in model.seen[0]["tools"]]
    assert "recurring" in names and names[-1] == "suggest" and "answer" not in names
    assert json.loads(model.seen[1]["messages"][-2]["content"])["found"] >= 0

    # Answered in text, or never: it still ends (the last step forces `suggest`)
    text = live_agent.Searcher(tools, FakeModel(['{"ideas": [], "note": "rien qui revient"}']), "m").suggest()
    assert text.finished and text.ideas == [] and text.note == "rien qui revient"
    loop = FakeModel([[("read", {"start": 0, "end": 10})]] * 2)
    live_agent.Searcher(tools, loop, "m").suggest(max_steps=3)
    assert loop.seen[2]["tool_choice"] == {"type": "function", "function": {"name": "suggest"}}


def test_what_is_said_twenty_times_is_not_left_out(monkeypatch):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_ideas, "_other_lives", lambda job_id: [])
    tools.transcript = _lines(*["Franchement c'est calme.", "Maurice arrive."] * 12, "Attention ça tire !")
    other = {**IDEA, "title": "Maurice au garage", "brief": "Fais-moi une vidéo de toutes les fois où Maurice arrive au garage, les meilleures.", "pitch": "Maurice y revient sans cesse.", "tags": ["garage"]}
    model = FakeModel([
        [("recurring", {})],
        [("suggest", {"ideas": [other], "note": "Une idée."})],
        [("search_speech", {"words": "calme"})],
        [("suggest", {"ideas": [other, IDEA], "note": "Deux idées."})],
    ])
    run = live_agent.Searcher(tools, model, "m").suggest()
    # Its first answer said nothing of what is said twelve times: sent back once, naming it (and not what an idea is already about)
    back = json.loads(model.seen[2]["messages"][-1]["content"])["error"]
    assert "calme » x12" in back and "maurice" not in back and "search_speech" in back
    assert run.finished and [idea["title"] for idea in run.ideas] == ["Maurice au garage", IDEA["title"]] and run.note == "Deux idées."
    # Everything followed: the ideas are taken as they come
    straight = FakeModel([[("suggest", {"ideas": [other, IDEA], "note": "Deux idées."})]])
    assert live_agent.Searcher(tools, straight, "m").suggest().steps == 1
    # The same answer given again after being sent back stands: it is asked once, not until it gives in
    stubborn = FakeModel([[("suggest", {"ideas": [other], "note": "Une idée."})]] * 2)
    assert live_agent.Searcher(tools, stubborn, "m").suggest().steps == 2


def _live(monkeypatch, tmp_path, steps):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_ideas, "load_cached", lambda job_id: tools.transcript)
    monkeypatch.setattr(live_ideas, "_other_lives", lambda job_id: [])
    monkeypatch.setattr(ls, "load_cached", lambda job_id: tools.transcript)
    monkeypatch.setattr(ls.paths, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    monkeypatch.setattr(sound_index, "transcript_dir", lambda job_id: str(tmp_path / job_id))
    model = FakeModel(steps)
    monkeypatch.setattr(openai_client, "get_openrouter_client", lambda: model)
    return model


def test_a_live_is_looked_through_once(monkeypatch, tmp_path):
    model = _live(monkeypatch, tmp_path, [
        [("recurring", {})],
        [("suggest", {"ideas": [IDEA, {**IDEA, "title": "Trop faible", "score": 30}], "note": "Un running gag, vérifié."})],
    ])
    found = live_ideas.suggest_videos("job", {"streamer": "Maurice"}, 600.0)
    assert found["cached"] is False and found["cost"] == 0.002 and found["note"] == "Un running gag, vérifié."
    assert [idea["title"] for idea in found["ideas"]] == ["Qu'est-ce que c'est calme"] and found["ideas"][0]["moments"] == [100.0, 117.0, 300.0]
    # Its own model, with its own ceiling
    assert model.seen[0]["model"] == live_agent.IDEAS_MODEL
    # Asked again: from the disk, nothing spent
    again = live_ideas.suggest_videos("job", {}, 600.0)
    assert again["cached"] is True and again["cost"] == 0.0 and again["ideas"] == found["ideas"] and len(model.seen) == 2
    assert ls.doing("job") is None

    monkeypatch.setattr(live_ideas, "load_cached", lambda job_id: None)
    with pytest.raises(ls.NoTranscript):
        live_ideas.suggest_videos("job", {}, 600.0)


def test_a_proposed_video_is_built_from_the_moments_spotted_for_it(monkeypatch, tmp_path):
    model = _live(monkeypatch, tmp_path, [[("plan", {"sections": [{"title": "Calme", "moments": [
        {"start": "0:01:40.0", "end": "0:01:40.0", "quote": "c'est calme", "why": "Dit que c'est calme", "score": 90},
    ]}], "note": "Une partie."})]])
    planned = ls.plan_video("job", IDEA["brief"], 1.0, {}, 600.0, leads=[300.0, 100.0])
    assert planned["sections"][0]["hits"][0]["start"] == 100.0
    # The one that builds it is told where the first look saw moments, in the order of the live
    ask = model.seen[0]["messages"][1]["content"]
    assert "0:01:40, 0:05:00" in ask and "Start there" in ask
    # A video the streamer described has no such lead
    # (an empty plan is sent back once: it is given twice)
    other = _live(monkeypatch, tmp_path, [[("plan", {"sections": [], "note": "rien"})]] * 2)
    ls.plan_video("job", "autre chose", 30.0, {}, 600.0)
    assert "first look" not in other.seen[0]["messages"][1]["content"]


def test_looking_goes_to_the_model_that_sees(monkeypatch):
    tools = _tools(monkeypatch)
    monkeypatch.setattr(live_agent, "live_audio_url", lambda url: None)
    monkeypatch.setattr(live_agent, "live_video_url", lambda url: "https://vod/480p/index.m3u8")
    fetched = []
    monkeypatch.setattr(live_agent, "fetch_frames", lambda url, times: fetched.append(times) or [f"data:image/jpeg;base64,{i}" for i in range(len(times))])
    model = FakeModel([[("look", {"start": "0:02:00", "end": "0:02:06", "question": "fait-il un kill ?"})], "Un joueur tombe, le kill feed affiche son nom.", [("answer", {"moments": [], "note": "ok"})]])
    searcher = live_agent.Searcher(tools, model, "agent/model", vod_url="https://www.twitch.tv/videos/1", eyes_model="eyes/model")
    run = searcher.search("les kills")
    # Three images over the seconds asked, sent to the eyes with the question; the agent got what they saw
    assert fetched == [[120.0, 123.0, 126.0]] and run.looks == 1 and run.finished
    eyes = model.seen[1]
    assert eyes["model"] == "eyes/model" and "fait-il un kill" in eyes["messages"][0]["content"][0]["text"]
    assert [part["image_url"]["url"] for part in eyes["messages"][0]["content"][1:]] == [f"data:image/jpeg;base64,{i}" for i in range(3)]
    assert json.loads(model.seen[2]["messages"][-1]["content"]) == {"from": "0:02:00", "to": "0:02:06", "seen": "Un joueur tombe, le kill feed affiche son nom."}
    # It was told when to look, and that looking only confirms
    names = [f["function"]["name"] for f in model.seen[0]["tools"]]
    system = model.seen[0]["messages"][0]["content"]
    assert "look" in names and "listen" in names and "what is seen rather than said" in system and "not to browse the live" in system

    # No end given: six seconds; never more than twelve; no more looks than allowed
    searcher.look("0:03:00")
    searcher.look("0:03:00", "0:09:00")
    assert fetched[1:] == [[180.0, 183.0, 186.0], [180.0, 186.0, 192.0]]
    searcher.run.looks = live_agent.MAX_LOOKS
    assert "error" in searcher.look("0:01:00")
    # Images that can't be fetched, a live gone from Twitch: said, the search goes on
    searcher.run.looks = 0
    monkeypatch.setattr(live_agent, "fetch_frames", lambda url, times: [])
    assert "could not be fetched" in searcher.look("0:01:00")["error"] and searcher.run.looks == 0
    gone = live_agent.Searcher(tools, FakeModel([]), "m", vod_url="https://www.twitch.tv/videos/1")
    monkeypatch.setattr(live_agent, "live_video_url", lambda url: None)
    assert "can't be reached" in gone.look("0:01:00")["error"]
    # A live with no address has neither ears nor eyes
    assert not {"look", "listen"} & {spec["name"] for spec in live_agent.Searcher(tools, FakeModel([]), "m").specs()}
