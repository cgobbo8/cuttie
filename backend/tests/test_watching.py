"""Moments where the picture is the moment: where to look, what the model that sees says, which get a place."""

import json
from types import SimpleNamespace

import numpy as np
import pytest

from app.services import watching
from app.services.sound_index import GROUPS, SoundIndex
from app.services.vod_transcript import VodTranscript
from app.services.watching import Lead, Seen


def sounds(seconds: int, **at: dict[int, float]) -> SoundIndex:
    """A sound index of a quiet live with these sounds at these seconds: sounds(600, crash={120: 0.8})."""
    groups = list(GROUPS)
    scores = np.zeros((seconds, len(groups)), dtype=np.float32)
    for group, moments in at.items():
        for second, score in moments.items():
            scores[second, groups.index(group)] = score
    return SoundIndex(groups=groups, scores=scores, loud=np.full(seconds, -30.0, dtype=np.float32))


def said(*lines: tuple[float, str]) -> VodTranscript:
    return VodTranscript(segments=[(at, at + 1.5, f" {text}") for at, text in lines])


def test_a_short_stunned_line_after_the_streamer_said_little_is_a_lead():
    transcript = said(
        (100.0, "Allez on y va on prend la voiture et on file au port avant qu'ils arrivent"),
        (104.0, "C'est quoi ça ?"),  # right after a long sentence: he was talking, not watching
        (300.0, "Wow."),
        (500.0, "What the fuck."),  # nothing said for a long while before it
        (700.0, "Ok."),  # short, but nobody is taken aback
    )
    leads = watching.find_leads(transcript, None, [], 5.0, 1000.0)
    assert [(lead.at, lead.signs) for lead in leads] == [(300.0, ["stunned"]), (500.0, ["stunned"])]
    assert leads[1].said == "What the fuck."
    # (said in other languages too)
    assert [lead.at for lead in watching.find_leads(said((50.0, "No puede ser"), (200.0, "Oh my god")), None, [], 5.0, 400.0)] == [50.0, 200.0]


def test_words_nobody_says_calmly_and_reactions_said_again_are_leads_whatever_is_said_around():
    transcript = said(
        # A cutscene that never stops talking, then the streamer: a long line, after many words
        (100.0, "You think you can walk in here and take what is mine after everything we did for you and your family"),
        (104.0, "Oh what the fuck, y'a un tigre et un singe, à le very bad trip"),
        # The game talks again, and the streamer reacts three times in a row
        (500.0, "We had a deal and you broke it so now you are going to pay for every single thing you took"),
        (503.0, "Oh, what ?"),
        (506.0, "Oh, what ?"),
        (510.0, "Quoi ?"),
        # One short line in the middle of talk, said once: he was talking, not watching
        (900.0, "Donc là on va prendre la voiture et on file au port avant qu'ils arrivent tous"),
        (904.0, "Quoi ?"),
    )
    leads = watching.find_leads(transcript, None, [], 5.0, 1200.0)
    assert sorted((lead.at, lead.signs) for lead in leads) == [(104.0, ["stunned"]), (510.0, ["stunned"])]
    # (the reaction said again is one lead, at its strongest sign; the words of disbelief are the strongest sign there is)
    assert max(leads, key=lambda lead: lead.strength).at == 104.0


def test_a_loud_sound_of_the_game_is_a_lead_stronger_with_few_words_on_it():
    index = sounds(900, crash={120: 0.8}, gunfire={400: 0.8, 401: 0.7}, explosion={700: 0.2})
    transcript = said((398.0, "Vas-y tire tire tire il est derrière la caisse à gauche je le vois plus"))
    leads = watching.find_leads(transcript, index, [], 5.0, 900.0)
    # The crash nobody talks over comes first; the shots talked over after; a faint sound is nothing
    assert [(lead.at, lead.signs) for lead in leads] == [(120.0, ["sound"]), (400.0, ["sound"])]
    assert leads[0].strength > leads[1].strength


