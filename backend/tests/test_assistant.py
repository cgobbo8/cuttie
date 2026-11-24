"""The assistant: one conversation that follows the streamer, acts in the app and asks before spending.

No model is called: a scripted one stands for it and says which tools to call, and the app's
answers (`api_tool`) are the test's own.
"""

import json

import pytest
from httpx import ASGITransport, AsyncClient
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from app.services import assistant, assistant_tools, live_search
from app.services.provider_errors import ProviderUnavailable

LIVES = [
    {"job": "job-miami", "title": "Maurice de retour à Miami", "date": "2026-11-23", "game": "Grand Theft Auto VI", "seconds": 15020, "analysed": True, "status": "DONE"},
    {"vod": "2611", "url": "https://www.twitch.tv/videos/2611", "title": "On reprend le service", "date": "2026-11-09", "game": "Grand Theft Auto V", "seconds": 24540, "analysed": False},
]
META = {"duration": 15020.0, "lag": 6.0, "url": "https://www.twitch.tv/videos/2700", "game": "Grand Theft Auto VI", "title": "Maurice de retour à Miami", "moments": [{"t": 1678, "state": "kept", "score": 0.83}]}
CLIPS = [
    {"filename": "lucia_et_jason_28251.mp4", "name": "Lucia et Jason", "score": 83, "at": 1678, "length": 37.5, "seen": "Un klaxon coupe leur baiser.", "tags": ["romance"], "state": "kept"},
    {"filename": "pere_indigne_8954b.mp4", "name": "Père indigne", "score": 79, "at": 3888, "length": 59.5, "state": None},
]


class Scripted(BaseChatModel):
    """A model that says what it was told to, in order, and remembers what it was shown."""

    script: list = []
    seen: list = []
    offered: list = []
    model_name: str = "scripted-1"
    # What each answer is said to have cost (None: only its tokens are known)
    billed: float | None = None
    # The model that takes over when this one fails (for the test to script it)
    fallback: object = None

    @property
    def _llm_type(self) -> str:
        return "scripted"

    def bind_tools(self, tools, *, tool_choice=None, **kwargs):
        self.offered.append({"tools": [tool.name if hasattr(tool, "name") else tool.get("function", {}).get("name") for tool in tools], "tool_choice": tool_choice})
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.seen.append([(type(m).__name__, m.content if isinstance(m.content, str) else json.dumps(m.content, ensure_ascii=False)) for m in messages])
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        message = step if isinstance(step, AIMessage) else AIMessage(content=step)
        message.usage_metadata = {"input_tokens": 2000, "output_tokens": 100, "total_tokens": 2100}
        if self.billed is not None:
            message.response_metadata = {"token_usage": {"cost": self.billed}}
        return ChatResult(generations=[ChatGeneration(message=message)])


def call(name: str, args: dict, call_id: str = "c1", said: str = "") -> AIMessage:
    return AIMessage(content=said, tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}])


class Refusal(Exception):
    def __init__(self, status: int) -> None:
        super().__init__(f"HTTP {status}")
        self.status_code = status


class Asked(list):
    """What the app was asked ((tool, args), in order), with what it answers to each tool."""

    answers: dict


@pytest.fixture
def app_calls(monkeypatch):
    """What the app is asked, and what it answers (a test changes `answers` to say otherwise)."""
    calls = Asked()
    answers = calls.answers = {"lives": {"lives": LIVES}, "live_meta": META, "clips": {"clips": CLIPS}, "start_analysis": {"job": "job-new"}, "keep_clip": {"state": "kept"}}

    def api(name, args=None):
        calls.append((name, args or {}))
        return answers.get(name, {"error": f"unknown tool {name}"})

    monkeypatch.setattr(assistant_tools, "api_tool", api)
    return calls


@pytest.fixture
def home(monkeypatch, tmp_path, app_calls):
    """The assistant's conversations kept in a folder of the test's, none of them begun."""
    monkeypatch.setattr(assistant, "directory", lambda: str(tmp_path / "assistant"))
    monkeypatch.setattr(assistant, "_saver", None)
    monkeypatch.setattr(assistant_tools, "_threads", {})


@pytest.fixture
def model(monkeypatch, home):
    """The assistant with a scripted model (and a second one that takes over when the first fails)."""
    first, second = Scripted(script=[], seen=[], offered=[]), Scripted(script=[], seen=[], offered=[], model_name="scripted-2")
    monkeypatch.setattr(assistant, "build_model", lambda name: second if name == assistant.AGENT_FALLBACK else first)
    monkeypatch.setattr(assistant, "AGENT_MODEL", "scripted-1")
    monkeypatch.setattr(assistant, "AGENT_FALLBACK", "scripted-2")
    first.fallback = second
    return first


HERE = {"page": "edit", "job": "job-miami", "video": {"id": "v-yacht", "name": "Une soirée sur un yacht", "source": "sequence"}}


def tool_messages(model: Scripted) -> list[str]:
    return [content for kind, content in model.seen[-1] if kind == "ToolMessage"]


