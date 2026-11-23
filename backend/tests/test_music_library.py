"""A background music measured and listened to: what is measured on a real sound, what the model is sent and what is made of its answer (the model is faked)."""

import base64
import json
import subprocess
from types import SimpleNamespace

import pytest

from app.services import live_agent, music_library


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


def sound(tmp_path, name: str, expression: str, seconds: int) -> str:
    path = tmp_path / f"{name}.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"aevalsrc='{expression}':s=44100:d={seconds}", str(path)], check=True)
    return str(path)


def test_a_track_is_measured_where_it_gets_going(track):
    measured = music_library.measure(track)
    assert measured["seconds"] == 50.0
    # In full swing from the tenth second: a video starts it there, a hair before the attack, not in its quiet opening
    assert 9.9 <= measured["start"] <= 10.02
    # Its tempo to the hundredth, or twice or half of it: what a beat tracker hears of a click every half second.
    # An intro played on the track lasts four of its beats: a beat a minute off is 15 ms by the fourth
    assert min(abs(measured["bpm"] - tempo) for tempo in (60, 120, 240)) < 0.3
    assert -30.0 < measured["lufs"] < -5.0


def test_a_track_never_starts_on_a_hit_followed_by_nothing_nor_before_a_break(tmp_path, monkeypatch):
    monkeypatch.setattr(music_library.paths, "WORK_DIR", str(tmp_path / "work"))
    # Quiet for 5 s, one loud second, 6 s of near silence, then a click 126 times a minute over a tone to the end:
    # the loud second is not where the music gets going (a video started there would go quiet after a second)
    click = "0.6*sin(2*PI*880*t)*lt(mod(t,60/126),0.04)"
    path = sound(tmp_path, "break", f"if(lt(t,5),0.004*sin(2*PI*220*t),if(lt(t,6),0.5*sin(2*PI*220*t),if(lt(t,12),0.004*sin(2*PI*220*t),0.25*sin(2*PI*220*t)+{click})))", 45)
    measured = music_library.measure(path)
    assert 11.9 <= measured["start"] <= 12.02
    assert min(abs(measured["bpm"] - tempo) for tempo in (63, 126, 252)) < 0.3
    # A hit, a second of nothing, a hit, a second of nothing... then the music: it does not start on a lone hit
    hits = "0.7*sin(2*PI*110*t)*lt(mod(t,2),0.25)"
    path = sound(tmp_path, "hits", f"if(lt(t,10),{hits},0.25*sin(2*PI*220*t)+{click})", 40)
    assert 9.9 <= music_library.measure(path)["start"] <= 10.02


def test_a_track_in_swing_from_its_first_note_starts_on_it(tmp_path, monkeypatch):
    monkeypatch.setattr(music_library.paths, "WORK_DIR", str(tmp_path / "work"))
    # Half a second of nothing (as a file often has), then the music at once, a little louder later on
    click = "0.6*sin(2*PI*880*t)*lt(mod(t,0.5),0.04)"
    path = sound(tmp_path, "swing", f"if(lt(t,0.5),0,if(lt(t,20),0.2*sin(2*PI*220*t)+{click},0.3*sin(2*PI*220*t)+{click}))", 40)
    measured = music_library.measure(path)
    # On its first note, with no silence left before it: how people know a track
    assert 0.44 <= measured["start"] <= 0.5


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

    # No credits: the track is still kept with what was measured, and why nobody heard it is said
    broke = music_library.describe(track, "fr", Ears(Refused("no credits")))
    assert (broke["heard"], broke["why"], broke["seconds"]) == (False, "credits", 50.0)


def test_a_file_too_short_is_refused(tmp_path):
    path = tmp_path / "blip.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", str(path)], check=True)
    with pytest.raises(ValueError):
        music_library.measure(str(path))