def test_laughter_with_nothing_said_is_a_lead_and_laughter_at_a_joke_is_not():
    index = sounds(900, laughter={200: 0.6, 600: 0.6})
    transcript = said((596.0, "et là le mec me dit qu'il a garé sa voiture dans la piscine du voisin"))
    assert [(lead.at, lead.signs) for lead in watching.find_leads(transcript, index, [], 5.0, 900.0)] == [(200.0, ["laughter"])]


def test_signs_that_fall_together_are_one_lead_at_the_strongest_one():
    index = sounds(900, crash={300: 0.9})
    transcript = said((304.0, "Oh putain"), (600.0, "Wow."), (625.0, "What the fuck."))
    leads = watching.find_leads(transcript, index, [], 5.0, 900.0)
    # The crash and the line 4 s after it: one lead, two kinds of signs, ahead of the others
    assert (leads[0].at, leads[0].signs) == (300.0, ["sound", "stunned"])
    assert leads[0].strength > max(lead.strength for lead in leads[1:])
    # Two stunned lines 25 s apart are two leads: each is looked at where it is said
    # (tried for real: merged, the pictures were taken 20 s before the "what the fuck")
    assert sorted(lead.at for lead in leads[1:]) == [600.0, 625.0]


def test_reactions_and_sounds_of_the_game_are_looked_at_in_turn_when_there_are_too_many():
    # A shooting game: shots every minute, each as strong as a sound gets, and two short lines said while watching
    index = sounds(3000, gunfire={60 * n: 0.9 for n in range(1, 40)}, crash={2800: 0.9})
    transcript = said((2500.0, "Oh putain !"), (2802.0, "Wow."), (2900.0, "C'est quoi ça ?"))
    leads = watching.find_leads(transcript, index, [], 5.0, 3000.0, limit=6)
    # What two kinds of signs agree on first, then two reactions for a sound: the shots don't take every place
    assert [lead.signs for lead in leads] == [["sound", "stunned"], ["stunned"], ["stunned"], ["sound"], ["sound"], ["sound"]]
    assert leads[0].at == 2800.0 and {leads[1].at, leads[2].at} == {2500.0, 2900.0}
    # The less was said before a short line, the more the streamer was watching
    quiet, less_quiet = watching.find_leads(said((100.0, "Wow."), (500.0, "je vais voir ce qu'il y a derrière la porte"), (504.0, "Oh non")), None, [], 5.0, 900.0)
    assert (quiet.at, less_quiet.at) == (100.0, 504.0) and quiet.strength > less_quiet.strength


def test_the_chat_writing_all_at_once_is_a_lead_and_the_leads_are_capped():
    quiet = [{"timestamp": 60.0 * m, "text": "salut", "author": f"q{m}"} for m in range(30)]
    burst = [{"timestamp": 905.0 + i * 0.5, "text": "???", "author": f"v{i}"} for i in range(10)]
    leads = watching.find_leads(None, None, quiet + burst, 5.0, 1800.0)
    assert len(leads) == 1 and leads[0].signs == ["chat"]
    assert leads[0].at == 900.0  # where the stream was when the chat started reacting (it writes 5 s late)
    many = said(*[(100.0 * i, "Oh non") for i in range(1, 130)])
    assert len(watching.find_leads(many, None, [], 5.0, 14000.0)) == watching.MAX_LEADS
    assert len(watching.find_leads(many, None, [], 5.0, 14000.0, limit=5)) == 5


class FakeEyes:
    """Stands for the model that sees: answers what it is given, counts what it is shown."""

    def __init__(self, answers: list[dict] | None = None, fail: Exception | None = None):
        self.answers, self.fail, self.calls = answers, fail, []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **request):
        self.calls.append(request)
        if self.fail:
            raise self.fail
        content = request["messages"][0]["content"]
        shown = [int(part["text"].split()[1]) for part in content if part["type"] == "text" and part["text"].startswith("Moment ")]
        answers = self.answers if self.answers is not None else [{"n": n, "seen": f"scene {n}", "face": "laughing", "text": "MORT", "watch": 40 + n} for n in shown]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"moments": answers})))], usage=SimpleNamespace(cost=0.002, model_extra=None))


