"""What the assistant (assistant.py) can do, one tool at a time.

Four kinds of tools, all built around one request of the streamer (`Turn`):
- reading a live: the tools an AI searching a live already has (live_tools.py), its ears and
  its eyes (live_agent.py), each told which live it is about;
- the searches that are a work of their own (finding moments, finding videos to propose):
  the loops that already do them (live_search.py, live_ideas.py), with their own models and limits;
- what the app knows and keeps (the lives, the clips, the videos): asked to the API;
- what happens on the streamer's screen (opening a page, building or changing a video, cutting
  a clip, exporting): the tool stops the conversation there (`interrupt`), the app does it and
  answers, and the conversation goes on with what it answered. Asking before spending money works
  the same way.

Times are H:MM:SS in what the model reads and writes, seconds in what the app is given.
"""

import contextvars
import copy
import json
import logging
import os
import re
from dataclasses import dataclass, field

import requests
from langchain_core.tools import StructuredTool
from langgraph.errors import GraphBubbleUp
from langgraph.types import interrupt

from app.services import live_agent, live_search, live_tools
from app.services.presort import hms, parse_hms
from app.services.provider_errors import ProviderUnavailable

logger = logging.getLogger(__name__)

# What a tool may answer at most (as for the AI that searches a live)
TOOL_RESULT_CHARS = live_agent.TOOL_RESULT_CHARS
# What analysing a live costs in credits, dollars (measured: 0.31 $ on a 5 h live): said before it is launched
ANALYSIS_COST = 0.30
# The lives the assistant is told about, the newest first
MAX_LIVES = 12
# Passages found in a conversation that can still be named by their id
MAX_PASSAGES = 400
# The longest passage a video takes, seconds
MAX_PASSAGE = 240.0
API_TIMEOUT = 30
LANGUAGES = {"fr": "French", "en": "English", "es": "Spanish"}

SOURCES = ("clip", "sequence", "compilation")
PAGES = ("live", "edit", "export", "videos", "lives")
SHOWN = ("passages", "videos", "clips", "lives")
EFFECTS = ("none", "light", "strong")
# The effects that can be put on a passage one by one (frontend/src/lib/effectMoves.ts: MOVE_TYPES), and how strong one is
EFFECT_KINDS = ("cam", "zoom", "slow", "shake", "pulse", "flash", "gray")
STRENGTHS = ("soft", "normal", "strong")
CHAT = ("template", "on", "off")
OPENINGS = ("none", "intro", "hook")
LOOK_KEYS = ("universe", "template", "title_style", "effects", "transition", "opening", "intro", "music", "presence", "chat")
CLIP_STATES = ("kept", "passed", "none")

_JOB = re.compile(r"^[A-Za-z0-9_-]{6,64}$")

# The tool call being run (set by assistant.py around each one): a tool that is run again after it
# stopped the conversation says the same thing once
current_call: contextvars.ContextVar[str | None] = contextvars.ContextVar("assistant_tool_call", default=None)


class Refused(Exception):
    """What a tool can't do, said to the model as it is (it then asks otherwise or tells the streamer)."""


def api_tool(name: str, args: dict | None = None) -> dict | list:
    """Ask the app for something it keeps, or to change it: POST <API>/api/internal/assistant
    {"tool", "args"} with the shared secret. An error comes back as {"error": "..."}."""
    base = os.getenv("CUTTIE_API_URL", "").rstrip("/")
    if not base:
        return {"error": "the app can't be reached from here"}
    try:
        response = requests.post(
            f"{base}/api/internal/assistant",
            json={"tool": name, "args": args or {}},
            headers={"X-Cuttie-Secret": os.getenv("CUTTIE_INTERNAL_SECRET", "")},
            timeout=API_TIMEOUT,
        )
    except requests.RequestException as e:
        return {"error": f"the app did not answer ({type(e).__name__})"}
    try:
        data = response.json()
    except ValueError:
        data = None
    if response.status_code >= 400:
        detail = data.get("error") if isinstance(data, dict) else None
        return {"error": str(detail or f"the app refused ({response.status_code})")[:300]}
    return data if isinstance(data, (dict, list)) else {"error": "the app answered nothing"}


def _rows(answer, key: str) -> list[dict]:
    """A list the app answered, given bare or under its name."""
    rows = answer.get(key) if isinstance(answer, dict) else answer
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _failed(answer) -> str | None:
    return str(answer["error"]) if isinstance(answer, dict) and answer.get("error") else None


@dataclass
class Thread:
    """What is kept of a conversation between two requests, besides what was said (the checkpoint):
    what the request under way did so far, and the passages found that can still be named."""

    # What it did, as the streamer reads it; the tool calls already told
    steps: list[str] = field(default_factory=list)
    told: set[str] = field(default_factory=set)
    # What it showed (widgets of the reply), by tool call
    widgets: dict[str, dict] = field(default_factory=dict)
    # Dollars: everything this request cost, and the assistant's own model calls alone (what its limit is about)
    cost: float = 0.0
    own: float = 0.0
    calls: int = 0
    running: bool = False
    # A live being searched by a loop of its own (its progress is that loop's)
    searching: str | None = None
    passages: dict[str, dict] = field(default_factory=dict)
    found: int = 0

    def new_request(self) -> None:
        self.steps, self.told, self.widgets = [], set(), {}
        self.cost = self.own = 0.0
        self.calls = 0
        self.searching = None


_threads: dict[str, Thread] = {}


def thread(thread_id: str) -> Thread:
    return _threads.setdefault(thread_id, Thread())


def forget(thread_id: str) -> None:
    _threads.pop(thread_id, None)


def _seconds(value, what: str = "a time") -> float:
    parsed = parse_hms(value) if not isinstance(value, (int, float)) else float(value)
    if parsed is None or parsed < 0:
        raise Refused(f"{what} must be given as H:MM:SS")
    return round(parsed, 2)


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _id_of(value, *keys: str) -> str | None:
    """An id given as it is, or inside what the app says the streamer is looking at ({"id": ...})."""
    if isinstance(value, dict):
        return next((str(value[key]) for key in keys if value.get(key)), None)
    return str(value) if value not in (None, "") else None


def _out(result) -> str:
    """A tool's answer as the model reads it: JSON, accents as they are, never longer than a tool may answer."""
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)[:TOOL_RESULT_CHARS]


