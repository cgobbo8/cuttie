"""A background music measured and listened to: what is measured on a real sound, what the model is sent and what is made of its answer (the model is faked)."""

import base64
import json
import subprocess
from types import SimpleNamespace

import pytest

from app.services import live_agent, music_library
from app.services.provider_errors import ProviderUnavailable


class Ears:
    """A fake model that hears: answers with the prepared JSON (or raises it), and keeps what it was sent."""

    def __init__(self, answer):
        self.answer = answer
        self.seen = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.seen.append(kwargs)
        if isinstance(self.answer, Exception):
            raise self.answer
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(self.answer)))], usage=SimpleNamespace(cost=0.0012))


@pytest.fixture
def track(tmp_path, monkeypatch):
    """50 s of sound: quiet for 10 s, then a click twice a second (120 a minute) over a tone."""
    monkeypatch.setattr(music_library.paths, "WORK_DIR", str(tmp_path / "work"))
    path = tmp_path / "track.wav"
    beat = "0.6*sin(2*PI*880*t)*lt(mod(t,0.5),0.04)"
    sound = f"if(lt(t,10),0.004*sin(2*PI*220*t),0.25*sin(2*PI*220*t)+{beat})"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='{sound}':s=44100:d=50", str(path)], check=True)
    return str(path)


def test_a_track_is_measured_where_it_gets_going(track):
    measured = music_library.measure(track)
    assert measured["seconds"] == 50.0
    # In full swing from the tenth second, on a beat: a video starts it there, not in its quiet opening
    assert 9.0 <= measured["start"] <= 11.0
    # Its tempo, or twice or half of it: what a beat tracker hears of a click every half second
    assert measured["bpm"] in range(58, 63) or measured["bpm"] in range(117, 124) or measured["bpm"] in range(236, 246)
    assert -30.0 < measured["lufs"] < -5.0


def test_the_model_hears_two_parts_and_its_answer_is_made_safe(track):
    ears = Ears({"genre": " Drift  PHONK ", "kinds": ["skill", "epic", "hype", "skill"], "description": "Basses lourdes et rythme nerveux.  Pour les kills.", "about": "Aggressive, driving. Suits action; would ruin a calm talk."})
    measured = {"seconds": 50.0, "bpm": 120, "start": 10.0, "lufs": -9.0}
    heard = music_library.listen(track, measured, "fr", ears, hint="drift-phonk-550480.mp3")
    assert heard == {
        "genre": "drift phonk",
        "kinds": ["skill", "hype"],
        "description": "Basses lourdes et rythme nerveux. Pour les kills.",
        "about": "Aggressive, driving. Suits action; would ruin a calm talk.",
        "cost": 0.0012,
    }
    call = ears.seen[0]
    assert call["model"] == live_agent.EARS_MODEL
    text, *sounds = call["messages"][0]["content"]
    # Its main part (from where it is in full swing), then a later part: both real MP3s
    assert len(sounds) == 2 and all(s["type"] == "input_audio" and s["input_audio"]["format"] == "mp3" for s in sounds)
    assert all(len(base64.b64decode(s["input_audio"]["data"])) > 5000 for s in sounds)
    assert "2 part(s) of one music track (its main part, then a later part)" in text["text"]
    assert "« drift-phonk-550480.mp3 »" in text["text"] and "about 120 beats a minute" in text["text"] and "in French" in text["text"]
    for kind in music_library.KINDS:
        assert kind in text["text"]


def test_a_track_is_kept_with_its_measures_when_nothing_can_listen(track):
    described = music_library.describe(track, "fr", Ears(TimeoutError("slow")))
    assert described["heard"] is False and described["description"] == "" and described["kinds"] == []
    assert described["seconds"] == 50.0 and 9.0 <= described["start"] <= 11.0

    heard = music_library.describe(track, "en", Ears({"genre": "test tone", "kinds": ["chill"], "description": "A tone.", "about": "A tone."}))
    assert heard["heard"] is True and heard["kinds"] == ["chill"] and heard["seconds"] == 50.0 and heard["cost"] == 0.0012

    class Refused(Exception):
        status_code = 402

    # No credits is said as such, not hidden behind an empty description
    with pytest.raises(ProviderUnavailable):
        music_library.describe(track, "fr", Ears(Refused("no credits")))


def test_a_file_too_short_is_refused(tmp_path):
    path = tmp_path / "blip.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", str(path)], check=True)
    with pytest.raises(ValueError):
        music_library.measure(str(path))
