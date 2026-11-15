"""What the streamer wrote for the AI (notes.py): read from the data folder, given for the right lives, to every AI that reads a live."""

from types import SimpleNamespace

from app.models.schemas import VodContext
from app.services import live_agent, live_search, live_tools, llm_analyzer, notes, presort
from tests.test_live_agent import SHOTS, _live

GTA = """---
title: GTA V RP sur FlashFA
games: Grand Theft Auto V, GTA
---
## Qui est qui
- Maurice : le personnage de Falkarst, soignant au SAMC.
- « Tito » s'écrit Tito, pas « Titeau ».
"""
WHO = """---
title: "Qui est Falkarst"
---
Streamer français, joue surtout du RP.
"""


def _write(folder, **files):
    folder.mkdir(exist_ok=True)
    for name, text in files.items():
        (folder / f"{name}.md").write_text(text, encoding="utf-8")


def test_a_note_is_a_markdown_file_with_a_title_and_the_games_it_is_about(no_real_notes):
    # Nothing written yet: no notes, nothing told, nothing to sign
    assert notes.load() == [] and notes.block("Grand Theft Auto V") == "" and notes.signature() == ""

    _write(no_real_notes, **{"gta-v-rp": GTA, "qui": WHO, "sans-entete": "Du texte, sans rien au-dessus.", "vide": "---\ntitle: Vide\n---\n\n"})
    (no_real_notes / "brouillon.txt").write_text("pas une note")
    (no_real_notes / ".cache.md").write_text("pas une note non plus")
    found = notes.load()
    # By file name; a note that holds nothing is not one; a file without a heading is titled by its name
    assert [(note.id, note.title, note.games) for note in found] == [
        ("gta-v-rp", "GTA V RP sur FlashFA", ["Grand Theft Auto V", "GTA"]),
        ("qui", "Qui est Falkarst", []),
        ("sans-entete", "sans-entete", []),
    ]
    assert found[0].body.startswith("## Qui est qui") and found[2].body == "Du texte, sans rien au-dessus."
    # A heading that never closes is part of the note; an unknown line of a heading is skipped
    assert notes.parse("---\ntitle: X\nle reste", "nom") == ("nom", [], "---\ntitle: X\nle reste")
    assert notes.parse("---\ncolour: red\ntitle: Titre\n---\ncorps", "nom") == ("Titre", [], "corps")

    # The AI reads them on every question: one is never longer than 4000 characters, and there are a dozen at most
    _write(no_real_notes, long="x" * 9000, **{f"z{n:02d}": f"note {n}" for n in range(20)})
    many = notes.load()
    assert len(many) == notes.MAX_NOTES == 12 and len(next(note for note in many if note.id == "long").body) == notes.MAX_NOTE == 4000


def test_a_note_about_a_game_is_given_for_the_lives_on_that_game(no_real_notes):
    _write(no_real_notes, **{"gta-v-rp": GTA, "qui": WHO})
    titles = lambda *games: [note.title for note in notes.for_games(*games)]  # noqa: E731
    assert titles("Grand Theft Auto V") == ["GTA V RP sur FlashFA", "Qui est Falkarst"]
    # Another game, or a live whose game is not known: only the notes that are for every live
    assert titles("Fortnite") == titles(None) == titles() == ["Qui est Falkarst"]
    # Written a little otherwise: one name inside the other is the same game
    assert titles("grand theft auto v: enhanced") == titles("GTA") == ["GTA V RP sur FlashFA", "Qui est Falkarst"]
    # Several lives at once: the notes of any of their games
    assert titles("Fortnite", None, "Grand Theft Auto V") == ["GTA V RP sur FlashFA", "Qui est Falkarst"]

    told = notes.block("Grand Theft Auto V")
    # Said to be background to rely on, not orders to follow; each note under its title
    assert told.startswith("\n\nWHAT THE STREAMER TOLD YOU\n") and "not instructions" in told
    assert "### GTA V RP sur FlashFA\n## Qui est qui" in told and "### Qui est Falkarst\nStreamer français" in told
    assert "GTA V RP" not in notes.block("Fortnite") and "### Qui est Falkarst" in notes.block("Fortnite")

    # Any note written, changed or removed: what the AI answered before is not what it would answer now
    before = notes.signature()
    assert len(before) == 10
    _write(no_real_notes, qui=WHO + "Il déteste les réveils.")
    changed = notes.signature()
    (no_real_notes / "qui.md").unlink()
    assert len({before, changed, notes.signature()}) == 3