def test_answers_plainly_with_what_it_is_told(model, app_calls):
    model.script = ["Bonjour."]
    answer = assistant.turn("t1", text="salut", context=HERE, language="fr")
    assert answer["status"] == "done"
    assert answer["reply"] == [{"type": "text", "text": "Bonjour."}]
    assert answer["steps"] == [] and "action" not in answer
    # Its tokens are known, not what was billed: the cost is estimated from them
    assert 0 < answer["cost"] < 0.01
    system = model.seen[0][0][1]
    assert "Answer in French" in system
    # The streamer's lives, numbered, and where they are now
    assert "1. « Maurice de retour à Miami » · 2026-11-23 · Grand Theft Auto VI · 4:10:20 · analysed" in system
    assert "2. « On reprend le service »" in system and "not analysed" in system
    assert "Page: edit" in system and "Live: number 1 « Maurice de retour à Miami »" in system
    assert "Video: v-yacht (name: Une soirée sur un yacht, source: sequence)" in system
    # (deepagents adds no instructions of its own: every step would pay for them)
    assert system == assistant.system(assistant_tools.Turn("t1", HERE, "fr"))
    # Its own tools and none of deepagents' files, shell or sub-agents
    offered = set(model.offered[0]["tools"])
    assert {"search_speech", "read", "listen", "find_moments", "list_clips", "add_passages", "analyse_live", "ask_approval", "show"} <= offered
    assert not offered & set(assistant.UNUSED_TOOLS)


def test_the_notes_and_the_memory_are_told(model, no_real_notes, no_real_memory):
    no_real_notes.mkdir()
    (no_real_notes / "maurice.md").write_text("---\ntitle: Maurice\n---\nMaurice est ambulancier.", encoding="utf-8")
    model.script = ["Oui."]
    assistant.turn("t1", text="tu me connais ?", context={}, language="fr")
    assert "Maurice est ambulancier." in model.seen[0][0][1]
    assert "Nothing in particular" in model.seen[0][0][1]


def test_asks_the_app_what_it_keeps(model, app_calls):
    model.script = [call("list_clips", {"live": "1"}), "Deux clips, dont un gardé."]
    answer = assistant.turn("t1", text="j'ai quoi comme clips ?", context={"page": "lives"}, language="fr")
    assert answer["status"] == "done" and answer["reply"][0]["text"] == "Deux clips, dont un gardé."
    assert ("clips", {"job": "job-miami"}) in app_calls
    assert answer["steps"] == ["Regarde les clips du live"]
    told = json.loads(tool_messages(model)[0])
    assert told["live"] == 1
    # Times as a model reads them, lengths in seconds
    assert told["clips"][0] == {"clip": "lucia_et_jason_28251.mp4", "name": "Lucia et Jason", "score": 83, "at": "0:27:58", "seconds": 38, "seen": "Un klaxon coupe leur baiser.", "tags": ["romance"], "state": "kept"}
    assert told["clips"][1]["state"] == "none"


def test_a_live_is_named_by_its_number_or_is_the_one_on_screen(model, app_calls):
    model.script = [call("list_clips", {}), call("list_clips", {"live": "2"}, "c2"), call("list_clips", {"live": "9"}, "c3"), "Vu."]
    assistant.turn("t1", text="les clips", context=HERE, language="en")
    first, second, third = (json.loads(content) for content in tool_messages(model))
    assert first["live"] == 1
    assert "not analysed yet" in second["error"] and "no such live" in third["error"]
    # No live on screen and none named: it has to say which
    model.script = [call("list_clips", {}, "c4"), "Lequel ?"]
    assistant.turn("t2", text="les clips", context={"page": "lives"}, language="fr")
    assert "say which live" in json.loads(tool_messages(model)[0])["error"]


def test_reads_a_live_with_the_tools_of_the_search(model, app_calls, monkeypatch):
    built = []

    class Tools:
        sounds = True
        transcript = True

        def __init__(self, job_id, duration=0.0, chat_lag=5.0, moments=None, date=None):
            built.append((job_id, duration, chat_lag, moments))
            self.asked = []

        def call(self, name, args):
            built.append((name, args))
            return {"found": 2, "moments": [{"at": "0:10:00.0", "said": "c'est calme"}]}

    monkeypatch.setattr(assistant_tools.live_tools, "LiveTools", Tools)
    monkeypatch.setattr(live_search, "relisten", lambda job, url, others=None: built.append(("relisten", job, url)))
    model.script = [call("search_speech", {"words": "calme"}), call("read", {"start": "0:09:50", "end": "0:10:20", "live": "1"}, "c2"), "Deux fois."]
    answer = assistant.turn("t1", text="je dis calme ?", context=HERE, language="fr")
    assert built == [
        ("relisten", "job-miami", META["url"]),
        ("job-miami", 15020.0, 6.0, META["moments"]),
        ("search_speech", {"words": "calme"}),
        ("read", {"start": "0:09:50", "end": "0:10:20"}),
    ]
    assert json.loads(tool_messages(model)[0]) == {"live": 1, "found": 2, "moments": [{"at": "0:10:00.0", "said": "c'est calme"}]}
    assert answer["steps"] == ["Cherche « calme » dans ce qui se dit", "Lit ce qui se dit à 0:09:50"]
    # The live's meta is asked once per request, whatever the number of tools
    assert [name for name, _ in app_calls].count("live_meta") == 1