def test_shows_three_pictures_of_each_lead_a_few_leads_per_call():
    leads = [Lead(at=100.0 * n, signs=["stunned"], said=f"ligne {n}") for n in range(1, 9)]
    asked: list[list[float]] = []

    def fetch(url, times):
        asked.append(times)
        return [f"data:image/jpeg;base64,{int(t)}" for t in times]

    eyes = FakeEyes()
    seen, cost = watching.look(leads, "https://live", "Grand Theft Auto VI", client=eyes, fetch=fetch)
    # 8 leads: two calls (6 then 2), three pictures each, taken before and after the reaction
    assert len(eyes.calls) == 2 and cost == pytest.approx(0.004)
    assert [95.0, 99.0, 103.0] in asked and len(asked) == 8
    first = eyes.calls[0]["messages"][0]["content"]
    assert sum(part["type"] == "image_url" for part in first) == 18
    assert "Grand Theft Auto VI" in first[0]["text"]
    assert "Moment 1 (at 0:01:40). Said around it: ligne 1" in [part.get("text") for part in first]
    # Each answer goes back to its lead; each call numbers its moments from 1 (numbered across the calls, the
    # model answered "1, 2..." again in the later ones and those leads were never looked at)
    assert [(s.at, s.seen, s.watch, s.text, s.face) for s in seen][:2] == [(100.0, "scene 1", 41, "MORT", "laughing"), (200.0, "scene 2", 42, "MORT", "laughing")]
    second = [part["text"] for part in eyes.calls[1]["messages"][0]["content"] if part["type"] == "text"][1:]
    assert [text.split(".")[0] for text in second] == ["Moment 1 (at 0:11:40)", "Moment 2 (at 0:13:20)"]
    assert [(s.at, s.seen) for s in seen[-2:]] == [(700.0, "scene 1"), (800.0, "scene 2")] and seen[-1].signs == ["stunned"]