# What each tool is doing, as the streamer reads it while they wait ({detail}: what it is about)
_DOING = {
    "fr": {
        "overview": "Regarde ce qu'est le live", "best_moments": "Regarde les meilleurs moments de l'analyse", "search_speech": "Cherche « {detail} » dans ce qui se dit",
        "search_chat": "Cherche « {detail} » dans le chat", "chat_peaks": "Regarde quand le chat s'emballe", "find_sounds": "Cherche des sons ({detail})",
        "loud_moments": "Cherche là où le son monte", "read": "Lit ce qui se dit à {detail}", "recurring": "Compte ce qui revient dans le live",
        "listen": "Écoute le live à {detail}", "look": "Regarde l'image à {detail}", "find_moments": "Cherche dans le live : « {detail} »",
        "find_video_ideas": "Parcourt le live à la recherche de vidéos à faire", "list_lives": "Regarde tes lives", "list_clips": "Regarde les clips du live",
        "list_videos": "Regarde tes vidéos", "get_video": "Regarde la vidéo", "keep_clip": "Range le clip", "analyse_live": "Prépare l'analyse du live",
        "ask_approval": "Te demande ton accord", "open": "Ouvre la page", "build_video": "Construit la vidéo", "change_video": "Modifie la vidéo",
        "add_passages": "Ajoute les passages à la vidéo", "cut_clip": "Découpe le clip", "set_look": "Change l'habillage", "export_videos": "Lance l'export",
        "edit_effects": "Règle les effets de la vidéo", "set_music_levels": "Règle le niveau de la musique",
        "list_imported_videos": "Regarde ta médiathèque", "add_imported_videos": "Ajoute ta vidéo au montage",
        "hearing": "Écoute tout le live une première fois (quelques minutes)",
    },
    "en": {
        "overview": "Looks at what the live is", "best_moments": "Looks at the analysis' best moments", "search_speech": "Searches what is said for “{detail}”",
        "search_chat": "Searches the chat for “{detail}”", "chat_peaks": "Looks at when the chat goes wild", "find_sounds": "Looks for sounds ({detail})",
        "loud_moments": "Looks for where it gets loud", "read": "Reads what is said at {detail}", "recurring": "Counts what comes back in the live",
        "listen": "Listens to the live at {detail}", "look": "Looks at the picture at {detail}", "find_moments": "Searches the live: “{detail}”",
        "find_video_ideas": "Goes through the live for videos worth making", "list_lives": "Looks at your lives", "list_clips": "Looks at the live's clips",
        "list_videos": "Looks at your videos", "get_video": "Looks at the video", "keep_clip": "Sorts the clip", "analyse_live": "Gets the live's analysis ready",
        "ask_approval": "Asks for your go-ahead", "open": "Opens the page", "build_video": "Builds the video", "change_video": "Changes the video",
        "add_passages": "Adds the passages to the video", "cut_clip": "Cuts the clip", "set_look": "Changes the look", "export_videos": "Starts the export",
        "edit_effects": "Sets the video's effects", "set_music_levels": "Sets the music's level",
        "list_imported_videos": "Looks at your media library", "add_imported_videos": "Adds your video to the montage",
        "hearing": "Listens to the whole live once (a few minutes)",
    },
    "es": {
        "overview": "Mira qué es el directo", "best_moments": "Mira los mejores momentos del análisis", "search_speech": "Busca «{detail}» en lo que se dice",
        "search_chat": "Busca «{detail}» en el chat", "chat_peaks": "Mira cuándo se dispara el chat", "find_sounds": "Busca sonidos ({detail})",
        "loud_moments": "Busca dónde sube el sonido", "read": "Lee lo que se dice en {detail}", "recurring": "Cuenta lo que se repite en el directo",
        "listen": "Escucha el directo en {detail}", "look": "Mira la imagen en {detail}", "find_moments": "Busca en el directo: «{detail}»",
        "find_video_ideas": "Recorre el directo en busca de vídeos que hacer", "list_lives": "Mira tus directos", "list_clips": "Mira los clips del directo",
        "list_videos": "Mira tus vídeos", "get_video": "Mira el vídeo", "keep_clip": "Ordena el clip", "analyse_live": "Prepara el análisis del directo",
        "ask_approval": "Te pide permiso", "open": "Abre la página", "build_video": "Construye el vídeo", "change_video": "Cambia el vídeo",
        "add_passages": "Añade los pasajes al vídeo", "cut_clip": "Corta el clip", "set_look": "Cambia el estilo", "edit_effects": "Ajusta los efectos del vídeo", "set_music_levels": "Ajusta el nivel de la música", "export_videos": "Lanza la exportación",
        "list_imported_videos": "Mira tu mediateca", "add_imported_videos": "Añade tu vídeo al montaje",
        "hearing": "Escucha todo el directo una primera vez (unos minutos)",
    },
}


def doing(language: str, name: str, args: dict | None = None) -> str | None:
    """What a tool call is doing, in the streamer's language (None: nothing worth telling)."""
    line = _DOING.get(language, _DOING["fr"]).get(name)
    if not line:
        return None
    args = args or {}
    # (a passage read, heard or looked at is told by its time, even when a question comes with it)
    keys = ("start",) if name in ("read", "listen", "look") else ("words", "question", "kind", "start")
    detail = next((str(args[key]) for key in keys if args.get(key)), "")
    line = " ".join(line.format(detail=detail[:60]).split())
    # (nothing to say it is about: the line stands without its quotes)
    for empty in ("« »", "«»", "“”", "()"):
        line = line.replace(empty, "")
    return " ".join(line.split()).rstrip(" :")