def test_an_action_is_handed_to_the_app_and_its_answer_resumes(model, app_calls):
    model.billed = 0.002
    model.script = [call("add_passages", {"passages": [{"start": "0:10:00", "end": "0:10:05.5", "text": "À l'aide !"}], "part": "La soirée dérape"}), "Ajouté à la fin de « La soirée dérape »."]
    answer = assistant.turn("t1", text="ajoute le passage de 10 min où je crie à l'aide", context=HERE, language="fr")
    assert answer["status"] == "action" and answer["reply"] == []
    action = answer["action"]
    assert action["name"] == "add_passages" and action["needs"] == "app" and action["call"]
    # The app gets job ids and seconds; the video is the one open
    assert action["args"] == {"job": "job-miami", "video": "v-yacht", "passages": [{"job": "job-miami", "start": 600.0, "end": 605.5, "text": "À l'aide !"}], "part": "La soirée dérape"}
    assert answer["steps"] == ["Ajoute les passages à la vidéo"] and answer["cost"] == 0.002
    assert assistant.progress("t1") == {"steps": ["Ajoute les passages à la vidéo"], "running": False}

    done = assistant.turn("t1", resume={"call": action["call"], "result": {"added": 1, "seconds": 5.5}}, context=HERE, language="fr")
    assert done["status"] == "done" and done["reply"] == [{"type": "text", "text": "Ajouté à la fin de « La soirée dérape »."}]
    # The model was given what the app answered; the request's steps and cost are the whole request's
    assert json.loads(tool_messages(model)[0]) == {"added": 1, "seconds": 5.5}
    assert done["steps"] == ["Ajoute les passages à la vidéo"] and done["cost"] == 0.004

    with pytest.raises(assistant.NothingWaiting):
        assistant.turn("t1", resume={"call": action["call"], "result": {}}, context=HERE, language="fr")


def test_a_video_of_the_media_library_is_looked_up_then_added_by_the_app(model, app_calls):
    app_calls.answers["media"] = {"videos": [{"id": "m0000000a", "name": "Outro de fin", "seconds": 12.3, "upright": True, "spoken": True}]}
    # An imported passage of a video has no hour of a live: its name and how long it plays, as the app gives them
    app_calls.answers["video"] = {"id": "v-yacht", "name": "Le yacht", "parts": [{"title": "", "passages": [
        {"id": "aaaaaaaaaa", "start": 600.0, "end": 605.5, "text": "À l'aide !"},
        {"id": "mmmmmmmmm1", "imported": "Outro de fin", "seconds": 12.3, "text": ""},
    ]}]}
    model.script = [
        call("get_video", {}, "c1"),
        call("list_imported_videos", {}, "c2"),
        call("add_imported_videos", {"videos": ["Outro de fin"], "part": "Fin"}, "c3"),
        "Ton outro est à la fin.",
    ]
    answer = assistant.turn("t1", text="mets mon outro à la fin", context=HERE, language="fr")
    told = [json.loads(message) for message in tool_messages(model)]
    assert told[0]["parts"][0]["passages"] == [
        {"id": "aaaaaaaaaa", "start": "0:10:00.0", "end": "0:10:05.5", "text": "À l'aide !"},
        {"id": "mmmmmmmmm1", "imported": "Outro de fin", "seconds": 12.3, "text": ""},
    ]
    assert told[1] == app_calls.answers["media"]
    # Adding it is the app's to do, on the video open, named as the streamer names it
    action = answer["action"]
    assert answer["status"] == "action" and action["name"] == "add_media" and action["needs"] == "app"
    assert action["args"] == {"job": "job-miami", "video": "v-yacht", "media": ["Outro de fin"], "part": "Fin"}
    assert answer["steps"] == ["Regarde la vidéo", "Regarde ta médiathèque", "Ajoute ta vidéo au montage"]
    done = assistant.turn("t1", resume={"call": action["call"], "result": {"added": 1, "videos": ["Outro de fin"], "part": "Fin"}}, context=HERE, language="fr")
    assert done["status"] == "done" and done["reply"] == [{"type": "text", "text": "Ton outro est à la fin."}]


def test_an_imported_video_must_be_named_to_be_added(model, app_calls):
    model.script = [call("add_imported_videos", {"videos": []}), "Dis-moi laquelle."]
    answer = assistant.turn("t1", text="ajoute ma vidéo", context=HERE, language="fr")
    assert answer["status"] == "done"
    assert "list of imported videos" in tool_messages(model)[0]


def test_what_the_app_spent_on_an_action_is_part_of_the_request(model, app_calls):
    model.billed = 0.002
    model.script = [call("build_video", {"source": "compilation", "brief": "Les morts de Jason", "target": 60}), "C'est construit."]
    asked = assistant.turn("t1", text="fais une compilation de ses morts", context=HERE, language="fr")
    assert asked["action"]["name"] == "build_video" and asked["cost"] == 0.002
    # The app had the video planned by another model: what that cost is told, and counted
    done = assistant.turn("t1", resume={"call": asked["action"]["call"], "result": {"built": True, "video": "v-new", "passages": 7, "cost": 0.0315}}, context=HERE, language="fr")
    assert done["status"] == "done" and done["cost"] == 0.0355


