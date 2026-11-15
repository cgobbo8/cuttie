"""What an AI searching a live can do, one small tool at a time: look for words
said or written in the chat, for sounds, for loud or quiet moments, for the
chat's bursts and the moments the analysis rated the best, read what is said
somewhere, see what is heard there. Each tool answers little and
exactly (times as H:MM:SS), so a cheap model can call many of them, check what
it found and only then answer, instead of guessing from one long read.

Also a command line, to try the tools by hand:
    python -m app.services.live_tools <job id> <tool> '<json arguments>'
"""

import copy
import json
import logging
import sys

from app.services import live_search, sound_index
from app.services.presort import hms, parse_hms
from app.services.vod_transcript import VodTranscript, load_cached

logger = logging.getLogger(__name__)

MAX_HITS = 40
MAX_READ_SECONDS = 240.0
# The moments the first analysis rated, as many as it had an AI watch
MAX_BEST = 50
SOUND_KINDS = [g for g in sound_index.GROUPS if g != "speech"]
LOUD_KINDS = ["raised_voices", "loudest", "quiet"]

# What the tools are, as a model is told (OpenAI-style function calling)
SPECS: list[dict] = [
    {
        "name": "overview",
        "description": "What this live is: title, game, length, a summary of what happens and its phases. Call it first.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "best_moments",
        "description": f"The {MAX_BEST} moments the first analysis rated the best in the whole live (it weighed the sound and the chat, then an AI watched and "
        "listened to each one), the best first: time, score (0-100), kind, name, what happens when it is known, and whether a clip of it exists. "
        "Use it for requests about the best, funniest or strongest moments, and to learn what happens in the live besides what is said: "
        "a fight, a fail, a chase are named here even when nobody says the word.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "search_speech",
        "description": "Every time ALL the given words are said close together (accents, plurals and case ignored; hollow words like 'le', 'c'est' are dropped). "
        "One call per wording: try synonyms and other ways people would say it in separate calls. Answers each line where it is said: its time, "
        "how many seconds it takes to say, its words.",
        "parameters": {"type": "object", "properties": {"words": {"type": "string", "description": "1 to 4 words, e.g. 'calme' or 'brigade tigre'"}}, "required": ["words"]},
    },
    {
        "name": "search_chat",
        "description": "Moments when viewers write ALL the given words in the chat (times already moved back onto the stream).",
        "parameters": {"type": "object", "properties": {"words": {"type": "string"}}, "required": ["words"]},
    },
    {
        "name": "chat_peaks",
        "description": "The moments when the chat reacts the most: bursts of messages well above its usual pace (times already moved back onto the stream), "
        "the strongest first, with how many viewers wrote, some of their messages and what was said then. Use it for requests about the chat's reactions, "
        "and as a sign that something happened: `read` there to see what.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "find_sounds",
        "description": "The strongest moments of a kind of sound in the live, from a sound classifier. It finds where to look but it misfires "
        "(an engine can read as gunfire, a tiger as a scream): always check a moment with `read` before keeping it. Kinds: " + ", ".join(SOUND_KINDS) + ".",
        "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": SOUND_KINDS}}, "required": ["kind"]},
    },
    {
        "name": "loud_moments",
        "description": "Moments that stand out by their loudness: 'raised_voices' (people speaking much louder than usual: shouting, anger, excitement), "
        "'loudest' (the loudest moments whatever makes the noise), 'quiet' (nobody speaks for a while).",
        "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": LOUD_KINDS}}, "required": ["kind"]},
    },
    {
        "name": "read",
        "description": "Everything said between two times (at most 4 minutes), one line per sentence: \"[its time] (the seconds it takes to say) its words\"; "
        "then the chat's messages there, and what is heard (sounds, loudness). Use it to check a moment and to pick the lines to keep: "
        "a moment is given by the time of its first line and the time of its last one.",
        "parameters": {
            "type": "object",
            "properties": {"start": {"type": "string", "description": "H:MM:SS"}, "end": {"type": "string", "description": "H:MM:SS"}},
            "required": ["start", "end"],
        },
    },
]

# For the AI that looks for videos to propose (live_ideas.py), not for a search: what is said again and again
RECURRING_SPEC: dict = {
    "name": "recurring",
    "description": "The words and phrases that come back in this live, the most telling first: said on many lines and, when the streamer has other lives "
    "to compare with, much more often than in those (`more_than_usual`). Each with how many times, when it is first and last said and a few of the times. "
    "A running joke, a catchphrase, a complaint, a name everyone repeats show here; so do plain words of the game, which mean nothing: "
    "`search_speech` lists every time one is said, `read` shows what it is about.",
    "parameters": {"type": "object", "properties": {}},
}


