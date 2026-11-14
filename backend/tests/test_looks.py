"""Choosing each passage's template by looking at it: what the model is shown, what is made of its answer (the model is faked)."""

import json
from types import SimpleNamespace

import pytest

from app.services import live_agent, llm_text, looks
from app.services.provider_errors import ProviderUnavailable

TEMPLATES = [
    {"key": "custom-abc", "name": "Mes fails", "description": "Picture: the game, fills the whole frame.\nGood for: fails.", "needs_cam": False},
    {"key": "empile", "name": "Empilé", "description": "Webcam: the streamer's face, above the game.\nGood for: talking while playing.", "needs_cam": True},
    {"key": "plein", "name": "Action", "description": "Picture: the game, fills the whole frame.\nGood for: action.", "needs_cam": False},
    {"key": "sanscam", "name": "Sans cam", "description": "Webcam: not shown.\nGood for: nobody in the webcam.", "needs_cam": False},
]
CAM = {"x": 1518, "y": 0, "w": 402, "h": 446, "frame_w": 1920, "frame_h": 1080}


class Eyes:
    """A fake model: answers each call with the next prepared JSON (or raises it), and keeps what it was shown."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.seen = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.seen.append(kwargs)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps(answer)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))], usage=SimpleNamespace(cost=0.002))


def _pieces(count, cam=True):
    return [{"id": f"piece{n:02d}", "file": f"piece_piece{n:02d}.mp4", "start": 1.0, "end": 5.0, "text": f"Phrase {n}", "cam": cam} for n in range(1, count + 1)]


@pytest.fixture
def clips(monkeypatch, tmp_path):
    """A live's folder with its pieces; frames are named after where they were taken instead of being read."""
    monkeypatch.setattr(looks.paths, "clip_dir", lambda job_id: str(tmp_path))
    for n in range(1, 30):
        (tmp_path / f"piece_piece{n:02d}.mp4").write_bytes(b"mp4")
    monkeypatch.setattr(looks, "frames_of", lambda path, start, end, count=looks.FRAMES: [f"data:image/jpeg;base64,{path[-12:-4]}-{i}" for i in range(count)])
    return tmp_path


def test_the_main_template_is_settled_once_then_each_passage_is_looked_at(clips):
    eyes = Eyes(
        {"main": "empile", "why": "Empilé : la caméra en haut, le jeu recadré dessous."},
        {
            "passages": [{"n": 1, "template": "empile", "why": "Il parle face caméra"}, {"n": 2, "template": "plein", "why": "Course-poursuite"}, {"n": 3, "template": "empile", "why": "Réaction"}],
            "note": "Action pour la poursuite.",
        },
    )
    chosen = looks.choose("job", _pieces(3), TEMPLATES, wish="ma caméra en haut, le jeu en dessous", cam=CAM, language="fr", client=eyes, usual="plein")
    assert chosen == {
        "main": "empile",
        "looks": {"piece01": "empile", "piece02": "plein", "piece03": "empile"},
        "reasons": {"piece01": "Il parle face caméra", "piece02": "Course-poursuite", "piece03": "Réaction"},
        "note": "Empilé : la caméra en haut, le jeu recadré dessous. Action pour la poursuite.",
        "cost": 0.004,
    }
    # First, the template of the whole video: every template as the app describes it, what was asked, the usual one
    first = eyes.seen[0]
    asked = first["messages"][0]["content"]
    assert first["model"] == live_agent.SEARCH_MODEL
    assert all(f"[{t['key']}] {t['name']}\n{t['description']}" in asked for t in TEMPLATES)
    assert "« ma caméra en haut, le jeu en dessous »" in asked and "Their usual template: [plein]." in asked and "in French" in asked
    # Then the passages, the main template settled
    call = eyes.seen[1]
    assert call["model"] == looks.EYES_MODEL
    told = call["messages"][0]["content"]
    assert "main template is [empile] (Empilé): it is settled" in told and "« ma caméra en haut, le jeu en dessous »" in told
    assert all(f"[{t['key']}] {t['name']}" in told for t in TEMPLATES) and "the inset at the top right (79% to 100% across" in told
    shown = call["messages"][1]["content"]
    # Each passage: what is said, whether someone is in the webcam, then its three frames
    assert [part["type"] for part in shown] == ["text", "image_url", "image_url", "image_url"] * 3
    assert shown[0]["text"] == "Passage 1: 4 s, someone in the webcam: yes. Said: « Phrase 1 »"
    assert shown[5]["image_url"] == {"url": "data:image/jpeg;base64,_piece02-0", "detail": "low"}


def test_nothing_asked_keeps_the_usual_template(clips):
    # No question about the main template: the streamer's usual one, and the note only speaks of what changed
    eyes = Eyes({"passages": [{"n": 1, "template": "plein"}, {"n": 2, "template": "plein"}], "note": "Rien changé."})
    chosen = looks.choose("job", _pieces(2), TEMPLATES, client=eyes, usual="plein")
    assert len(eyes.seen) == 1 and chosen["main"] == "plein" and chosen["looks"] == {"piece01": "plein", "piece02": "plein"} and chosen["note"] == ""
    assert "main template is [plein] (Action): it is settled. Every passage" in eyes.seen[0]["messages"][0]["content"]
    # No usual one either (or one that is gone): the first of the list
    assert looks.choose("job", _pieces(1), TEMPLATES, client=Eyes({"passages": []}), usual="gone")["main"] == "custom-abc"