def test_what_an_action_is_given(model, app_calls):
    model.script = [
        call("build_video", {"source": "clip", "brief": "Vers 3 h, je meurs dans l'hélice", "target": 45, "leads": ["3:12:44"]}),
        call("set_look", {"look": {"music": "Drift Phonk", "effects": "strong", "colour": "red"}}, "c2"),
        call("set_look", {"look": {"effects": "wild"}}, "c3"),
        call("export_videos", {}, "c4"),
        call("cut_clip", {"clip": "pere_indigne_8954b.mp4", "target": 40}, "c5"),
        call("open", {"page": "videos"}, "c6"),
        "Fait.",
    ]
    answer = assistant.turn("t1", text="fais tout", context=HERE, language="fr")
    given = []
    while answer["status"] == "action":
        given.append((answer["action"]["name"], answer["action"]["args"]))
        answer = assistant.turn("t1", resume={"call": answer["action"]["call"], "result": {"ok": True}}, context=HERE, language="fr")
    assert given == [
        ("build_video", {"job": "job-miami", "source": "clip", "brief": "Vers 3 h, je meurs dans l'hélice", "target": 45.0, "leads": [11564.0]}),
        # (what the look has no such thing for is left out; a level that does not exist is refused to the model, not handed to the app)
        ("set_look", {"job": "job-miami", "video": "v-yacht", "look": {"music": "Drift Phonk", "effects": "strong"}}),
        ("export_videos", {"videos": [{"job": "job-miami", "id": "v-yacht"}]}),
        ("cut_clip", {"job": "job-miami", "clip": "pere_indigne_8954b.mp4", "target": 40.0}),
        ("open", {"page": "videos"}),
    ]
    assert answer["status"] == "done" and answer["reply"][0]["text"] == "Fait."


def test_an_analysis_asks_first_and_a_no_launches_nothing(model, app_calls):
    model.script = [call("analyse_live", {"live": "2"}), "D'accord, je ne lance rien."]
    answer = assistant.turn("t1", text="analyse mon dernier live pas encore fait", context={"page": "lives"}, language="fr")
    assert answer["status"] == "action"
    action = answer["action"]
    assert action["name"] == "ask_approval" and action["needs"] == "approval"
    assert action["args"]["what"] == "analyse_live" and action["args"]["cost"] == 0.30
    assert action["args"]["detail"] == "On reprend le service" and action["args"]["live"]["vod"] == "2611"
    done = assistant.turn("t1", resume={"call": action["call"], "result": {"approved": False}}, context={"page": "lives"}, language="fr")
    assert done["status"] == "done"
    assert "start_analysis" not in [name for name, _ in app_calls]
    assert json.loads(tool_messages(model)[0])["started"] is False


def test_an_analysis_agreed_to_is_launched_once(model, app_calls):
    model.script = [call("analyse_live", {"live": "2"}), "C'est lancé."]
    answer = assistant.turn("t1", text="analyse le live du 9", context={"page": "lives"}, language="fr")
    done = assistant.turn("t1", resume={"call": answer["action"]["call"], "result": {"approved": True}}, context={"page": "lives"}, language="fr")
    assert done["status"] == "done"
    assert [args for name, args in app_calls if name == "start_analysis"] == [{"url": "https://www.twitch.tv/videos/2611", "vod": "2611"}]
    assert json.loads(tool_messages(model)[0]) == {"started": True, "job": "job-new"}
    # A live already analysed is not analysed again
    model.script = [call("analyse_live", {"live": "1"}, "c2"), "Il l'est déjà."]
    again = assistant.turn("t1", text="et le premier ?", context={"page": "lives"}, language="fr")
    assert again["status"] == "done" and "already analysed" in json.loads(tool_messages(model)[-1])["error"]


def test_what_it_shows_is_in_the_reply(model, app_calls, monkeypatch):
    hit = {"start": 12667.2, "end": 12670.4, "sources": ["ai"], "text": "À l'aide ! À l'aide !", "before": "", "after": "", "chat": [], "why": "Il crie à l'aide", "score": 0.9, "spoken": True}
    asked = []

    def search(job, query, meta, duration, energy=None, lag=5.0, url=None, moments=None, fresh=False):
        asked.append((job, query, duration, lag, url))
        return {"hits": [hit], "total": 1, "transcript": True, "note": "Une fois.", "cached": False, "cost": 0.0031}

    monkeypatch.setattr(live_search, "search_ai", search)
    model.script = [call("find_moments", {"question": "les fois où je crie à l'aide"}), call("show", {"kind": "passages", "items": ["p1"]}, "c2"), call("show", {"kind": "lives", "items": ["2"]}, "c3"), "Une seule fois, la voilà."]
    answer = assistant.turn("t1", text="trouve les fois où je crie à l'aide", context=HERE, language="fr")
    assert asked == [("job-miami", "les fois où je crie à l'aide", 15020.0, 6.0, META["url"])]
    found = json.loads(tool_messages(model)[0])
    assert found == {"found": 1, "note": "Une fois.", "passages": [{"id": "p1", "live": 1, "at": "3:31:07.2", "seconds": 3.2, "said": "À l'aide ! À l'aide !", "why": "Il crie à l'aide", "score": 90}]}
    # Its words, then what it showed: the passage whole, as the search gave it, with its live
    assert answer["reply"] == [
        {"type": "text", "text": "Une seule fois, la voilà."},
        {"type": "widget", "kind": "passages", "items": [{**hit, "job": "job-miami"}]},
        {"type": "widget", "kind": "lives", "items": [{"vod": "2611", "url": "https://www.twitch.tv/videos/2611", "title": "On reprend le service", "date": "2026-11-09"}]},
    ]
    assert answer["steps"] == ["Cherche dans le live : « les fois où je crie à l'aide »"]
    # What the search cost counts in the request, not in what the assistant's own steps may spend
    kept = assistant_tools.thread("t1")
    assert kept.own == pytest.approx(4 * 0.0013) and answer["cost"] == pytest.approx(4 * 0.0013 + 0.0031, abs=1e-4)

    # A passage found earlier in the conversation can still be named, and added
    model.script = [call("add_passages", {"passages": ["p1", "p7"]}, "c4"), call("add_passages", {"passages": ["p1"]}, "c5"), "Ajouté."]
    later = assistant.turn("t1", text="ajoute-la", context=HERE, language="fr")
    assert later["status"] == "action" and later["action"]["args"]["passages"] == [{**hit, "job": "job-miami"}]
    assert "no passage p7" in json.loads(tool_messages(model)[-1])["error"]


