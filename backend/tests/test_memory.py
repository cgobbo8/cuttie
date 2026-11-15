"""What the AI remembers of the streamer from one live to the next (memory.py): a live read into it, the memory rewritten,
corrections proposed for the notes the lives contradict, tastes noted from what the streamer tells the AI."""

import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.services import db, live_agent, live_search, llm_analyzer, looks, memory, notes, openai_client, presort, vod_transcript
from app.services.provider_errors import ProviderUnavailable
from app.services.vod_transcript import VodTranscript

META = {"streamer": "Falkarst", "game": "Grand Theft Auto V", "title": "Maurice fait passer son examen à Blue", "date": "2026-11-09"}
ENTRY = {
    "summary": "Soirée au SAMC : Maurice fait passer son examen à Blue, puis se dispute avec Cody.",
    "events": ["[1:12:40] Maurice s'engueule avec Cody à propos des gardes", "[3:05:10] Première rencontre avec Blue, qui passe son examen"],
    "people": [{"name": "Cody", "who": "collègue de Maurice, en froid depuis ce live"}, {"name": "cody", "who": "doublon"}, {"name": "Blue", "who": "nouvelle recrue"}],
    "said": ["Il en a marre des gardes de nuit"],
    "games": ["Grand Theft Auto V"],
}
REWRITTEN = {
    "who": "- Streamer français, RP posé, beaucoup d'autodérision",
    "games": "- GTA V RP sur FlashFA, son personnage : Maurice, soignant au SAMC",
    "people": "- Cody : collègue de Maurice, en froid depuis le 9/11\n- Blue : recrue rencontrée le 9/11",
    "stories": "- La dispute avec Cody sur les gardes (dernier épisode le 9/11)",
    "tastes": "",
    "proposals": [],
}
NOTE = """---
title: Qui est Falkarst
---
Son jeu préféré est GTA, il y joue tous les soirs.
Il streame   du mardi
au samedi.
"""