class Turn:
    """One request of the streamer: where they are, their lives, and what the tools need to answer."""

    def __init__(self, thread_id: str, context: dict | None = None, language: str = "fr") -> None:
        self.id = thread_id
        self.kept = thread(thread_id)
        self.context = context if isinstance(context, dict) else {}
        self.language = language if language in LANGUAGES else "fr"
        # The streamer's lives, the newest first, as the app lists them (asked once per request)
        self.lives = _rows(api_tool("lives"), "lives")[:MAX_LIVES]
        self._metas: dict[str, dict] = {}
        self._tools: dict[str, live_tools.LiveTools] = {}
        self._senses: dict[str, live_agent.Searcher] = {}

    # ── Where things are ─────────────────────────────────────────────────────

    def here(self) -> str | None:
        """The live the streamer is looking at (its job id), when they are on one."""
        return _id_of(self.context.get("job") or self.context.get("live"), "job", "id")

    def row(self, live) -> dict | None:
        """The live a model named: by its number in the list, or by its job id."""
        name = str(live).strip() if live not in (None, "") else ""
        if name.isdigit() and 1 <= int(name) <= len(self.lives):
            return self.lives[int(name) - 1]
        return next((row for row in self.lives if name and row.get("job") == name), None)

    def number(self, job: str | None) -> int | None:
        return next((n + 1 for n, row in enumerate(self.lives) if job and row.get("job") == job), None)

    def job(self, live=None) -> str:
        """The job id of an analysed live: the one named, else the one on screen."""
        if live in (None, "", 0, "0"):
            job = self.here()
            if not job:
                raise Refused("say which live: its number in the list of lives")
            return job
        row = self.row(live)
        if row is not None:
            if not row.get("job") or row.get("analysed") is False:
                raise Refused(f"live {live} is not analysed yet: `analyse_live` does it, when the streamer wants it")
            return str(row["job"])
        name = str(live).strip()
        if name == self.here() or (not name.isdigit() and _JOB.match(name)):
            return name
        raise Refused(f"no such live: {live}. `live` is a number of the list of lives (1 to {len(self.lives)})")

    def meta(self, job: str) -> dict:
        """What the app knows of an analysed live: its length, its address, its game, the moments the analysis rated."""
        if job not in self._metas:
            answer = api_tool("live_meta", {"job": job})
            if _failed(answer) or not isinstance(answer, dict):
                raise Refused(f"this live can't be read: {_failed(answer) or 'the app knows nothing of it'}")
            self._metas[job] = answer
        return self._metas[job]

    def tools(self, job: str) -> live_tools.LiveTools:
        """The reading tools of one live (its transcript, chat and sounds are loaded once per request)."""
        if job not in self._tools:
            meta = self.meta(job)
            try:
                # A live transcribed in half-minute lines is transcribed again first, once (see live_search.relisten)
                live_search.relisten(job, meta.get("url"))
            except ProviderUnavailable:
                raise
            except Exception as e:
                logger.warning(f"Assistant: live {job[:8]} not listened to again: {type(e).__name__}: {e}")
            self._tools[job] = live_tools.LiveTools(job, float(meta.get("duration") or 0.0), float(meta.get("lag") or 5.0), meta.get("moments") or [], date=meta.get("date"))
        return self._tools[job]

    def senses(self, job: str) -> live_agent.Searcher:
        """The ears and the eyes on one live (how many times they may be used is counted per live and request)."""
        if job not in self._senses:
            from app.services.openai_client import get_openrouter_client

            self._senses[job] = live_agent.Searcher(self.tools(job), get_openrouter_client(), live_agent.SEARCH_MODEL, vod_url=self.meta(job).get("url"))
        return self._senses[job]

    def spend(self, dollars: float) -> None:
        self.kept.cost += max(0.0, float(dollars or 0.0))

    def tell(self, name: str, args: dict | None = None, call: str | None = None) -> None:
        """One more line of what it is doing (a call told once, even when it is run again)."""
        if call and call in self.kept.told:
            return
        line = doing(self.language, name, args)
        if not line:
            return
        if call:
            self.kept.told.add(call)
        self.kept.steps.append(line)

    # ── Reading a live ───────────────────────────────────────────────────────

    def read_live(self, name: str, live=None, **args) -> dict:
        job = self.job(live)
        tools = self.tools(job)
        if name in ("find_sounds", "loud_moments") and not tools.sounds:
            self._hear(job, tools)
        result = tools.call(name, args)
        number = self.number(job)
        return {"live": number, **result} if number and isinstance(result, dict) else result

    def _hear(self, job: str, tools: live_tools.LiveTools) -> None:
        """A live never listened to is, once (two or three minutes), the first time its sounds are asked for."""
        from app.services import sound_index

        url = self.meta(job).get("url")
        if not url:
            return
        self.tell("hearing")
        try:
            sound_index.ensure(job, url)
            tools.sounds = sound_index.load(job)
        except Exception as e:
            logger.warning(f"Assistant: live {job[:8]} could not be listened to: {type(e).__name__}: {e}")

    def sense(self, name: str, live=None, **args) -> dict:
        job = self.job(live)
        if not self.meta(job).get("url"):
            raise Refused("this live can't be reached on Twitch any more: nothing to listen to or to look at")
        searcher = self.senses(job)
        before = searcher.run.cost
        try:
            result = searcher.listen(**args) if name == "listen" else searcher.look(**args)
        finally:
            self.spend(searcher.run.cost - before)
        number = self.number(job)
        return {"live": number, **result} if number and "live" not in result else result

    # ── Searches that are a work of their own ────────────────────────────────

    def _asked(self, job: str) -> tuple[dict, dict]:
        meta = self.meta(job)
        return meta, {"title": meta.get("title"), "game": meta.get("game"), "streamer": meta.get("streamer"), "date": meta.get("date")}

    def find_moments(self, question: str, live=None) -> dict:
        job = self.job(live)
        question = _text(question, 300)
        if not question:
            raise Refused("say what to look for")
        meta, told = self._asked(job)
        self.kept.searching = job
        try:
            found = live_search.search_ai(job, question, told, float(meta.get("duration") or 0.0), None, float(meta.get("lag") or 5.0), url=meta.get("url"), moments=(meta.get("moments") or [])[:400])
        except live_search.NoTranscript:
            raise Refused("this live has no transcript: its words can't be searched") from None
        finally:
            self.kept.searching = None
        self.spend(found.get("cost") or 0.0)
        return {"found": found.get("total", 0), "note": found.get("note", ""), "passages": self.keep_passages(job, found.get("hits") or [])}

    def keep_passages(self, job: str, hits: list[dict]) -> list[dict]:
        """Passages a search found, each under an id the model names them by afterwards (the app gets them whole)."""
        number = self.number(job)
        told = []
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            self.kept.found += 1
            ref = f"p{self.kept.found}"
            self.kept.passages[ref] = {**hit, "job": job}
            score = float(hit.get("score") or 0.0)
            told.append({
                "id": ref,
                **({"live": number} if number else {}),
                "at": live_search.stamp(float(hit.get("start") or 0.0)),
                "seconds": round(float(hit.get("end") or 0.0) - float(hit.get("start") or 0.0), 1),
                "said": _text(hit.get("text"), 160),
                **({"why": _text(hit.get("why"), 140)} if hit.get("why") else {}),
                **({"score": round(100 * score if score <= 1 else score)} if score else {}),
            })
        # The oldest go first when a conversation found very many
        for old in list(self.kept.passages)[: max(0, len(self.kept.passages) - MAX_PASSAGES)]:
            del self.kept.passages[old]
        return told

    def find_video_ideas(self, live=None) -> dict:
        from app.services import live_ideas

        job = self.job(live)
        meta, told = self._asked(job)
        self.kept.searching = job
        try:
            found = live_ideas.suggest_videos(job, told, float(meta.get("duration") or 0.0), None, float(meta.get("lag") or 5.0), meta.get("url"), (meta.get("moments") or [])[:400])
        except live_search.NoTranscript:
            raise Refused("this live has no transcript: it can't be looked through") from None
        finally:
            self.kept.searching = None
        self.spend(found.get("cost") or 0.0)
        ideas = [idea for idea in found.get("ideas") or [] if isinstance(idea, dict)]
        # The app keeps them as videos waiting to be built, when it can: each then has an id to build or to show it by
        kept = api_tool("ideas", {"job": job, "ideas": ideas, "note": found.get("note", "")}) if ideas else {}
        ids = {str(row.get("key")): row.get("id") for row in _rows(kept, "videos") if row.get("key") and row.get("id")}
        number = self.number(job)
        return {
            **({"live": number} if number else {}),
            "note": found.get("note", ""),
            "ideas": [
                {
                    **({"video": ids[str(idea.get("key"))]} if str(idea.get("key")) in ids else {}),
                    "source": "sequence" if idea.get("span") else "compilation",
                    "title": idea.get("title"),
                    "pitch": idea.get("pitch"),
                    "seconds": idea.get("seconds"),
                    "score": idea.get("score"),
                    "tags": idea.get("tags") or [],
                    **({"in_the_live": [hms(float(idea["span"][0])), hms(float(idea["span"][1]))]} if idea.get("span") else {}),
                    "moments": [hms(float(at)) for at in (idea.get("moments") or [])[:12]],
                    "brief": idea.get("brief"),
                }
                for idea in ideas
            ],
        }

    # ── What the app knows ───────────────────────────────────────────────────

    def list_lives(self) -> dict:
        return {"lives": [
            {
                "live": n + 1,
                "title": row.get("title"),
                "date": row.get("date"),
                "game": row.get("game"),
                **({"length": hms(float(row["seconds"]))} if row.get("seconds") else {}),
                "analysed": bool(row.get("job")) and row.get("analysed") is not False,
                **({"status": row["status"]} if row.get("status") else {}),
                **({k: row[k] for k in ("clips", "kept", "videos", "ideas") if row.get(k) is not None}),
            }
            for n, row in enumerate(self.lives)
        ]}

    def list_clips(self, live=None) -> dict:
        job = self.job(live)
        answer = api_tool("clips", {"job": job})
        if _failed(answer):
            raise Refused(_failed(answer))
        return {"live": self.number(job), "clips": [
            {
                "clip": row.get("filename"),
                "name": row.get("name"),
                "score": row.get("score"),
                **({"at": hms(float(row["at"]))} if row.get("at") is not None else {}),
                **({"seconds": round(float(row["length"]))} if row.get("length") is not None else {}),
                **({"seen": _text(row["seen"], 200)} if row.get("seen") else {}),
                **({"tags": row["tags"]} if row.get("tags") else {}),
                "state": row.get("state") or "none",
            }
            for row in _rows(answer, "clips")
        ]}

    def list_videos(self, live=None) -> dict:
        job = self.job(live) if live not in (None, "", 0, "0") else None
        answer = api_tool("videos", {"job": job} if job else {})
        if _failed(answer):
            raise Refused(_failed(answer))
        return {"videos": [{**({"live": self.number(str(row.get("job")))} if self.number(str(row.get("job"))) else {}), **{k: v for k, v in row.items() if k != "job"}} for row in _rows(answer, "videos")]}

    def video_id(self, video=None) -> str:
        found = _id_of(video, "id") or _id_of(self.context.get("video"), "id")
        if not found:
            raise Refused("say which video: its id, as `list_videos` gives it")
        return found

    def get_video(self, video=None, live=None) -> dict:
        job = self.job(live)
        answer = api_tool("video", {"job": job, "id": self.video_id(video)})
        if _failed(answer) or not isinstance(answer, dict):
            raise Refused(_failed(answer) or "the app knows no such video")
        told = copy.deepcopy(answer)
        # (passages as the model names times: H:MM:SS.s)
        for part in told.get("parts") or told.get("sections") or []:
            for passage in (part.get("passages") or part.get("items") or []) if isinstance(part, dict) else []:
                if isinstance(passage, dict):
                    for key in ("start", "end"):
                        if isinstance(passage.get(key), (int, float)):
                            passage[key] = live_search.stamp(float(passage[key]))
                    if passage.get("job"):
                        passage["live"] = self.number(str(passage.pop("job")))
        return told

    def keep_clip(self, clip=None, state: str = "kept", live=None) -> dict:
        job = self.job(live)
        filename = _id_of(clip, "filename") or _id_of(self.context.get("clip"), "filename", "id")
        if not filename:
            raise Refused("say which clip: its file, as `list_clips` gives it")
        if state not in CLIP_STATES:
            raise Refused(f"`state` is one of: {', '.join(CLIP_STATES)}")
        return api_tool("keep_clip", {"job": job, "clip": filename, "state": state})

    # ── What the app does on the streamer's screen ───────────────────────────

    def app(self, name: str, args: dict) -> dict:
        """Hand an action to the app and wait for what it answers (the conversation stops here until it does)."""
        answer = interrupt({"name": name, "args": args, "needs": "app"})
        # What the app spent doing it (a video built or changed by the AI) is part of what this request cost
        if isinstance(answer, dict) and isinstance(answer.get("cost"), (int, float)) and not isinstance(answer.get("cost"), bool):
            self.spend(answer["cost"])
        return answer if isinstance(answer, (dict, list, str)) else {"done": bool(answer)}

    def passage(self, ref) -> dict:
        """A passage as the app takes it: one a search found (by its id), or one given by its times."""
        if isinstance(ref, str):
            found = self.kept.passages.get(ref.strip())
            if not found:
                raise Refused(f"no passage {ref}: give the id a search gave it (p1, p2...), or its start and end")
            return dict(found)
        if not isinstance(ref, dict):
            raise Refused("a passage is an id (p1, p2...) or {start, end, text}")
        if ref.get("id") and not ref.get("start"):
            return self.passage(str(ref["id"]))
        start, end = _seconds(ref.get("start"), "a passage's start"), _seconds(ref.get("end"), "a passage's end")
        if not 0.2 <= end - start <= MAX_PASSAGE:
            raise Refused(f"a passage lasts between a moment and {MAX_PASSAGE:.0f} seconds: {ref.get('start')} to {ref.get('end')} does not")
        return {"job": self.job(ref.get("live") or ref.get("job")), "start": start, "end": end, "text": _text(ref.get("text") or ref.get("said"), 400)}

    def open(self, page: str, live=None, video=None, clip=None) -> dict:
        if page not in PAGES:
            raise Refused(f"`page` is one of: {', '.join(PAGES)}")
        job = self.job(live) if page in ("live", "edit", "export") or live not in (None, "") else None
        return self.app("open", {
            "page": page,
            **({"job": job} if job else {}),
            **({"video": _id_of(video, "id")} if _id_of(video, "id") else {}),
            **({"clip": _id_of(clip, "filename")} if _id_of(clip, "filename") else {}),
        })

    def build_video(self, source: str, brief: str = "", target=None, live=None, idea=None, leads=None) -> dict:
        if source not in SOURCES:
            raise Refused(f"`source` is one of: {', '.join(SOURCES)}")
        brief = str(brief or "").strip()[:4000]
        if not brief and not idea:
            raise Refused("say what the video is (`brief`), or which idea to build (`idea`)")
        try:
            seconds = max(10.0, min(600.0, float(target))) if target not in (None, "") else None
        except (TypeError, ValueError):
            raise Refused("`target` is the video's length in seconds") from None
        return self.app("build_video", {
            "job": self.job(live),
            "source": source,
            "brief": brief,
            **({"target": seconds} if seconds else {}),
            **({"idea": str(idea)} if idea else {}),
            **({"leads": [_seconds(at, "a lead") for at in leads][:40]} if isinstance(leads, list) and leads else {}),
        })

    def change_video(self, request: str, video=None, live=None) -> dict:
        request = str(request or "").strip()[:4000]
        if not request:
            raise Refused("say what to change")
        return self.app("change_video", {"job": self.job(live), "video": self.video_id(video), "request": request})

    def add_passages(self, passages, video=None, live=None, part: str = "") -> dict:
        if not isinstance(passages, list) or not passages:
            raise Refused("`passages` is a list of ids (p1, p2...) or of {start, end, text}")
        return self.app("add_passages", {
            "job": self.job(live),
            "video": self.video_id(video),
            "passages": [self.passage(ref) for ref in passages][:60],
            **({"part": _text(part, 60)} if _text(part, 60) else {}),
        })

    def list_imported_videos(self) -> dict:
        answer = api_tool("media", {})
        if _failed(answer):
            raise Refused(_failed(answer))
        return answer

    def add_imported_videos(self, videos, video=None, live=None, part: str = "") -> dict:
        named = [_text(one, 80) for one in videos if _text(one, 80)][:20] if isinstance(videos, list) else []
        if not named:
            raise Refused("`videos` is a list of imported videos, each by its id or its name as `list_imported_videos` gives them")
        return self.app("add_media", {
            "job": self.job(live),
            "video": self.video_id(video),
            "media": named,
            **({"part": _text(part, 60)} if _text(part, 60) else {}),
        })

    def cut_clip(self, live=None, clip=None, video=None, target=None) -> dict:
        filename = _id_of(clip, "filename") or (None if video else _id_of(self.context.get("clip"), "filename", "id"))
        video_id = _id_of(video, "id") or (None if filename else _id_of(self.context.get("video"), "id"))
        if not filename and not video_id:
            raise Refused("say which clip to cut: its file (`clip`), or the video made of it (`video`)")
        try:
            seconds = max(10.0, min(180.0, float(target))) if target not in (None, "") else None
        except (TypeError, ValueError):
            raise Refused("`target` is the length to aim for, in seconds") from None
        return self.app("cut_clip", {
            "job": self.job(live),
            **({"clip": filename} if filename else {}),
            **({"video": video_id} if video_id else {}),
            **({"target": seconds} if seconds else {}),
        })

    def set_look(self, look, video=None, live=None) -> dict:
        if not isinstance(look, dict):
            raise Refused("`look` is an object: what to change, and to what")
        wanted = {key: (_text(value, 80) if value is not None else None) for key, value in look.items() if key in LOOK_KEYS}
        if not wanted:
            raise Refused(f"`look` can change: {', '.join(LOOK_KEYS)}")
        if wanted.get("effects") not in (None, *EFFECTS):
            raise Refused(f"`effects` is one of: {', '.join(EFFECTS)}")
        if wanted.get("opening") not in (None, *OPENINGS):
            raise Refused(f"`opening` is one of: {', '.join(OPENINGS)}")
        if wanted.get("chat") not in (None, *CHAT):
            raise Refused(f"`chat` is one of: {', '.join(CHAT)}")
        return self.app("set_look", {"job": self.job(live), "video": self.video_id(video), "look": wanted})

    def edit_effects(self, add=None, change=None, remove=None, clear: bool = False, video=None, live=None) -> dict:
        def one(raw, needs: tuple[str, ...]) -> dict:
            if not isinstance(raw, dict) or any(not raw.get(key) and raw.get(key) != 0 for key in needs):
                raise Refused(f"each one is an object with: {', '.join(needs)}")
            if raw.get("kind") is not None and raw["kind"] not in EFFECT_KINDS:
                raise Refused(f"`kind` is one of: {', '.join(EFFECT_KINDS)}")
            if raw.get("strength") is not None and raw["strength"] not in STRENGTHS:
                raise Refused(f"`strength` is one of: {', '.join(STRENGTHS)}")
            out = {key: _text(raw[key], 40) for key in ("id", "passage", "kind", "strength") if raw.get(key) is not None}
            for key in ("at", "seconds"):
                if raw.get(key) is not None:
                    try:
                        out[key] = round(float(raw[key]), 2)
                    except (TypeError, ValueError):
                        raise Refused(f"`{key}` is a number of seconds") from None
            if isinstance(raw.get("sharp"), bool):
                out["sharp"] = raw["sharp"]
            return out

        asked = {
            "add": [one(raw, ("passage", "kind", "at")) for raw in (add if isinstance(add, list) else [])][:40],
            "change": [one(raw, ("id",)) for raw in (change if isinstance(change, list) else [])][:40],
            "remove": [_text(ref, 40) for ref in (remove if isinstance(remove, list) else []) if ref][:60],
        }
        return self.app("edit_effects", {"job": self.job(live), "video": self.video_id(video), **{key: value for key, value in asked.items() if value}, **({"clear": True} if clear else {})})

    def set_music_levels(self, levels, video=None, live=None) -> dict:
        if not isinstance(levels, list) or not levels:
            raise Refused("`levels` is a list of {passage, percent}")
        out = []
        for raw in levels[:60]:
            if not isinstance(raw, dict) or not raw.get("passage"):
                raise Refused("each one is {passage: its id, percent: 0 to 100, or null to give it back to the app}")
            percent = raw.get("percent")
            if percent is not None:
                try:
                    percent = float(percent)
                except (TypeError, ValueError):
                    raise Refused("`percent` is a number from 0 to 100, or null") from None
                if not 0 <= percent <= 100:
                    raise Refused("`percent` is a number from 0 to 100, or null")
            out.append({"passage": _text(raw["passage"], 40), "percent": percent})
        return self.app("set_music_levels", {"job": self.job(live), "video": self.video_id(video), "levels": out})

    def export_videos(self, videos=None) -> dict:
        refs = videos if isinstance(videos, list) and videos else [self.context.get("video")]
        out = []
        for ref in refs:
            video_id = _id_of(ref, "id")
            if not video_id:
                raise Refused("say which videos: their ids, as `list_videos` gives them")
            out.append({"job": self.job(ref.get("live") or ref.get("job") if isinstance(ref, dict) else None), "id": video_id})
        return self.app("export_videos", {"videos": out[:40]})

    # ── Asking first ─────────────────────────────────────────────────────────

    def approval(self, what: str, detail: str = "", cost=0.0, **more) -> bool:
        """Ask the streamer before something that costs or can't be undone (the conversation stops until they answer)."""
        try:
            dollars = round(max(0.0, float(cost or 0.0)), 2)
        except (TypeError, ValueError):
            dollars = 0.0
        answer = interrupt({"name": "ask_approval", "args": {"what": _text(what, 200), "detail": _text(detail, 300), "cost": dollars, **more}, "needs": "approval"})
        return bool(answer.get("approved")) if isinstance(answer, dict) else bool(answer)

    def ask_approval(self, what: str, detail: str = "", cost=0.0) -> dict:
        if not _text(what, 200):
            raise Refused("say what you ask the go-ahead for")
        return {"approved": self.approval(what, detail, cost)}

    def analyse_live(self, live) -> dict:
        row = self.row(live)
        name = str(live or "").strip()
        if row is None and not name.startswith(("https://", "http://")):
            raise Refused(f"no such live: {live}. Give its number in the list of lives, or its address on Twitch")
        if row is not None and row.get("job") and row.get("analysed") is not False and row.get("status") in (None, "DONE"):
            raise Refused(f"live {live} is already analysed")
        url = (row or {}).get("url") or (f"https://www.twitch.tv/videos/{row['vod']}" if row and row.get("vod") else name)
        if not str(url).startswith(("https://", "http://")):
            raise Refused("this live has no address on Twitch: it can't be analysed")
        title = _text((row or {}).get("title") or url, 120)
        if not self.approval("analyse_live", title, ANALYSIS_COST, live={k: (row or {}).get(k) for k in ("title", "date", "game", "seconds", "vod") if (row or {}).get(k)} or {"url": url}):
            return {"started": False, "why": "the streamer said no: nothing was launched"}
        started = api_tool("start_analysis", {"url": url, **({"vod": row["vod"]} if row and row.get("vod") else {})})
        if _failed(started):
            return {"started": False, "why": _failed(started)}
        return {"started": True, **(started if isinstance(started, dict) else {})}

    # ── Showing ──────────────────────────────────────────────────────────────

    def show(self, kind: str, items) -> dict:
        """Something shown in the reply (a widget): passages to hear, videos, clips or lives to open."""
        if kind not in SHOWN:
            raise Refused(f"`kind` is one of: {', '.join(SHOWN)}")
        if not isinstance(items, list) or not items:
            raise Refused("`items` is the list of what to show")
        shown: list[dict] = []
        for item in items[:24]:
            if kind == "passages":
                shown.append(self.passage(item))
            elif kind == "videos":
                video_id = _id_of(item, "id")
                if not video_id:
                    raise Refused("a video is shown by its id")
                shown.append({"job": self.job(item.get("live") or item.get("job") if isinstance(item, dict) else None), "id": video_id})
            elif kind == "clips":
                filename = _id_of(item, "filename", "clip")
                if not filename:
                    raise Refused("a clip is shown by its file")
                shown.append({"job": self.job(item.get("live") or item.get("job") if isinstance(item, dict) else None), "filename": filename})
            else:
                row = self.row(item.get("live") or item.get("job") if isinstance(item, dict) else item)
                if row is None:
                    raise Refused(f"no such live: {item}")
                shown.append({k: row[k] for k in ("job", "vod", "url", "title", "date") if row.get(k)})
        self.kept.widgets[current_call.get() or f"show-{len(self.kept.widgets)}"] = {"type": "widget", "kind": kind, "items": shown}
        return {"shown": len(shown)}