def test_it_concludes_once_it_spent_what_a_request_may(model, app_calls, monkeypatch):
    monkeypatch.setattr(assistant, "MAX_COST", 0.004)
    model.billed = 0.003
    model.script = [call("list_lives", {}), call("list_lives", {}, "c2"), call("list_lives", {}, "c3", said="Tu as deux lives, dont un analysé."), "jamais dit"]
    answer = assistant.turn("t1", text="fais le tour de tout", context={}, language="fr")
    assert answer["status"] == "done"
    # The third step was its last: told so, tools forbidden, and a tool it calls all the same is not run
    assert [offer["tool_choice"] for offer in model.offered] == [None, None, "none"]
    assert "you have used what one request may take" in model.seen[2][-1][1]
    assert answer["reply"] == [{"type": "text", "text": "Tu as deux lives, dont un analysé."}]
    assert answer["cost"] == 0.009 and len(answer["steps"]) == 2
    assert model.script == ["jamais dit"]


def test_a_new_request_drops_the_action_that_was_waited_on(model, app_calls):
    model.script = [call("open", {"page": "export"}), "Très bien, bonjour."]
    first = assistant.turn("t1", text="ouvre l'export", context=HERE, language="fr")
    assert first["status"] == "action" and first["steps"] == ["Ouvre la page"]
    second = assistant.turn("t1", text="laisse tomber, dis bonjour", context=HERE, language="fr")
    assert second["status"] == "done" and second["reply"] == [{"type": "text", "text": "Très bien, bonjour."}]
    assert second["steps"] == []
    # The model is told the action was not carried out, and the conversation goes on from there
    kinds = [kind for kind, _ in model.seen[-1]]
    assert kinds == ["SystemMessage", "HumanMessage", "AIMessage", "ToolMessage", "HumanMessage"]
    assert "did not complete" in tool_messages(model)[0]
    with pytest.raises(assistant.NothingWaiting):
        assistant.turn("t1", resume={"call": first["action"]["call"], "result": {"ok": True}}, context=HERE, language="fr")


def test_two_actions_asked_at_once_are_handed_one_after_the_other(model, app_calls):
    both = AIMessage(content="", tool_calls=[
        {"name": "open", "args": {"page": "edit", "video": "v-yacht"}, "id": "c1", "type": "tool_call"},
        {"name": "set_look", "args": {"look": {"effects": "light"}}, "id": "c2", "type": "tool_call"},
    ])
    model.script = [both, "Ouvert, avec des effets légers."]
    first = assistant.turn("t1", text="ouvre-la et mets des effets légers", context=HERE, language="fr")
    second = assistant.turn("t1", resume={"call": first["action"]["call"], "result": {"ok": True}}, context=HERE, language="fr")
    assert first["status"] == second["status"] == "action" and first["action"]["call"] != second["action"]["call"]
    assert {first["action"]["name"], second["action"]["name"]} == {"open", "set_look"}
    done = assistant.turn("t1", resume={"call": second["action"]["call"], "result": {"ok": True}}, context=HERE, language="fr")
    assert done["status"] == "done" and done["reply"][0]["text"] == "Ouvert, avec des effets légers."
    # Each was told once, though a tool that waits is run again when its answer comes
    assert sorted(done["steps"]) == ["Change l'habillage", "Ouvre la page"]


def test_one_request_at_a_time_in_a_conversation(model, app_calls):
    lock = assistant._lock("t1")
    assert lock.acquire(blocking=False)
    try:
        with pytest.raises(assistant.Busy):
            assistant.turn("t1", text="salut", context={}, language="fr")
        with pytest.raises(assistant.Busy):
            assistant.forget("t1")
    finally:
        lock.release()
    model.script = ["Bonjour."]
    assert assistant.turn("t1", text="salut", context={}, language="fr")["status"] == "done"


def test_the_conversation_is_kept_and_can_be_forgotten(model, app_calls, monkeypatch):
    model.script = ["Noté.", "Tu aimes les passages courts.", "Je ne sais pas."]
    assistant.turn("t1", text="j'aime les passages courts", context={}, language="fr")
    # After a restart (the file is opened again), the conversation is still there
    monkeypatch.setattr(assistant, "_saver", None)
    assistant.turn("t1", text="j'aime quoi ?", context={"page": "videos"}, language="fr")
    assert [content for kind, content in model.seen[-1] if kind != "SystemMessage"] == ["j'aime les passages courts", "Noté.", "j'aime quoi ?"]
    # ...told where the streamer is now
    assert "Page: videos" in model.seen[-1][0][1]
    assistant.forget("t1")
    assistant.turn("t1", text="j'aime quoi ?", context={}, language="fr")
    assert [content for kind, content in model.seen[-1] if kind != "SystemMessage"] == ["j'aime quoi ?"]
    assert assistant.progress("unknown") == {"steps": [], "running": False}