class Model:
    """Stands for OpenRouter: answers each call with the next JSON (or raises the next error)."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.seen = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.seen.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer, ensure_ascii=False)))], usage=SimpleNamespace(cost=0.004))

    def prompt(self, n: int) -> str:
        return self.seen[n]["messages"][0]["content"]


def _live(monkeypatch, *answers, transcript=True):
    said = VodTranscript(segments=[(100.0, 103.0, " Bon Cody tu me saoules avec tes gardes."), (140.0, 143.0, " Blue, t'es prête pour l'examen ?")])
    monkeypatch.setattr(vod_transcript, "load_cached", lambda job_id: said if transcript else None)
    monkeypatch.setattr(live_search, "read_chat", lambda job_id: [])
    monkeypatch.setattr(db, "get_job", lambda job_id: None)
    model = Model(*answers)
    monkeypatch.setattr(openai_client, "get_openrouter_client", lambda: model)
    return model


MOMENTS = [{"t": 4360.0, "state": "kept", "score": 0.91, "category": "rage", "name": "La dispute", "what": "Maurice et Cody se crient dessus"}]


def test_a_live_is_read_once_and_the_memory_rewritten_from_it(monkeypatch, no_real_memory):
    # Nothing read yet: nothing remembered, nothing told
    assert memory.is_empty() and memory.entries() == [] and memory.block() == "" and memory.tastes() == ""
    model = _live(monkeypatch, ENTRY, REWRITTEN)

    done = memory.note_live("job-a", META, 24560.0, MOMENTS, {"narrative": "Une garde agitée au SAMC.", "protagonists": ["Maurice", "Cody"]})
    # Two calls to the small model: one reads the live, one rewrites the memory
    assert [call["model"] for call in model.seen] == [live_agent.SEARCH_MODEL, live_agent.SEARCH_MODEL]
    assert (done["cached"], done["cost"], done["proposals"]) == (False, 0.008, [])
    reading = model.prompt(0)
    # The whole live: who and what, its transcript by lines, what the analysis kept of it
    assert 'Streamer: Falkarst · Game: Grand Theft Auto V · Title: "Maurice fait passer son examen à Blue" · Date: 2026-11-09 · Length: 6.8 h' in reading
    assert "[0:01:40] Bon Cody tu me saoules avec tes gardes.\n[0:02:20] Blue, t'es prête pour l'examen ?" in reading
    assert "[1:12:40] rage · La dispute · Maurice et Cody se crient dessus" in reading and "Une garde agitée au SAMC." in reading and "protagonists: Maurice; Cody" in reading
    # What was noted of it: bounded, nobody twice, kept with the live
    entry = done["entry"]
    assert (entry["job"], entry["date"], entry["game"], entry["source"], entry["duration"]) == ("job-a", "2026-11-09", "Grand Theft Auto V", "transcript", 24560)
    assert [p["name"] for p in entry["people"]] == ["Cody", "Blue"] and entry["events"] == ENTRY["events"] and entry["said"] == ENTRY["said"]
    assert memory.entry("job-a") == entry and (no_real_memory / "lives" / "job-a.json").is_file()

    # The rewriting sees the memory as it was, the live, and how each section is to be kept
    rewriting = model.prompt(1)
    assert "## who\n(nothing yet)" in rewriting and "(none: this is the first live you read)" in rewriting and "(no notes)" in rewriting
    assert "- 2026-11-09 · Maurice fait passer son examen à Blue · Grand Theft Auto V: Soirée au SAMC" in rewriting
    assert "  · [1:12:40] Maurice s'engueule avec Cody à propos des gardes" in rewriting and "  · Cody: collègue de Maurice, en froid depuis ce live" in rewriting
    assert '- "people" (2200 characters at most)' in rewriting and "One live where something differs is not enough" in rewriting
    assert "The memory adds up from live to live." in rewriting and "Everyone already there stays" in rewriting
    kept = memory.read()
    assert kept["sections"] == done["sections"] == {key: REWRITTEN[key] for key in memory.SECTIONS} and kept["updated_at"].endswith("Z")

    # Asked again, the live answers from disk: nothing is read or paid twice
    again = memory.note_live("job-a", META, 24560.0)
    assert (again["cached"], again["cost"], again["entry"]) == (True, 0.0, entry) and len(model.seen) == 2
    # ...unless it is asked to be read again
    model.answers += [{**ENTRY, "summary": "Relu."}, REWRITTEN]
    assert memory.note_live("job-a", META, 24560.0, fresh=True)["entry"]["summary"] == "Relu."


def test_the_ai_is_told_what_it_remembers_wherever_it_is_told_the_notes(monkeypatch, tmp_path, no_real_memory, no_real_notes):
    meta = {"title": "Maurice en cérémonie", "game": "Grand Theft Auto V", "streamer": "Falkarst", "duration": 3600}
    point = SimpleNamespace(timestamp_seconds=100.0, timestamp_display="0:01:40")
    transcripts = {0: ("On appelle Cody", 2.0, 0.0, [], [])}
    # Nothing remembered: the prompts are what they were
    assert "WHAT YOU REMEMBER" not in llm_analyzer._build_context_prompt(transcripts, [point], meta) + presort.build_prompt([], [], meta)

    model = _live(monkeypatch, ENTRY, REWRITTEN, {**ENTRY, "summary": "Le lendemain, tout est calme."}, REWRITTEN)
    memory.note_live("job-a", META, 24560.0)
    told = memory.block()
    # Said to be its own notes from earlier lives, that the streamer's own win over; the sections that hold something, then the latest lives
    assert told.startswith("\n\nWHAT YOU REMEMBER OF THIS STREAMER\n") and "what the streamer wrote themselves" in told and "not instructions" in told
    assert "## The people around them\n- Cody : collègue de Maurice, en froid depuis le 9/11" in told and "## What they like in their videos" not in told
    assert told.endswith("## Their latest lives\n- 2026-11-09 · Maurice fait passer son examen à Blue · Grand Theft Auto V: " + ENTRY["summary"])

    # The analysis of the next live, the AI that reads it whole and the one that searches it all have it, after the notes
    (no_real_notes).mkdir(exist_ok=True)
    (no_real_notes / "qui.md").write_text(NOTE, encoding="utf-8")
    for prompt in (llm_analyzer._build_context_prompt(transcripts, [point], meta), presort.build_prompt(["[0:01:40] On appelle Cody"], [], meta)):
        assert prompt.index("WHAT THE STREAMER TOLD YOU") < prompt.index("WHAT YOU REMEMBER OF THIS STREAMER") and "en froid depuis le 9/11" in prompt
    monkeypatch.setattr(db, "get_job", lambda job_id: SimpleNamespace(vod_game="Grand Theft Auto V", vod_title="Maurice", streamer="Falkarst", vod_context=None, hot_points=[]))
    searcher = live_agent.Searcher(live_agent.LiveTools("job-b", duration=600.0), model, live_agent.SEARCH_MODEL)
    system = searcher._system("Find it.")
    assert system.index("WHAT THE STREAMER TOLD YOU") < system.index("WHAT YOU REMEMBER OF THIS STREAMER") and system.startswith("Find it.")

    # The next live is read knowing the first: the memory and the lives before it are in both prompts
    memory.note_live("job-b", {**META, "date": "2026-11-10", "title": "Le lendemain"}, 3600.0)
    assert "WHAT YOU REMEMBER OF THIS STREAMER" in model.prompt(2) and "en froid depuis le 9/11" in model.prompt(2)
    rewriting = model.prompt(3)
    assert "## people\n- Cody : collègue de Maurice, en froid depuis le 9/11" in rewriting
    assert "THE LIVES READ BEFORE IT (the latest first)\n- 2026-11-09 · Maurice fait passer son examen à Blue" in rewriting
    # The latest live first, whatever the order they were read in
    assert [e["job"] for e in memory.entries()] == ["job-b", "job-a"]
    # The memory is not what an answer kept on disk is filed under: it changes with every analysis
    assert all("memory" not in part for part in live_search.answered_by())


def test_a_note_the_lives_contradict_gets_a_correction_proposed_on_its_exact_words(monkeypatch, no_real_memory, no_real_notes):
    no_real_notes.mkdir(exist_ok=True)
    (no_real_notes / "qui.md").write_text(NOTE, encoding="utf-8")
    stale = {"note": "[qui]", "before": "Son jeu préféré est GTA, il y joue tous les soirs.", "after": "Il jouait surtout à GTA ; depuis novembre il est passé à Crimson Desert.", "why": "Tes cinq derniers lives sont sur Crimson Desert."}
    answers = {
        **REWRITTEN,
        "proposals": [
            stale,
            # Words the note holds with other spaces: found as the note has them
            {"note": "qui", "before": "Il streame du mardi au samedi.", "after": "Il streame du lundi au vendredi.", "why": "Vu sur trois lives."},
            # A third one: two at most
            {"note": "qui", "before": "Son jeu préféré est GTA", "after": "Son jeu préféré était GTA", "why": "Encore."},
        ],
    }
    model = _live(monkeypatch, ENTRY, answers)
    proposals = memory.note_live("job-a", META, 3600.0)["proposals"]
    assert "### [qui] Qui est Falkarst\nSon jeu préféré est GTA" in model.prompt(1)
    assert [(p["note"], p["note_title"], p["before"], p["after"]) for p in proposals] == [
        ("qui", "Qui est Falkarst", stale["before"], stale["after"]),
        ("qui", "Qui est Falkarst", "Il streame   du mardi\nau samedi.", "Il streame du lundi au vendredi."),
    ]
    assert proposals[0]["why"] == stale["why"] and proposals[0]["id"] == memory.proposal_id("qui", stale["before"]) and len(proposals[0]["id"]) == 12

    written = notes.load()
    # Dropped: a note that doesn't exist, words the note doesn't hold, nothing changed, nothing to write, twice the same sentence
    for bad in (
        {**stale, "note": "inconnue"},
        {**stale, "before": "Son jeu préféré est Fortnite depuis toujours."},
        {**stale, "after": stale["before"]},
        # (the sentence kept whole with a fact added after it: an addition, not a correction)
        {**stale, "after": stale["before"] + " Il a repris le RP en octobre."},
        {**stale, "after": ""},
        {**stale, "before": "GTA"},
        "pas un objet",
    ):
        assert memory.clean_proposals([bad], written) == []
    assert len(memory.clean_proposals([stale, {**stale, "after": "Autre chose."}], written)) == 1
    assert memory.clean_proposals(None, written) == []


def test_a_taste_said_to_the_ai_is_noted_once_and_survives_the_rewriting(monkeypatch, no_real_memory):
    day = datetime(2026, 11, 15)
    assert memory.remember(["N'aime pas les passages de plus de 10 secondes", "  ", "court"], day) == ["N'aime pas les passages de plus de 10 secondes"]
    assert memory.tastes() == "- N'aime pas les passages de plus de 10 secondes (15/11/2026)"
    # Said again, or nearly: not noted twice. Nothing said: nothing done
    assert memory.remember(["n'aime pas les passages de plus de 10 secondes.", "Veut toujours une musique discrète"], day) == ["Veut toujours une musique discrète"]
    assert memory.remember([]) == memory.remember(None) == memory.remember("pas une liste") == []
    assert memory.tastes().splitlines() == ["- N'aime pas les passages de plus de 10 secondes (15/11/2026)", "- Veut toujours une musique discrète (15/11/2026)"]
    # Three at most from one answer
    more = ["Préfère les sous-titres en jaune", "Ne veut jamais de zoom sur son visage", "Aime finir sur un fou rire", "Trouve les titres trop longs", "Veut du phonk sur les kills"]
    assert memory.remember(more, day) == more[:3]

    # The tastes are told with the memory, and given to what chooses a video's music and intro
    assert "## What they like in their videos\n- N'aime pas les passages de plus de 10 secondes (15/11/2026)" in memory.block()
    chooser = Model({"kind": "funny", "music": "none", "opening": "none", "why": "."})
    looks.choose_sound({"title": "Calme", "seconds": 40, "said": ["Bon"]}, [{"key": "drift", "name": "Drift", "about": "Phonk", "kinds": ["hype"]}], client=chooser)
    assert "What they said before about what they like in their videos (honour it unless they ask otherwise now):\n- N'aime pas les passages" in chooser.prompt(0)

    # A rewriting that forgets the tastes doesn't lose them
    model = _live(monkeypatch, ENTRY, {**REWRITTEN, "tastes": ""})
    before = memory.tastes()
    assert memory.note_live("job-a", META, 3600.0)["sections"]["tastes"] == before
    # ...and one noted while the model was thinking is kept beside what it rewrote
    start = memory.read

    def late(*args, **kwargs):
        memory.remember(["Déteste les intros qui durent"], day)
        return ENTRY | {"tastes": "- Aime les vidéos courtes"}, 0.001, "model"

    monkeypatch.setattr(memory, "_ask", late)
    sections, _proposals, _cost = memory.consolidate({**ENTRY, "job": "job-b"})
    lines = sections["tastes"].splitlines()
    # What the model wrote from the lives first, then every taste the streamer told the AI, word for word
    assert lines[0] == "- Aime les vidéos courtes" and lines[1:] == [*before.splitlines(), "- Déteste les intros qui durent (15/11/2026)"]
    assert start()["sections"]["tastes"] == sections["tastes"]
    # A model that gives a told taste back in its own words doesn't double it
    assert memory._with_told("- Aime les vidéos courtes\n- N'aime pas les passages de plus de 10 secondes", before).splitlines() == ["- Aime les vidéos courtes", *before.splitlines()]


def test_nobody_leaves_the_memory_because_one_live_did_not_show_them(monkeypatch, no_real_memory):
    before = "- Cody : collègue de Maurice, en froid depuis le 9/11\n- Blue Granger : recrue du SAMC\n- Rallen : chef du SAMC\n- Une ligne sans nom"
    # The model gave back the people of the last live only, one of them under a fuller name
    after = "- Cody Marsh : collègue de Maurice, réconcilié le 10/11\n- Andrew Butler : binôme de Maurice au bloc"
    assert memory._with_everyone(after, before, 2200).splitlines() == [
        "- Cody Marsh : collègue de Maurice, réconcilié le 10/11",
        "- Andrew Butler : binôme de Maurice au bloc",
        "- Blue Granger : recrue du SAMC",
        "- Rallen : chef du SAMC",
    ]
    # No room left: the model's choice stands
    assert memory._with_everyone(after, before, len(after) + 20) == after
    assert memory._with_everyone("", before, 2200).splitlines() == before.splitlines()[:3]
    # Through a whole rewriting
    _live(monkeypatch, ENTRY, REWRITTEN, {**ENTRY, "summary": "Le lendemain."}, {**REWRITTEN, "people": "- Andrew : binôme de Maurice"})
    memory.note_live("job-a", META, 3600.0)
    people = memory.note_live("job-b", {**META, "date": "2026-11-10"}, 3600.0)["sections"]["people"]
    assert people.splitlines() == ["- Andrew : binôme de Maurice", "- Cody : collègue de Maurice, en froid depuis le 9/11", "- Blue : recrue rencontrée le 9/11"]


def test_the_plan_of_a_video_hands_over_the_tastes_the_streamer_states(no_real_memory):
    # Declared on the plan's answer, asked for when a video is changed
    assert live_agent.PLAN_SPEC["parameters"]["properties"]["remember"]["type"] == "array" and "give it in `remember`" in live_agent.REVISE
    assert live_agent._tastes({"remember": ["  N'aime pas   les longs passages ", 7, "", "a", "b", "c"]}) == ["N'aime pas les longs passages", "a", "b"]
    assert live_agent._tastes({}) == live_agent._tastes({"remember": "non"}) == []


def test_a_live_without_its_transcript_is_noted_from_what_the_analysis_kept(monkeypatch, no_real_memory):
    model = _live(monkeypatch, ENTRY, REWRITTEN, transcript=False)
    done = memory.note_live("job-a", META, 3600.0, MOMENTS, {"narrative": "Une garde agitée."})
    assert done["entry"]["source"] == "analysis" and "no longer on this machine" in model.prompt(0) and "TRANSCRIPT (" not in model.prompt(0)
    # Nothing at all to read it from: said so, nothing is paid
    with pytest.raises(live_search.NoTranscript):
        memory.note_live("job-b", META, 3600.0)
    assert len(model.seen) == 2


def test_a_model_that_fails_hands_over_to_the_fallback_and_no_credits_stops_everything(monkeypatch, no_real_memory):
    model = _live(monkeypatch, RuntimeError("model retired"), ENTRY, REWRITTEN)
    memory.note_live("job-a", META, 3600.0)
    assert [call["model"] for call in model.seen] == [live_agent.SEARCH_MODEL, live_agent.FALLBACK_MODEL, live_agent.SEARCH_MODEL]
    # The live is not kept as read when nothing came back, and the memory is untouched
    class NoCredits(Exception):
        status_code = 402

    broke = _live(monkeypatch, NoCredits("insufficient credits"))
    with pytest.raises(ProviderUnavailable):
        memory.note_live("job-b", META, 3600.0)
    assert memory.entry("job-b") is None and len(broke.seen) == 1
    empty = _live(monkeypatch, {"summary": "  "})
    with pytest.raises(ValueError):
        memory.note_live("job-c", META, 3600.0)
    assert memory.entry("job-c") is None


def test_what_a_model_gives_back_is_kept_short_and_as_lines():
    # A section is lines starting with « - », however the model wrote them; headings and blanks are dropped
    assert memory._lines("## Titre\n* Un\n\n•  Deux   mots\nTrois", 900) == "- Un\n- Deux mots\n- Trois"
    assert memory._lines(["Un", "Deux"], 900) == "- Un\n- Deux"
    # Never longer than its limit: the last lines go
    short = memory._lines("\n".join(f"ligne {n} " + "x" * 80 for n in range(40)), 900)
    assert len(short) <= 900 and short.splitlines()[0].startswith("- ligne 0 ") and len(short.splitlines()) == 9
    # A section the model left out stays as it was
    before = {key: f"- {key}" for key in memory.SECTIONS}
    assert memory.clean_sections({"who": "- nouveau"}, before) == {**before, "who": "- nouveau"}
    # An entry: every list bounded
    noted = memory.clean_entry({"summary": " Un   live. ", "events": [f"e{n}" for n in range(20)], "people": [{"name": f"p{n}"} for n in range(20)], "said": "non", "games": ["GTA", "GTA"]})
    assert (noted["summary"], len(noted["events"]), len(noted["people"]), noted["said"], noted["games"]) == ("Un live.", 8, 12, [], ["GTA"])