def test_a_lead_whose_pictures_cannot_be_fetched_and_an_answer_that_makes_no_sense_are_left_out(caplog):
    leads = [Lead(at=100.0, said="a"), Lead(at=200.0, said="b"), Lead(at=300.0, said="c")]
    fetch = lambda url, times: [] if times[1] == 199.0 else ["data:1", "data:2", "data:3"]  # noqa: E731
    eyes = FakeEyes(answers=[
        {"n": 1, "seen": "x" * 900, "watch": 250, "text": None},  # clamped
        {"n": 2, "seen": "never shown", "watch": 90},  # its pictures were not fetched: not one of the leads shown
        {"n": "three", "seen": "?", "watch": 50},
        {"n": 3, "seen": "ok", "watch": "soixante"},
        "nonsense",
    ])
    seen, _cost = watching.look(leads, "https://live", client=eyes, fetch=fetch)
    assert [(s.at, len(s.seen), s.watch, s.text) for s in seen] == [(100.0, 400, 100, "")]
    # An answer that cannot be read at all (cut short, not JSON) is said in the journal: those leads were not looked at
    broken = FakeEyes()
    broken.create = lambda **request: SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"moments": [{"n": 1, "seen": "cut sh'), finish_reason="length")], usage=None)
    broken.chat = SimpleNamespace(completions=SimpleNamespace(create=broken.create))
    with caplog.at_level("WARNING"):
        assert watching.look(leads, "https://live", client=broken, fetch=lambda url, times: ["data:1", "data:2", "data:3"]) == ([], 0.0)
    assert "the answer about 3 leads could not be read (finish: length)" in caplog.text
    # Nothing could be fetched at all: no call is made
    eyes = FakeEyes()
    assert watching.look(leads, "https://live", client=eyes, fetch=lambda url, times: []) == ([], 0.0)
    assert eyes.calls == []


def test_a_call_that_fails_is_skipped_and_a_provider_refusing_for_good_stops_everything():
    from app.services.provider_errors import ProviderUnavailable

    leads = [Lead(at=100.0, said="a")]
    fetch = lambda url, times: ["data:1", "data:2", "data:3"]  # noqa: E731
    assert watching.look(leads, "https://live", client=FakeEyes(fail=TimeoutError("slow")), fetch=fetch) == ([], 0.0)

    class NoCredits(Exception):
        status_code = 402

    with pytest.raises(ProviderUnavailable):
        watching.look(leads, "https://live", client=FakeEyes(fail=NoCredits("Insufficient credits")), fetch=fetch)


def test_keeps_the_scenes_worth_watching_one_place_per_scene():
    seen = [
        Seen(at=100.0, seen="walks into a propeller", watch=65),
        Seen(at=110.0, seen="the same scene, a second lead", watch=60),
        Seen(at=500.0, seen="a bar", watch=20),
        Seen(at=900.0, seen="", watch=90),  # nothing described: not kept
        Seen(at=1500.0, seen="a couple in a bedroom", watch=55),
    ]
    assert [s.at for s in watching.picks(seen)] == [100.0, 1500.0]
    assert [s.at for s in watching.picks(seen, most=1)] == [100.0]
    many = [Seen(at=100.0 * n, seen="x", watch=60 + n) for n in range(1, 20)]
    assert len(watching.picks(many)) == watching.MAX_PICKS
    assert watching.picks(many)[0].watch == 79


def test_a_moment_found_by_looking_is_rated_on_the_scene_and_what_leads_to_it():
    assert watching.window(Seen(at=1000.0), 5000.0) == (975.0, 1020.0)
    assert watching.window(Seen(at=10.0), 5000.0) == (0.0, 30.0)
    assert watching.window(Seen(at=4990.0), 5000.0) == (4965.0, 5000.0)
    told = watching.told(Seen(at=1000.0, seen="The character walks out of a seaplane and dies.", face="not visible", text="MORT"), 25.0)
    assert told == 'A first look at three pictures of this moment at about 25s saw: The character walks out of a seaplane and dies.\nWritten on screen: "MORT"'
    assert "face then: laughing" in watching.told(Seen(at=1.0, seen="x", face="laughing"))


def test_watch_looks_at_the_leads_and_returns_the_scenes(caplog):
    transcript = said((300.0, "Wow."), (900.0, "Oh non !"))
    eyes = FakeEyes(answers=[{"n": 1, "seen": "a cutscene", "watch": 20}, {"n": 2, "seen": "dies in a propeller", "watch": 65, "text": "MORT"}])
    fetch = lambda url, times: ["data:1", "data:2", "data:3"]  # noqa: E731
    with caplog.at_level("INFO"):
        kept = watching.watch(transcript, None, [], 5.0, 2000.0, "https://live", "GTA", client=eyes, fetch=fetch)
    assert [(s.at, s.watch, s.text) for s in kept] == [(900.0, 65, "MORT")]
    assert "2 leads, 2 looked at" in caplog.text and "1 worth watching" in caplog.text
    # No lead, or no picture to fetch from: nothing is asked
    eyes = FakeEyes()
    assert watching.watch(said((10.0, "Bonjour à tous")), None, [], 5.0, 100.0, "https://live", client=eyes, fetch=fetch) == []
    assert watching.watch(transcript, None, [], 5.0, 2000.0, "", client=eyes, fetch=fetch) == []
    assert eyes.calls == []


class FakeSearcher:
    """Stands for the AI that searches a live with tools."""

    made: list["FakeSearcher"] = []
    moments: list[dict] = []
    fail: Exception | None = None

    def __init__(self, tools, client, model, **options):
        self.tools, self.options, self.asked = tools, options, None
        FakeSearcher.made.append(self)

    def search(self, request):
        self.asked = request
        if FakeSearcher.fail:
            raise FakeSearcher.fail
        return SimpleNamespace(moments=FakeSearcher.moments, looks=12, cost=0.007, steps=4)


@pytest.fixture
def searcher(monkeypatch):
    from app.services import live_agent, live_tools

    FakeSearcher.made, FakeSearcher.moments, FakeSearcher.fail = [], [], None
    monkeypatch.setattr(live_agent, "Searcher", FakeSearcher)
    transcript = said((13407.0, "Oh what the fuck, y'a un tigre et un singe"))
    monkeypatch.setattr(live_tools, "load_cached", lambda job_id: transcript if job_id == "job-x" else None)
    monkeypatch.setattr(live_tools.live_search, "read_chat", lambda job_id: [])
    monkeypatch.setattr(live_tools.sound_index, "load", lambda job_id: None)
    return FakeSearcher


def test_the_searching_ai_is_asked_for_the_scenes_and_its_answer_read(searcher, caplog):
    searcher.moments = [
        {"start": "3:43:27.0", "end": "3:43:34.5", "quote": "« Oh what the fuck, y'a un tigre et un singe »", "why": "Un tigre blanc  et un singe\nau milieu d'une fête.", "score": 78},
        {"start": "1:18:50.3", "end": "1:18:58.1", "quote": "Oh, what ?", "why": "Une cinématique de garage, rien d'absurde.", "score": 48},  # only close: left out
        {"start": "nope", "why": "x", "score": 90},
        {"start": "0:10:00", "why": "", "score": 90},
        {"start": "4:59:59", "why": "à la toute fin", "score": "95"},
    ]
    chat = [{"timestamp": 10.0, "text": "???", "author": "a"}]
    with caplog.at_level("INFO"):
        found = watching.scout("job-x", chat, 5.0, 15000.0, "https://www.twitch.tv/videos/1", client=object())
    assert [(s.at, s.watch, s.signs) for s in found] == [(13407.0, 78, ["agent"]), (14999.0, 95, ["agent"])]
    assert found[0].seen == "Un tigre blanc et un singe au milieu d'une fête. (said then: « Oh what the fuck, y'a un tigre et un singe »)"
    assert "the searching AI looked at 12 places" in caplog.text and "2 scenes" in caplog.text
    # It is asked for what is seen, over the whole live, with more looks than a search has and its own ceiling
    asked = searcher.made[0]
    assert "ON SCREEN" in asked.asked and "at least twelve different places" in asked.asked
    assert (asked.options["max_looks"], asked.options["max_cost"], asked.options["vod_url"]) == (16, 0.03, "https://www.twitch.tv/videos/1")
    # (the chat the analysis holds, before it is written next to the clips)
    assert asked.tools.chat == chat
    # No transcript of this live in the worker: nothing is asked
    assert watching.scout("another", [], 5.0, 100.0, "https://www.twitch.tv/videos/1", client=object()) == []
    assert len(searcher.made) == 1


def test_a_search_that_may_look_more_says_so_to_the_model(searcher, monkeypatch):
    from app.services import live_agent

    monkeypatch.undo()  # the real Searcher
    tools = SimpleNamespace(specs=lambda: [], lives=[])
    usual = live_agent.Searcher(tools, None, "m", vod_url="https://www.twitch.tv/videos/1")
    more = live_agent.Searcher(tools, None, "m", vod_url="https://www.twitch.tv/videos/1", max_looks=16)
    said_of = lambda s: next(spec["description"] for spec in s.specs() if spec["name"] == "look")  # noqa: E731
    assert "8 looks at most" in said_of(usual) and "16 looks at most" in said_of(more)
    assert "8 looks at most" in live_agent.LOOK_SPEC["description"]  # (the shared one is left as it is)
    more.run.looks = 15
    assert more.max_looks == 16 and usual.max_looks == live_agent.MAX_LOOKS


def test_watch_puts_together_what_the_leads_and_the_searching_ai_found(searcher, caplog):
    transcript = said((900.0, "Oh non !"), (2000.0, "Wow."))
    eyes = FakeEyes(answers=[{"n": 1, "seen": "dies in a propeller", "watch": 85, "text": "MORT"}, {"n": 2, "seen": "a truck in a shop window", "watch": 60}])
    fetch = lambda url, times: ["data:1", "data:2", "data:3"]  # noqa: E731
    searcher.moments = [
        {"start": "3:43:27", "why": "Un tigre blanc au milieu d'une fête.", "score": 78},
        {"start": "0:33:10", "why": "Un camion traverse la vitrine.", "score": 90},  # the scene a lead found too, 10 s away
    ]
    kept = watching.watch(transcript, None, [], 5.0, 15000.0, "https://live.m3u8", "GTA", client=eyes, fetch=fetch, job_id="job-x", vod_url="https://www.twitch.tv/videos/1")
    # One place per scene, the higher of its two ratings, the most worth watching first
    assert [(s.at, s.watch, s.signs) for s in kept] == [(1990.0, 90, ["agent"]), (900.0, 85, ["stunned"]), (13407.0, 78, ["agent"])]
    # The searching AI failing leaves what the leads found; a provider refusing for good stops everything
    searcher.fail = TimeoutError("slow")
    with caplog.at_level("WARNING"):
        alone = watching.watch(transcript, None, [], 5.0, 15000.0, "https://live.m3u8", client=eyes, fetch=fetch, job_id="job-x", vod_url="https://www.twitch.tv/videos/1")
    assert [s.at for s in alone] == [900.0, 2000.0] and "the searching AI could not look for scenes" in caplog.text
    from app.services.provider_errors import ProviderUnavailable

    class NoCredits(Exception):
        status_code = 402

    searcher.fail = NoCredits("Insufficient credits")
    with pytest.raises(ProviderUnavailable):
        watching.watch(transcript, None, [], 5.0, 15000.0, "https://live.m3u8", client=eyes, fetch=fetch, job_id="job-x", vod_url="https://www.twitch.tv/videos/1")


def test_keeps_places_for_the_moments_found_by_looking():
    from app.services.llm_analyzer import _pick_for_llm

    ranked = list(range(100))
    # 10 places: 2 for the scenes found by looking that the blended score left out, 3 for the AI's reading
    chosen = _pick_for_llm(ranked, presort_picks=[90, 91], watch_picks=[2, 80, 81, 82], keep=10, slots=3, watch_slots=2)
    assert chosen == [0, 1, 2, 3, 4, 90, 91, 80, 81, 5]
    # No reading picks: the scenes still get their places; none found: the blended order alone
    assert _pick_for_llm(ranked, [], [80], keep=10, slots=3, watch_slots=2) == [0, 1, 2, 3, 4, 5, 6, 7, 8, 80]
    assert _pick_for_llm(ranked, [], [], keep=10) == list(range(10))
    assert _pick_for_llm(ranked, [], None, keep=10) == list(range(10))


def test_a_scene_found_by_looking_reaches_the_model_that_rates_with_what_was_seen(monkeypatch, tmp_path):
    """analyze_candidates with every paid call stubbed: a scene nobody talks over joins the candidates."""
    from app.models.schemas import HotPoint, LlmAnalysis, SignalBreakdown, VodContext
    from app.services import llm_analyzer, presort as presort_module, sound_index, timeline

    monkeypatch.setattr(llm_analyzer, "work_dir", lambda *parts: str(tmp_path.joinpath(*parts)))
    for name in ("update_job", "add_notice", "save_hot_points"):
        monkeypatch.setattr(llm_analyzer, name, lambda *a, **k: None)
    monkeypatch.setattr(timeline, "publish", lambda *a, **k: None)
    monkeypatch.setattr(timeline, "publish_candidate", lambda *a, **k: None)
    monkeypatch.setattr(llm_analyzer, "get_vod_direct_url", lambda *a, **k: "https://live.m3u8")
    monkeypatch.setattr(llm_analyzer, "extract_frames_from_url", lambda *a, **k: [])
    monkeypatch.setattr(llm_analyzer, "gather_vod_context", lambda *a, **k: (VodContext(), {}))
    monkeypatch.setattr(presort_module, "presort", lambda *a, **k: [])
    monkeypatch.setattr(sound_index, "load", lambda job_id: None)
    # (3 places in all, as if the live had many more candidates than places)
    pick = llm_analyzer._pick_for_llm
    monkeypatch.setattr(llm_analyzer, "_pick_for_llm", lambda ranked, picks, watched=None, **k: pick(ranked, picks, watched, keep=3))
    prompts: dict[str, str] = {}
    original = llm_analyzer._build_unified_prompt

    def build(**kwargs):
        prompt = original(**kwargs)
        prompts[kwargs["timestamp_display"]] = prompt
        return prompt

    monkeypatch.setattr(llm_analyzer, "_build_unified_prompt", build)
    monkeypatch.setattr(llm_analyzer, "_call_unified_llm", lambda *a, **k: (LlmAnalysis(virality_score=0.5), "Test"))
    asked: list[tuple] = []

    def watch(transcript, sounds, chat, lag, duration, url, game, **k):
        asked.append((lag, duration, url, game))
        return [
            Seen(at=5000.0, seen="The character walks out of a seaplane into its propeller.", text="MORT", watch=65),  # nowhere in the heuristics
            Seen(at=2030.0, seen="A truck drives through a shop window.", face="laughing", watch=60),  # inside a loud candidate
        ]

    monkeypatch.setattr(llm_analyzer.watching, "watch", watch)
    windows = [(100, 160, 0.9), (2000, 2060, 0.8), (3000, 3060, 0.7), (4000, 4060, 0.6), (4500, 4560, 0.5)]
    hot_points = [
        HotPoint(timestamp_seconds=s + 30, timestamp_display=f"t{s}", score=h, signals=SignalBreakdown(rms=h), clip_start=s, clip_end=e)
        for s, e, h in windows
    ]
    transcript = VodTranscript(segments=[(5001.0, 5002.0, " Oh non !")])
    llm_analyzer.analyze_candidates(
        "job-x", hot_points, "/nonexistent.wav", "", 6000.0, {"game": "Grand Theft Auto VI"}, chat_messages=[], vod_transcript=transcript,
        signals_of=lambda start, end: (SignalBreakdown(rms=0.1), ""),
    )

    assert asked == [(5.0, 6000.0, "https://live.m3u8", "Grand Theft Auto VI")]
    # The scene nobody talks over is a new candidate, rated on the scene and what leads to it
    found = next(hp for hp in hot_points if hp.found_by == "watching")
    assert (found.timestamp_seconds, found.clip_start, found.clip_end, found.score) == (5000.0, 4975.0, 5020.0, 0.65)
    # It takes a place among the 3 the model rates, and that model is told what was seen and where
    told = prompts[found.timestamp_display]
    assert "## Something to see" in told
    assert "at about 25s saw: The character walks out of a seaplane into its propeller." in told
    assert 'Written on screen: "MORT"' in told
    # The scene inside a candidate the sound found: no new candidate, the candidate is told what was seen
    assert sum(hp.found_by == "watching" for hp in hot_points) == 1
    assert "A truck drives through a shop window." in prompts["t2000"] and "face then: laughing" in prompts["t2000"]
    # The others are rated as before
    assert "## Something to see" not in prompts["t100"]
    assert set(prompts) == {"t100", "t2000", found.timestamp_display}