def test_a_provider_that_refuses_for_good_stops_it(model, app_calls):
    model.script = [Refusal(402)]
    model.fallback.script = ["jamais dit"]
    with pytest.raises(ProviderUnavailable) as stopped:
        assistant.turn("t1", text="salut", context={}, language="fr")
    assert stopped.value.reason == "credits"
    # (the other model would be refused too: it is not asked)
    assert model.fallback.script == ["jamais dit"]


def test_another_model_answers_when_the_first_fails(model, app_calls):
    model.script = [RuntimeError("the model is down")]
    model.fallback.script = ["Bonjour."]
    answer = assistant.turn("t1", text="salut", context={}, language="fr")
    assert answer["status"] == "done" and answer["reply"] == [{"type": "text", "text": "Bonjour."}]


def test_a_tool_that_fails_is_an_answer_not_a_crash(model, app_calls):
    app_calls.answers["clips"] = {"error": "the live was deleted"}
    model.script = [call("list_clips", {"live": "1"}), call("keep_clip", {"state": "maybe"}, "c2"), call("show", {"kind": "videos", "items": []}, "c3"), "Je ne peux pas."]
    answer = assistant.turn("t1", text="les clips", context={"page": "live", "job": "job-miami", "clip": {"filename": "lucia_et_jason_28251.mp4"}}, language="fr")
    assert answer["status"] == "done"
    errors = [json.loads(content)["error"] for content in tool_messages(model)]
    assert errors[0] == "the live was deleted" and "`state` is one of" in errors[1] and "`items`" in errors[2]


def test_listens_and_looks_with_the_ears_and_eyes_of_the_search(model, app_calls, monkeypatch):
    class Tools:
        sounds = transcript = True
        duration = 15020.0

        def __init__(self, *args, **kwargs):
            pass

    asked = []

    def listen(self, start, end, question="", live=None):
        asked.append(("listen", start, end, question, self.vod_url))
        self.run.cost += 0.0004
        return {"from": start, "to": end, "heard": "Il crie, puis une sirène."}

    def look(self, start, end=None, question="", live=None):
        asked.append(("look", start, question))
        self.run.cost += 0.0005
        return {"from": start, "seen": "Écran « MORT »."}

    monkeypatch.setattr(assistant_tools.live_tools, "LiveTools", Tools)
    monkeypatch.setattr(live_search, "relisten", lambda job, url, others=None: None)
    monkeypatch.setattr(assistant_tools.live_agent.Searcher, "listen", listen)
    monkeypatch.setattr(assistant_tools.live_agent.Searcher, "look", look)
    model.billed = 0.001
    model.script = [call("listen", {"start": "3:31:00", "end": "3:31:20", "question": "il crie ?"}), call("look", {"start": "3:12:44"}, "c2"), "Oui."]
    answer = assistant.turn("t1", text="il crie vraiment ?", context=HERE, language="fr")
    assert asked == [("listen", "3:31:00", "3:31:20", "il crie ?", META["url"]), ("look", "3:12:44", "")]
    heard, seen = (json.loads(content) for content in tool_messages(model))
    assert heard == {"live": 1, "from": "3:31:00", "to": "3:31:20", "heard": "Il crie, puis une sirène."} and seen["seen"] == "Écran « MORT »."
    assert answer["steps"] == ["Écoute le live à 3:31:00", "Regarde l'image à 3:12:44"]
    # What the ears and the eyes cost is the request's too
    assert answer["cost"] == pytest.approx(3 * 0.001 + 0.0009)

    # A live Twitch no longer has: nothing to listen to, said to the model
    app_calls.answers["live_meta"] = {**META, "url": None}
    model.script = [call("listen", {"start": "0:01:00", "end": "0:01:10"}, "c3"), "Je ne peux plus l'écouter."]
    assistant.turn("t2", text="écoute", context=HERE, language="fr")
    assert "can't be reached on Twitch" in json.loads(tool_messages(model)[-1])["error"]


def test_a_live_never_listened_to_is_before_its_sounds_are_searched(model, app_calls, monkeypatch):
    from app.services import sound_index

    class Tools:
        sounds = None
        transcript = True

        def __init__(self, *args, **kwargs):
            pass

        def call(self, name, args):
            return {"found": 1} if self.sounds else {"error": "this live's sounds were not analysed"}

    heard = []
    monkeypatch.setattr(assistant_tools.live_tools, "LiveTools", Tools)
    monkeypatch.setattr(live_search, "relisten", lambda job, url, others=None: None)
    monkeypatch.setattr(sound_index, "ensure", lambda job, url: heard.append((job, url)))
    monkeypatch.setattr(sound_index, "load", lambda job: "the sounds")
    model.script = [call("find_sounds", {"kind": "gunfire"}), call("loud_moments", {"kind": "loudest"}, "c2"), "Une fusillade."]
    answer = assistant.turn("t1", text="ça tire quand ?", context=HERE, language="fr")
    assert heard == [("job-miami", META["url"])]
    assert json.loads(tool_messages(model)[0]) == {"live": 1, "found": 1}
    assert answer["steps"] == ["Cherche des sons (gunfire)", "Écoute tout le live une première fois (quelques minutes)", "Cherche là où le son monte"]