def test_what_the_model_answers_is_made_safe(clips):
    # A key that doesn't exist, a passage it forgot, a template built around the webcam where nobody is in it
    eyes = Eyes({"passages": [{"n": 1, "template": "nonsense"}, {"n": 3, "template": "empile", "why": "x" * 400}], "note": ""})
    pieces = _pieces(3)
    pieces[2]["cam"] = False
    chosen = looks.choose("job", pieces, TEMPLATES, client=eyes, usual="empile")
    assert chosen["looks"] == {"piece01": "empile", "piece02": "empile", "piece03": "sanscam"}
    assert len(chosen["reasons"]["piece03"]) == 160
    # Without the game-only layout, another that does without the webcam
    assert looks.choose("job", pieces, TEMPLATES[:3], client=Eyes({"passages": []}), usual="empile")["looks"]["piece03"] == "custom-abc"
    # The main template: an answer that names none, or isn't JSON, leaves the usual one
    for answer in ({"main": "nonsense", "why": "?"}, "Je ne sais pas."):
        assert looks.choose("job", pieces[:1], TEMPLATES, wish="comme tu veux", client=Eyes(answer, {"passages": []}), usual="plein")["main"] == "plein"
    # The passages: an answer that isn't JSON, or nothing to choose from, is said, not guessed
    with pytest.raises(ValueError):
        looks.choose("job", pieces, TEMPLATES, client=Eyes("Je ne sais pas."))
    with pytest.raises(ValueError):
        looks.choose("job", [], TEMPLATES, client=Eyes())
    with pytest.raises(ValueError):
        looks.choose("job", pieces, [], client=Eyes())


def test_many_passages_are_looked_at_in_batches_that_agree(clips):
    def batch(count, changed=None, note=""):
        return {"passages": [{"n": n, "template": "plein" if n == changed else "empile"} for n in range(1, count + 1)], "note": note}

    eyes = Eyes(batch(16, note="Rien à signaler."), batch(7, changed=2, note="Action pour la course."))
    chosen = looks.choose("job", _pieces(23), TEMPLATES, client=eyes, usual="empile")
    assert len(eyes.seen) == 2 and chosen["cost"] == 0.004 and chosen["main"] == "empile"
    # Both batches are told the same main template: none can decide another for the video
    assert all("main template is [empile] (Empilé): it is settled" in call["messages"][0]["content"] for call in eyes.seen)
    assert [chosen["looks"][f"piece{n:02d}"] for n in (1, 16, 17, 18, 23)] == ["empile", "empile", "empile", "plein", "empile"]
    # Only what changed is worth a word
    assert chosen["note"] == "Action pour la course."
    # A piece whose clip is gone is still given a template, from what is said
    (clips / "piece_piece02.mp4").unlink()
    eyes = Eyes(batch(2))
    looks.choose("job", _pieces(2), TEMPLATES, client=eyes, usual="empile")
    assert [part["type"] for part in eyes.seen[0]["messages"][1]["content"]] == ["text", "image_url", "image_url", "image_url", "text"]


def test_no_credits_is_said_as_such(clips):
    class Refused(Exception):
        status_code = 402

    # Asked for a look or not: the first call that is refused stops everything
    for wish in ("", "ma caméra en haut"):
        with pytest.raises(ProviderUnavailable) as refused:
            looks.choose("job", _pieces(1), TEMPLATES, wish=wish, client=Eyes(Refused("no credits")))
        assert refused.value.reason == "credits"
    # The main template's call failing for another reason doesn't stop the layout: the usual one stands
    chosen = looks.choose("job", _pieces(1), TEMPLATES, wish="ma caméra en haut", client=Eyes(TimeoutError("slow"), {"passages": []}), usual="plein")
    assert chosen["main"] == "plein"


def test_frames_are_taken_inside_the_passage(monkeypatch, tmp_path):
    monkeypatch.setattr(looks.paths, "WORK_DIR", str(tmp_path))
    taken = []

    def run(command, **kwargs):
        taken.append(float(command[command.index("-ss") + 1]))
        with open(command[-1], "wb") as f:
            f.write(b"\xff\xd8" + b"0" * 900)

    monkeypatch.setattr(looks.subprocess, "run", run)
    urls = looks.frames_of("/clips/piece.mp4", 10.0, 20.0)
    # Near the beginning, in the middle, near the end: never on the cut itself
    assert taken == [11.2, 15.0, 18.8] and len(urls) == 3 and urls[0].startswith("data:image/jpeg;base64,/9g")
    assert list(tmp_path.iterdir()) == []


def test_what_a_template_is_good_for_is_written_from_its_description(monkeypatch):
    asked = []

    def complete(prompt, **kwargs):
        asked.append(prompt)
        return llm_text.Answer(' « Pour les moments d\'action : le jeu prend\n tout l\'écran. » ', 300, 40, 0.0004, 1.0)

    monkeypatch.setattr(looks.llm_text, "complete", complete)
    written = looks.write_usage("Mes fails", "Picture: the game, fills the whole frame.", "fr")
    assert written == {"usage": "Pour les moments d'action : le jeu prend tout l'écran.", "cost": 0.0004}
    assert "Name: Mes fails" in asked[0] and "Picture: the game, fills the whole frame." in asked[0] and "in French" in asked[0]
    looks.write_usage("Mine", "Picture: ...", "en")
    assert "in English" in asked[1]