# ── The tools as the model is given them ─────────────────────────────────────

_LIVE = {"type": "string", "description": "Which live: its number in the list of lives. Left out: the live the streamer is looking at."}
_VIDEO = {"type": "string", "description": "The video's id. Left out: the video the streamer has open."}
_PASSAGE = {
    "description": "A passage of a live: the id a search gave it (\"p3\"), or its bounds.",
    "anyOf": [
        {"type": "string"},
        {
            "type": "object",
            "properties": {"live": _LIVE, "start": {"type": "string", "description": "H:MM:SS"}, "end": {"type": "string", "description": "H:MM:SS"}, "text": {"type": "string", "description": "What is said there"}},
            "required": ["start", "end"],
        },
    ],
}


def _schema(properties: dict | None = None, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": properties or {}, **({"required": required} if required else {})}


def _tool(name: str, description: str, schema: dict, body) -> StructuredTool:
    """A tool whose failures are answers: what it can't do is said to the model, which goes on. What stops
    the conversation on purpose (an action handed to the app) and a provider that refuses for good pass through."""

    def run(**args):
        try:
            return _out(body(**args))
        except (GraphBubbleUp, ProviderUnavailable):
            raise
        except Refused as e:
            return _out({"error": str(e)})
        except TypeError as e:
            return _out({"error": f"bad arguments for {name}: {e}"[:300]})
        except Exception as e:
            logger.warning(f"Assistant: {name} failed: {type(e).__name__}: {e}")
            return _out({"error": f"{name} failed: {type(e).__name__}: {e}"[:300]})

    return StructuredTool.from_function(func=run, name=name, description=description, args_schema=schema)


def _reading(turn: Turn) -> list[StructuredTool]:
    """The tools of an AI searching a live, each with the live it is about."""
    out = []
    for spec in [*live_tools.SPECS, live_tools.RECURRING_SPEC]:
        schema = copy.deepcopy(spec["parameters"])
        schema.setdefault("properties", {})["live"] = _LIVE
        out.append(_tool(spec["name"], spec["description"], schema, lambda _name=spec["name"], **args: turn.read_live(_name, **args)))
    for spec in (live_agent.LISTEN_SPEC, live_agent.LOOK_SPEC):
        schema = copy.deepcopy(spec["parameters"])
        schema["properties"]["live"] = _LIVE
        out.append(_tool(spec["name"], spec["description"], schema, lambda _name=spec["name"], **args: turn.sense(_name, **args)))
    return out


def build(turn: Turn) -> list[StructuredTool]:
    """Every tool of the assistant, for this request."""
    return [
        *_reading(turn),
        _tool(
            "find_moments",
            "Have a live searched for the moments that match a request, by meaning (what happens, how people sound, what is said in other words): a search of its own "
            "that reads, listens and checks, 20 seconds or so and a fraction of a cent. Use it for anything that is not a plain word to look up. "
            "Answers passages, each with an id (p1, p2...) to name it by afterwards (`add_passages`, `show`).",
            _schema({"question": {"type": "string", "description": "What to find, as the streamer says it"}, "live": _LIVE}, ["question"]),
            turn.find_moments,
        ),
        _tool(
            "find_video_ideas",
            "Have a live looked through for the videos worth making from it: compilations (what comes back in the live) and sequences (a stretch in a row to retell). "
            "Half a minute and about a cent the first time, free afterwards. Each idea has a title, a pitch, a score (0-100), its moments, the request to build it from "
            "(`brief`) and, when the app kept it, a `video` id to build or to show it by.",
            _schema({"live": _LIVE}),
            turn.find_video_ideas,
        ),
        _tool("list_lives", "The streamer's lives, the newest first: number, title, date, game, length, analysed or not, and what they hold when the app says so.", _schema(), turn.list_lives),
        _tool(
            "list_clips",
            "The clips the analysis cut from a live (about twenty): file, name, score (0-100), when in the live, length, what is seen, tags, and whether the streamer kept it, passed it, or neither.",
            _schema({"live": _LIVE}),
            turn.list_clips,
        ),
        _tool(
            "list_videos",
            "The videos made or proposed: id, name, source (clip, sequence, compilation), length, passages, state (idea: proposed by the AI, not built; draft; exported). "
            "Without `live`: those of every live.",
            _schema({"live": {"type": "string", "description": "A live's number, to have its videos only"}}),
            turn.list_videos,
        ),
        _tool(
            "get_video",
            "One video in full: its parts, each passage (id, times, what is said) and its look. A passage marked `imported` is a video of the streamer's own "
            "(an outro, a meme), not a moment of a live: it has no hour, and it stays where it is when the video is changed. "
            "A passage also says what was set by hand on it: `effects` (once the look's effects are \"custom\"; change them with `edit_effects`) "
            "and `music_percent` (`set_music_levels`).",
            _schema({"video": _VIDEO, "live": _LIVE}),
            turn.get_video,
        ),
        _tool(
            "list_imported_videos",
            "The streamer's media library: short videos of their own (an outro, a meme, something filmed on a phone) that any video can take as a passage. "
            "Each: id, name, seconds, upright (filmed upright), spoken (somebody speaks in it).",
            _schema({}),
            turn.list_imported_videos,
        ),
        _tool(
            "keep_clip",
            "Sort a clip of the analysis as the streamer would: kept (it becomes a video to edit and export), passed, or none (neither).",
            _schema({"clip": {"type": "string", "description": "The clip's file. Left out: the clip on screen."}, "state": {"type": "string", "enum": list(CLIP_STATES)}, "live": _LIVE}, ["state"]),
            turn.keep_clip,
        ),
        _tool(
            "analyse_live",
            f"Have a live analysed (about {ANALYSIS_COST:.2f} $ of the streamer's credits, twenty minutes or so): it asks the streamer first, by itself, and only launches when they agree. "
            "Answers whether it started.",
            _schema({"live": {"type": "string", "description": "The live's number in the list of lives, or its address on Twitch"}}, ["live"]),
            turn.analyse_live,
        ),
        _tool(
            "ask_approval",
            "Ask the streamer before anything that costs more than a few cents or can't be undone. Answers {approved}. A no is final for this request.",
            _schema({"what": {"type": "string", "description": "What you are about to do, in their language"}, "detail": {"type": "string"}, "cost": {"type": "number", "description": "Dollars"}}, ["what"]),
            turn.ask_approval,
        ),
        _tool(
            "open",
            "Take the streamer to a page of the app: a live's page (\"live\": its clips, sequences and compilations to choose from, `clip` or `video` to select one), "
            "the editor (\"edit\", with `video`), a live's exports (\"export\"), every video (\"videos\"), every live (\"lives\").",
            _schema({"page": {"type": "string", "enum": list(PAGES)}, "live": _LIVE, "video": {"type": "string"}, "clip": {"type": "string", "description": "A clip's file"}}, ["page"]),
            turn.open,
        ),
        _tool(
            "build_video",
            "Have a video built from a live (the app's editor does it: about 0.04 $ and half a minute): a clip (one moment of 30 to 75 s), a sequence (a stretch in a row retold in 45 to 90 s) "
            "or a compilation (moments from all over). Give `idea` to build a video the AI proposed, else `brief`: the request as the streamer would type it (what the video shows, "
            "what it opens and ends on; a time of the live when they gave one). Only when the streamer asked for that video.",
            _schema(
                {
                    "source": {"type": "string", "enum": list(SOURCES)},
                    "brief": {"type": "string"},
                    "target": {"type": "number", "description": "The video's length, seconds"},
                    "live": _LIVE,
                    "idea": {"type": "string", "description": "The id of a proposed video to build"},
                    "leads": {"type": "array", "items": {"type": "string"}, "description": "Moments already spotted for it (H:MM:SS)"},
                },
                ["source"],
            ),
            turn.build_video,
        ),
        _tool(
            "change_video",
            "Have a video changed as the streamer asks, when it is about what the video holds or tells (add the moments where..., tighter cuts, another order, take that out): "
            "about 0.02 $. Pass their request as it is. To add passages you already found, `add_passages` is free; for how it looks or sounds, `set_look`.",
            _schema({"request": {"type": "string"}, "video": _VIDEO, "live": _LIVE}, ["request"]),
            turn.change_video,
        ),
        _tool(
            "add_passages",
            "Add passages to a video, at the end of one of its parts (the last one unless `part` names another by its title; a title no part has makes a new part).",
            _schema({"passages": {"type": "array", "items": _PASSAGE}, "video": _VIDEO, "live": _LIVE, "part": {"type": "string"}}, ["passages"]),
            turn.add_passages,
        ),
        _tool(
            "add_imported_videos",
            "Add videos of the streamer's media library to a video, whole, at the end of one of its parts (the last one unless `part` names another by its title; "
            "a title no part has makes a new part). Free. Name each by its id or its name; the app answers what it added, and what it has no such video for (with those there are).",
            _schema({"videos": {"type": "array", "items": {"type": "string", "description": "An imported video's id or name"}}, "video": _VIDEO, "live": _LIVE, "part": {"type": "string"}}, ["videos"]),
            turn.add_imported_videos,
        ),
        _tool(
            "cut_clip",
            "Have a clip cut down to what is worth keeping (the setup kept short, the payoff kept whole): the clip on screen unless `clip` or `video` names another. "
            "Less than a cent. `target`: the length to aim for.",
            _schema({"live": _LIVE, "clip": {"type": "string", "description": "The clip's file"}, "video": {"type": "string", "description": "The video made of a clip"}, "target": {"type": "number", "description": "Seconds"}}),
            turn.cut_clip,
        ),
        _tool(
            "set_look",
            "Change how a video looks or sounds. `look` holds only what changes: universe (the look of a game, or \"channel\"), template (the layout), title_style, "
            f"effects ({' | '.join(EFFECTS)}: how much the picture moves by itself; for one effect at a precise place, `edit_effects`), transition, opening ({' | '.join(OPENINGS)}), "
            f"intro (its style), music (a track's name, or \"none\"), presence (how loud the music is), chat ({' | '.join(CHAT)}: the Twitch chat written on the video). "
            "Name things as the streamer does or by the app's ids; for a music described rather than named (« something calmer »), ask for any name: "
            "the app answers the tracks there are with what each is, then choose one. The app answers what it set, and what it has no such thing for (`unknown`, with what there is).",
            _schema({"look": {"type": "object", "properties": {key: {"type": "string"} for key in LOOK_KEYS}}, "video": _VIDEO, "live": _LIVE}, ["look"]),
            turn.set_look,
        ),
        _tool(
            "edit_effects",
            "The effects of a video, one by one: what moves or changes its picture at a precise moment. Called with nothing, it lists them (each with its id). "
            f"`add`: put some down, each {{passage: the passage's id (get_video), at: seconds from that passage's start, kind: {' | '.join(EFFECT_KINDS)}}} "
            "(cam: the webcam comes closer, on the face; zoom: the whole picture comes closer; slow: a slow close-up; shake: a short tremor; pulse: a bounce; flash: a white flash; gray: black and white for a moment), "
            f"with if wanted `seconds` (how long), `sharp` (true: cut in and out instead of smoothly; cam, zoom, slow) and `strength` ({' | '.join(STRENGTHS)}). "
            "`change`: the same fields for effects named by `id`. `remove`: ids to take out. `clear`: take them all out. "
            "The first change makes the video's effects its own (« à la main »): what the app had placed is kept, then changed. Keep them rare: one every ten seconds at most reads well. "
            "The app answers the effects as they are now, and what it refused.",
            _schema(
                {
                    "add": {"type": "array", "items": {"type": "object", "properties": {"passage": {"type": "string"}, "at": {"type": "number"}, "kind": {"type": "string"}, "seconds": {"type": "number"}, "sharp": {"type": "boolean"}, "strength": {"type": "string"}}, "required": ["passage", "at", "kind"]}},
                    "change": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "at": {"type": "number"}, "kind": {"type": "string"}, "seconds": {"type": "number"}, "sharp": {"type": "boolean"}, "strength": {"type": "string"}}, "required": ["id"]}},
                    "remove": {"type": "array", "items": {"type": "string"}},
                    "clear": {"type": "boolean"},
                    "video": _VIDEO,
                    "live": _LIVE,
                }
            ),
            turn.edit_effects,
        ),
        _tool(
            "set_music_levels",
            "How loud the music plays under passages of a video: `levels` is a list of {passage: its id (get_video), percent: 0 to 100, or null to give that passage back to the app, which keeps the music low where people talk}. "
            "For the whole video at once, `set_look` with `presence`.",
            _schema({"levels": {"type": "array", "items": {"type": "object", "properties": {"passage": {"type": "string"}, "percent": {"type": ["number", "null"]}}, "required": ["passage"]}}, "video": _VIDEO, "live": _LIVE}, ["levels"]),
            turn.set_music_levels,
        ),
        _tool(
            "export_videos",
            "Have videos exported (free; a few minutes each, one after the other). Left out: the video the streamer has open.",
            _schema({"videos": {"type": "array", "items": {"type": "object", "properties": {"live": _LIVE, "id": {"type": "string"}}, "required": ["id"]}}}),
            turn.export_videos,
        ),
        _tool(
            "show",
            "Show things in your reply instead of listing them: passages (the streamer can hear each and add it), videos, clips or lives (each opens on a click). "
            "Passages by their ids; videos as {live, id}; clips as {live, filename}; lives by their numbers.",
            _schema({"kind": {"type": "string", "enum": list(SHOWN)}, "items": {"type": "array", "items": {}}}, ["kind", "items"]),
            turn.show,
        ),
    ]