def test_the_videos_it_proposes_are_kept_by_the_app(model, app_calls, monkeypatch):
    from app.services import live_ideas

    ideas = [
        {"key": "k-yacht", "title": "Une soirée sur un yacht", "brief": "Fais-moi une vidéo qui raconte la mission du yacht.", "seconds": 75, "pitch": "Une fête qui part en vrille.", "tags": ["mission"], "kind": None, "score": 96, "moments": [11800.0, 12312.5], "span": [11756.0, 14886.0]},
        {"key": "k-calme", "title": "« C'est calme »", "brief": "Fais-moi une vidéo de toutes les fois où on dit que c'est calme.", "seconds": 45, "pitch": "Dit 25 fois.", "tags": ["running gag"], "kind": "funny", "score": 81, "moments": [820.0, 2290.0, 5060.0]},
    ]
    asked = []

    def suggest(job, meta, duration, energy=None, lag=5.0, url=None, moments=None, most=5):
        asked.append((job, meta["title"], duration, lag, url))
        return {"ideas": ideas, "note": "Deux vidéos.", "cached": False, "cost": 0.0059}

    monkeypatch.setattr(live_ideas, "suggest_videos", suggest)
    app_calls.answers["ideas"] = {"videos": [{"key": "k-yacht", "id": "v-new"}]}
    model.script = [call("find_video_ideas", {}), "Deux idées."]
    answer = assistant.turn("t1", text="trouve les meilleures compilations", context=HERE, language="fr")
    assert asked == [("job-miami", "Maurice de retour à Miami", 15020.0, 6.0, META["url"])]
    # The app is given the ideas whole, to keep them as videos waiting to be built
    assert ("ideas", {"job": "job-miami", "ideas": ideas, "note": "Deux vidéos."}) in app_calls
    told = json.loads(tool_messages(model)[0])
    assert told["live"] == 1 and told["note"] == "Deux vidéos."
    assert told["ideas"][0] == {
        "video": "v-new", "source": "sequence", "title": "Une soirée sur un yacht", "pitch": "Une fête qui part en vrille.", "seconds": 75, "score": 96, "tags": ["mission"],
        "in_the_live": ["3:15:56", "4:08:06"], "moments": ["3:16:40", "3:25:12"], "brief": "Fais-moi une vidéo qui raconte la mission du yacht.",
    }
    # (one the app did not keep has no id: it is built from its request)
    assert told["ideas"][1]["source"] == "compilation" and "video" not in told["ideas"][1]
    assert answer["steps"] == ["Parcourt le live à la recherche de vidéos à faire"] and answer["cost"] > 0.0059


def test_the_videos_of_the_app(model, app_calls):
    app_calls.answers["videos"] = {"videos": [{"id": "v-yacht", "job": "job-miami", "name": "Une soirée sur un yacht", "source": "sequence", "seconds": 91, "passages": 17, "state": "exported"}]}
    app_calls.answers["video"] = {
        "id": "v-yacht", "name": "Une soirée sur un yacht", "source": "sequence",
        "parts": [{"title": "Une sortie en mer", "passages": [{"id": "i1", "start": 11870.04, "end": 11874.0, "text": "Regarde-moi ce bateau.", "job": "job-miami"}]}],
        "look": {"universe": "gta", "effects": "strong"},
    }
    model.script = [call("list_videos", {}), call("list_videos", {"live": "1"}, "c2"), call("get_video", {}, "c3"), call("keep_clip", {"clip": "pere_indigne_8954b.mp4", "state": "kept"}, "c4"), "Vu."]
    assistant.turn("t1", text="j'ai quoi ?", context=HERE, language="fr")
    every, one, video, kept = (json.loads(content) for content in tool_messages(model))
    assert [args for name, args in app_calls if name == "videos"] == [{}, {"job": "job-miami"}]
    assert every == one == {"videos": [{"live": 1, "id": "v-yacht", "name": "Une soirée sur un yacht", "source": "sequence", "seconds": 91, "passages": 17, "state": "exported"}]}
    # The video open is the one read; its passages are told as a model names times
    assert ("video", {"job": "job-miami", "id": "v-yacht"}) in app_calls
    assert video["parts"][0]["passages"] == [{"id": "i1", "start": "3:17:50.0", "end": "3:17:54.0", "text": "Regarde-moi ce bateau.", "live": 1}]
    assert ("keep_clip", {"job": "job-miami", "clip": "pere_indigne_8954b.mp4", "state": "kept"}) in app_calls and kept == {"state": "kept"}