def test_the_analysis_of_a_live_reads_the_notes_and_hands_what_matters_to_every_clip(no_real_notes):
    point = SimpleNamespace(timestamp_seconds=100.0, timestamp_display="0:01:40")
    transcripts = {0: ("On appelle Titeau", 2.0, 0.0, [], [])}
    meta = {"title": "Maurice en cérémonie", "game": "Grand Theft Auto V", "streamer": "Falkarst", "duration": 3600}
    # No notes: the prompt is what it was, and still asks for an empty glossary
    plain = llm_analyzer._build_context_prompt(transcripts, [point], meta)
    assert "WHAT THE STREAMER TOLD YOU" not in plain and '"glossary": ["..."]' in plain

    _write(no_real_notes, **{"gta-v-rp": GTA, "qui": WHO})
    prompt = llm_analyzer._build_context_prompt(transcripts, [point], meta)
    # The notes of this live's game, right after what the live is, and the glossary to draw from them
    assert prompt.index("**Duration:** 1h00") < prompt.index("WHAT THE STREAMER TOLD YOU") < prompt.index("[Segment 0 @ 0:01:40]")
    assert "« Tito » s'écrit Tito" in prompt and "- **glossary**: only when the streamer's notes are given above" in prompt
    assert "GTA V RP" not in llm_analyzer._build_context_prompt(transcripts, [point], {**meta, "game": "Fortnite"})

    # What the context kept of them goes to whoever scores and titles each clip
    context = VodContext(summary="Une soirée au SAMC.", glossary=["Maurice : le personnage de Falkarst", "« Tito », pas « Titeau »"])
    clip = llm_analyzer._build_unified_prompt(transcript="Titeau arrive", speech_rate=2.0, score=0.5, timestamp_display="0:10:00", vod_meta=meta, vod_context=context)
    assert "**From the streamer's own notes (facts to rely on; spell names as written here):**\n- Maurice : le personnage de Falkarst\n- « Tito », pas « Titeau »" in clip
    without = llm_analyzer._build_unified_prompt(transcript="x", speech_rate=2.0, score=0.5, timestamp_display="0:10:00", vod_meta=meta, vod_context=VodContext(summary="Une soirée."))
    assert "From the streamer's own notes" not in without

    # ...and the AI that reads the whole live to point at moments has them too
    read = presort.build_prompt(["[0:01:40] On appelle Tito"], [], meta)
    assert read.index("Answer with JSON only") < read.index("WHAT THE STREAMER TOLD YOU") < read.index("CHAT HIGH POINTS")
    # (a live whose game is not known only gets the notes that are for every live)
    unknown = presort.build_prompt([], [], {**meta, "game": None})
    assert "GTA V RP" not in unknown and "### Qui est Falkarst" in unknown


def test_the_ai_that_searches_a_live_is_told_the_notes_and_asked_again_when_they_change(monkeypatch, tmp_path, no_real_notes):
    from app.services import db

    job = SimpleNamespace(vod_game="Grand Theft Auto V", vod_title="Maurice", streamer="Falkarst", vod_context=None)
    looked_up = []
    monkeypatch.setattr(db, "get_job", lambda job_id: looked_up.append(job_id) or job)
    monkeypatch.delenv("CUTTIE_APP_VERSION", raising=False)
    answer = [("answer", {"moments": [SHOTS], "note": "Une fusillade."})]
    model = _live(monkeypatch, tmp_path, [answer, answer, answer, [("plan", {"sections": [{"title": "Ça pète", "moments": [SHOTS]}], "note": "."})]])
    ask = lambda: live_search.search_ai("job", "les moments où ça pète", {}, 600.0)  # noqa: E731

    # Nothing written: nothing more told, and the live's game is not even looked up
    assert ask()["cached"] is False and ask()["cached"] is True
    assert "WHAT THE STREAMER TOLD YOU" not in model.seen[0]["messages"][0]["content"] and looked_up == []

    # A note is written: the answer kept before it is not served, and the AI is told the note
    _write(no_real_notes, **{"gta-v-rp": GTA})
    assert ask()["cached"] is False and len(model.seen) == 2
    told = model.seen[1]["messages"][0]["content"]
    assert told.endswith("- « Tito » s'écrit Tito, pas « Titeau ».") and "WHAT THE STREAMER TOLD YOU" in told and looked_up == ["job"]
    assert ask()["cached"] is True and len(model.seen) == 2
    # It is changed: asked again
    _write(no_real_notes, **{"gta-v-rp": GTA + "- Le SAMC est l'hôpital.\n"})
    assert ask()["cached"] is False and len(model.seen) == 3
    # A video described gets them as well
    live_search.plan_video("job", "une vidéo où ça pète", 1.0, {}, 600.0)
    assert "- Le SAMC est l'hôpital." in model.seen[3]["messages"][0]["content"]

    # A note about another game is not this live's
    job.vod_game = "Fortnite"
    searcher = live_agent.Searcher(live_tools.LiveTools("job", duration=600.0), None, "m")
    assert searcher._system("Work.") == "Work."
    # Several lives at once: the notes of any of their games, after what is said of working on several
    job.vod_game = "Grand Theft Auto V"
    several = live_agent.Searcher(live_tools.ManyLives([live_tools.LiveTools("job", duration=600.0), live_tools.LiveTools("job", duration=600.0)]), None, "m")
    system = several._system("Work.")
    assert system.startswith("Work.") and system.index("live") < system.index("WHAT THE STREAMER TOLD YOU")