def _seconds(value, fallback: float = 0.0) -> float:
    parsed = parse_hms(value) if not isinstance(value, (int, float)) else float(value)
    return fallback if parsed is None else max(0.0, parsed)


def _short(text: str, limit: int = 140) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


def _said(transcript: VodTranscript | None, start: float, end: float, limit: int = 140) -> str:
    if not transcript:
        return ""
    return _short(" ".join(t.strip() for s, e, t in transcript.segments if e > start and s < end), limit)


class LiveTools:
    """The tools over one live. What they read (transcript, chat, sounds) is loaded once."""

    def __init__(self, job_id: str, duration: float = 0.0, chat_lag: float = 5.0, moments: list[dict] | None = None, date: str | None = None) -> None:
        """`moments`: every candidate the analysis rated, as the app keeps them ({"t", "state", "score", "name",
        "category", "what"}); without them, only the moments it clipped are known."""
        self.job_id = job_id
        self.moments = moments or []
        # When it was streamed (told apart from the other lives when several are searched at once)
        self.date = date
        self.transcript = load_cached(job_id)
        self.chat = live_search.read_chat(job_id)
        self.sounds = sound_index.load(job_id)
        self.duration = duration or (self.transcript.segments[-1][1] if self.transcript else 0.0)
        self.chat_lag = chat_lag
        # What comes back in the live, once counted (see tool_recurring)
        self._recurring: tuple[list[dict], int] | None = None

    def specs(self) -> list[dict]:
        """The tools this live can answer (no sound tools when it was never listened to)."""
        return [s for s in SPECS if self.sounds or s["name"] not in ("find_sounds", "loud_moments")]

    def call(self, name: str, args: dict) -> dict:
        tool = getattr(self, f"tool_{name}", None)
        if not tool:
            return {"error": f"unknown tool {name}"}
        try:
            return tool(**(args or {}))
        except TypeError as e:
            return {"error": f"bad arguments for {name}: {e}"}

    def tool_overview(self) -> dict:
        from app.services.db import get_job

        job = get_job(self.job_id)
        context = job.vod_context if job else None
        return {
            "title": job.vod_title if job else None,
            **({"streamed_on": self.date} if self.date else {}),
            "game": job.vod_game if job else None,
            "streamer": job.streamer if job else None,
            "length": hms(self.duration),
            "summary": context.summary if context else None,
            "phases": [{"from": p.start, "to": p.end, "what": p.description} for p in (context.phases if context else [])],
            "can_search": {"speech": bool(self.transcript), "chat_messages": len(self.chat), "sounds": bool(self.sounds)},
            "see_also": "best_moments: what happens in the moments the first analysis rated the best",
        }

    def tool_best_moments(self) -> dict:
        from app.services.db import get_job

        job = get_job(self.job_id)
        # What the worker kept: the moments it clipped, with what the AI saw in each
        clipped = {round(float(hp.timestamp_seconds)): hp for hp in ((job.hot_points or []) if job else [])}

        def near(t: float):
            return next((clipped[k] for k in (round(t), round(t) - 1, round(t) + 1) if k in clipped), None)

        rows: list[tuple[float, float, dict]] = []
        known: set[int] = set()
        for moment in self.moments:
            try:
                t = float(moment["t"])
            except (KeyError, TypeError, ValueError):
                continue
            # Rated by the analysis: kept as a clip, dropped after being watched, or asked for on the stream
            if moment.get("state") not in ("kept", "dropped", "clip", "rated"):
                continue
            hp = near(t)
            if hp is not None:
                known.add(round(float(hp.timestamp_seconds)))
            score = moment.get("score", hp.final_score if hp is not None else None)
            what = moment.get("what") or (hp.llm.summary if hp is not None and hp.llm else "")
            rows.append((float(score or 0.0), t, {
                "at": hms(t),
                "score": round(100 * float(score)) if score is not None else None,
                "kind": moment.get("category") or (hp.llm.category if hp is not None and hp.llm else None),
                "name": moment.get("name") or (hp.clip_name if hp is not None else None),
                **({"what": _short(str(what), 90)} if what else {}),
                "clip": moment.get("state") in ("kept", "clip") or bool(hp is not None and hp.clip_filename),
                **({"asked_for_on_stream": True} if moment.get("state") == "clip" else {}),
            }))
        for key, hp in clipped.items():
            if key in known:
                continue
            score = hp.final_score if hp.final_score is not None else hp.score
            rows.append((float(score or 0.0), float(hp.timestamp_seconds), {
                "at": hms(hp.timestamp_seconds),
                "score": round(100 * float(score)) if score is not None else None,
                "kind": hp.llm.category if hp.llm else None,
                "name": hp.clip_name,
                **({"what": _short(hp.llm.summary, 90)} if hp.llm and hp.llm.summary else {}),
                "clip": bool(hp.clip_filename),
            }))
        rows.sort(key=lambda r: (-r[0], r[1]))
        return {"found": len(rows), "moments": [row for _score, _t, row in rows[:MAX_BEST]]}

    def tool_recurring(self) -> dict:
        from app.services import live_ideas

        if not self.transcript:
            return {"error": "this live has no transcript"}
        # Counted once: the model asks, then its ideas are checked against the same list
        if self._recurring is None:
            others = live_ideas._other_lives(self.job_id)
            self._recurring = (live_ideas.recurring(self.transcript, others), len(others))
        phrases, compared = self._recurring
        others = [None] * compared
        return {
            "found": len(phrases),
            "compared_with": f"{len(others)} other live(s) of the streamer" if others else "nothing (no other live to compare with: plain words of the game show too)",
            "phrases": phrases,
        }

    def tool_chat_peaks(self) -> dict:
        peaks = live_search.chat_peaks(self.chat, self.chat_lag, self.duration)
        if not peaks:
            return {"found": 0, "note": "the chat never wrote much at once in this live"}
        return {
            "found": len(peaks),
            "usually": f"about {peaks[0]['usual']} messages in {live_search.BURST_SECONDS:.0f} seconds",
            "moments": [
                {
                    "at": hms(p["start"]),
                    "seconds": round(p["end"] - p["start"]),
                    "messages": p["messages"],
                    "viewers": p["viewers"],
                    "wrote": p["lines"],
                    **({"viewers_ask_for_a_clip": True} if p["clip_requests"] else {}),
                    "said_then": _said(self.transcript, p["start"], p["end"], 100),
                }
                for p in peaks
            ],
        }

    def spoken(self, first, last, live=None) -> float:
        """How long the lines from the one stamped `first` to the one stamped `last` take to say: what a
        moment given by its lines lasts once cut on its words. Nobody speaks there: the time between the two."""
        lines = live_search._lines_between(self.transcript, first, last) if self.transcript else []
        if lines:
            return sum(live_search.spoken_seconds(self.transcript, *line) for line in lines)
        a, b = parse_hms(first), parse_hms(last)
        return max(live_search.SOUND_SECONDS, (b if b is not None else a) - a) if a is not None else 0.0

    def tool_search_speech(self, words: str) -> dict:
        if not self.transcript:
            return {"error": "this live has no transcript"}
        hits = live_search.search_voice(self.transcript, live_search.query_terms(words))
        moments = []
        for h in hits[:MAX_HITS]:
            # The lines that say it, as `read` shows them: a moment is given by their times
            lines = [(s, e, t) for s, e, t in self.transcript.segments if e > h.start + 0.01 and s < h.end - 0.01 and t.strip()]
            first = lines[0][0] if lines else h.start
            moment = {
                "at": live_search.stamp(first),
                "seconds": round(sum(live_search.spoken_seconds(self.transcript, *line) for line in lines) if lines else h.end - h.start, 1),
                "said": _short(h.text, 160),
            }
            if len(lines) > 1:
                moment["last_line_at"] = live_search.stamp(lines[-1][0])
            moments.append(moment)
        return {"found": len(hits), "moments": moments}

    def tool_search_chat(self, words: str) -> dict:
        hits = live_search.search_chat(self.chat, live_search.query_terms(words), self.chat_lag, self.duration)
        return {
            "found": len(hits),
            "moments": [{"at": hms(h.start), "messages": h.chat[:4], "said_then": _said(self.transcript, h.start, h.end, 100)} for h in hits[:MAX_HITS]],
        }

    def tool_find_sounds(self, kind: str) -> dict:
        if not self.sounds:
            return {"error": "this live's sounds were not analysed"}
        if kind not in SOUND_KINDS:
            # A model sometimes makes a kind up ("anger"): told what exists, it picks one that does
            return {"error": f"no such kind of sound: {kind}. The kinds are: {', '.join(SOUND_KINDS)}. For how people sound (angry, excited), use loud_moments then listen."}
        peaks = self.sounds.peaks(kind)
        return {
            "found": len(peaks),
            "moments": [
                {"at": p["at"], "seconds": p["seconds"], "sure": p["score"], "said_then": _said(self.transcript, p["time"] - 3, p["time"] + p["seconds"] + 3, 90)}
                for p in peaks
            ],
        }

    def tool_loud_moments(self, kind: str) -> dict:
        if not self.sounds:
            return {"error": "this live's sounds were not analysed"}
        if kind not in LOUD_KINDS:
            return {"error": f"no such kind: {kind}. The kinds are: {', '.join(LOUD_KINDS)}."}
        if kind == "quiet":
            runs = self.sounds.quiet()
            return {"found": len(runs), "moments": [{"at": hms(r["time"]), "seconds": r["seconds"]} for r in runs]}
        peaks = self.sounds.raised_voices() if kind == "raised_voices" else self.sounds.loudest()
        return {
            "found": len(peaks),
            "moments": [
                {"at": p["at"], "seconds": p["seconds"], "louder_by_db": p["over_db"], "said_then": _said(self.transcript, p["time"] - 2, p["time"] + p["seconds"] + 2, 90)}
                for p in peaks
            ],
        }

    def tool_read(self, start, end) -> dict:
        a = _seconds(start)
        b = min(_seconds(end, a + 30.0), a + MAX_READ_SECONDS)
        if b <= a:
            b = a + 30.0
        lines = [
            f"[{live_search.stamp(s)}] ({live_search.spoken_seconds(self.transcript, s, e, t):.1f} s) {t.strip()}"
            for s, e, t in (self.transcript.segments if self.transcript else [])
            if e > a and s < b and t.strip()
        ]
        chat = [
            f"[{hms(float(m.get('timestamp', 0)) - self.chat_lag)}] {m.get('author', '')}: {str(m.get('text', ''))[:100]}"
            for m in self.chat
            if a <= float(m.get("timestamp", 0)) - self.chat_lag <= b
        ]
        return {
            "from": hms(a),
            "to": hms(b),
            "said": lines or ["(nobody speaks)"],
            "chat": chat[:25],
            **({"heard": self.sounds.heard(a, b)} if self.sounds else {}),
        }