def test_the_real_model_class_is_asked_as_openrouter_expects(home, monkeypatch):
    """Nothing is sent: the class's own call is replaced. What it would send, and what it is offered, is looked at."""
    from langchain_core.messages import HumanMessage
    from langchain_openai import ChatOpenAI

    from app.services import settings

    monkeypatch.setattr(settings, "get", lambda key, env_var=None, default="": "sk-or-v1-test")
    monkeypatch.setattr(assistant, "AGENT_MODEL", "openai/gpt-6-luna")
    monkeypatch.setattr(assistant, "AGENT_FALLBACK", "anthropic/claude-haiku-5.5")
    built = assistant.build_model("openai/gpt-6-luna")
    payload = built._get_request_payload([HumanMessage("salut")])
    # Chat completions on OpenRouter, the bill asked with each answer
    assert built.openai_api_base == assistant.OPENROUTER and built.use_responses_api is False
    assert {key: value for key, value in payload.items() if key != "messages"} == {
        "model": "openai/gpt-6-luna", "stream": False, "temperature": 0.2, "max_completion_tokens": 4000,
        "extra_body": {"usage": {"include": True}, "reasoning": {"effort": "low"}},
    }
    assert assistant.build_model("anthropic/claude-haiku-5.5").extra_body["cache_control"] == {"type": "ephemeral"}

    asked = []

    def generate(self, messages, stop=None, run_manager=None, **kwargs):
        asked.append({"model": self.model_name, "tools": [tool["function"]["name"] for tool in kwargs.get("tools", [])]})
        if self.model_name == "openai/gpt-6-luna" and len(asked) == 1:
            raise RuntimeError("the model is down")
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content="Bonjour."))], llm_output={"token_usage": {"prompt_tokens": 3000, "completion_tokens": 20, "cost": 0.00042}})

    monkeypatch.setattr(ChatOpenAI, "_generate", generate)
    answer = assistant.turn("t1", text="salut", context=HERE, language="fr")
    assert answer["status"] == "done" and answer["reply"] == [{"type": "text", "text": "Bonjour."}]
    # What OpenRouter billed is what the request cost
    assert answer["cost"] == 0.0004
    # The model that searches first, then the one that takes over; both offered the assistant's tools only
    assert [one["model"] for one in asked] == ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5"]
    assert set(asked[0]["tools"]) == set(asked[1]["tools"]) == {tool.name for tool in assistant_tools.build(assistant_tools.Turn("t1", HERE, "fr"))}
    assert not set(asked[0]["tools"]) & set(assistant.UNUSED_TOOLS)


def test_not_available_when_a_command_stands_for_the_model(model, monkeypatch):
    monkeypatch.setenv("CUTTIE_LLM_CMD", "cat")
    with pytest.raises(assistant.NotAvailable):
        assistant.turn("t1", text="salut", context={}, language="fr")


def test_what_it_is_doing_is_said_in_the_streamers_language():
    assert assistant_tools.doing("fr", "search_speech", {"words": "à l'aide"}) == "Cherche « à l'aide » dans ce qui se dit"
    assert assistant_tools.doing("en", "read", {"start": "1:02:03"}) == "Reads what is said at 1:02:03"
    assert assistant_tools.doing("es", "find_sounds", {"kind": "gunfire"}) == "Busca sonidos (gunfire)"
    # Nothing to say it is about: the line stands without its quotes; a tool that only shows says nothing
    assert assistant_tools.doing("fr", "search_speech", {}) == "Cherche dans ce qui se dit"
    assert assistant_tools.doing("fr", "show", {"kind": "videos"}) is None
    # Every tool that does something has its line in the three languages
    turn_tools = {tool.name for tool in assistant_tools.build(assistant_tools.Turn.__new__(assistant_tools.Turn))}
    for language in ("fr", "en", "es"):
        assert turn_tools - {"show"} <= set(assistant_tools._DOING[language]), language


@pytest.fixture
async def client(monkeypatch):
    from app.main import app

    monkeypatch.setenv("CUTTIE_INTERNAL_SECRET", "test-secret")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


SECRET = {"X-Cuttie-Secret": "test-secret"}


@pytest.mark.asyncio
async def test_the_endpoints(client, model, app_calls, monkeypatch):
    assert (await client.post("/assistant/turn", json={"thread": "t1", "text": "salut"})).status_code == 401
    assert (await client.post("/assistant/turn", json={"thread": "../x", "text": "salut"}, headers=SECRET)).status_code == 400
    assert (await client.post("/assistant/turn", json={"thread": "t1", "text": "  "}, headers=SECRET)).status_code == 400

    model.script = [call("open", {"page": "export"}), "C'est ouvert."]
    response = await client.post("/assistant/turn", json={"thread": "t1", "text": "ouvre l'export", "context": HERE, "language": "fr"}, headers=SECRET)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "action" and body["action"]["args"] == {"page": "export", "job": "job-miami"}
    assert (await client.get("/assistant/progress", params={"thread": "t1"}, headers=SECRET)).json() == {"steps": ["Ouvre la page"], "running": False}

    wrong = await client.post("/assistant/turn", json={"thread": "t1", "resume": {"call": "nope", "result": {}}, "context": HERE}, headers=SECRET)
    assert wrong.status_code == 409 and wrong.json()["detail"].startswith("nothing_waiting")
    done = await client.post("/assistant/turn", json={"thread": "t1", "resume": {"call": body["action"]["call"], "result": {"opened": True}}, "context": HERE}, headers=SECRET)
    assert done.json()["status"] == "done" and done.json()["reply"] == [{"type": "text", "text": "C'est ouvert."}]

    assert (await client.delete("/assistant/thread", params={"thread": "t1"}, headers=SECRET)).json() == {"success": True}

    # No credits: said as the other AI calls say it
    model.script = [Refusal(402)]
    refused = await client.post("/assistant/turn", json={"thread": "t2", "text": "salut"}, headers=SECRET)
    assert refused.status_code == 402
    # A development command can't call tools
    monkeypatch.setenv("CUTTIE_LLM_CMD", "cat")
    assert (await client.post("/assistant/turn", json={"thread": "t3", "text": "salut"}, headers=SECRET)).status_code == 501