class ManyLives:
    """The tools over several lives at once. Every tool says which live it is about (`live`: 1, 2...)
    and answers with that number; times are each live's own. `overview` without `live` lists them."""

    def __init__(self, lives: list[LiveTools]) -> None:
        self.lives = lives

    def of(self, live) -> tuple[int, LiveTools] | None:
        """The live a model named, with its number (None when it named none of them)."""
        try:
            n = int(live)
        except (TypeError, ValueError):
            return None
        return (n, self.lives[n - 1]) if 1 <= n <= len(self.lives) else None

    def specs(self) -> list[dict]:
        own = {s["name"] for tools in self.lives for s in tools.specs()}
        specs = []
        for spec in SPECS:
            if spec["name"] not in own:
                continue
            spec = copy.deepcopy(spec)
            spec["parameters"].setdefault("properties", {})["live"] = {"type": "integer", "description": f"Which live: 1 to {len(self.lives)}"}
            if spec["name"] == "overview":
                spec["description"] = (
                    "Without `live`: the lives you work on, each with its number, title, date, game, length and a summary of what happens. "
                    "With `live`: that one in full, with its phases. Call it first, without `live`."
                )
            else:
                spec["parameters"]["required"] = ["live", *spec["parameters"].get("required", [])]
            specs.append(spec)
        return specs

    def call(self, name: str, args: dict) -> dict:
        args = dict(args or {})
        live = args.pop("live", None)
        if name == "overview" and live in (None, "", 0):
            return {
                "lives": [{"live": n + 1, **{k: v for k, v in tools.tool_overview().items() if k not in ("phases", "see_also")}} for n, tools in enumerate(self.lives)],
                "next": "`overview` with `live` gives a live's phases; every other tool takes `live`, and its times are that live's own",
            }
        picked = self.of(live)
        if not picked:
            return {"error": f"`live` must be a number from 1 to {len(self.lives)}"}
        result = picked[1].call(name, args)
        return {"live": picked[0], **result} if isinstance(result, dict) else result

    def spoken(self, first, last, live=None) -> float:
        picked = self.of(live if live is not None else 1)
        return picked[1].spoken(first, last) if picked else 0.0


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(__doc__)
        print("Tools:", ", ".join(s["name"] for s in SPECS))
        return 2
    job_id, name = argv[1], argv[2]
    args = json.loads(argv[3]) if len(argv) > 3 else {}
    print(json.dumps(LiveTools(job_id).call(name, args), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    sys.exit(main(sys.argv))
