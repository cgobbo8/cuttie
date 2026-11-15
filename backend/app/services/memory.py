"""What the AI remembers of the streamer from one live to the next.

The notes (notes.py) are what the streamer wrote for the AI. The memory is what the AI
writes for itself: after each analysis it reads the whole live, notes what happened in it
(what was played, with whom, a fight, someone met for the first time, a change of game),
then rewrites what it knows of the streamer so that it is true after that live. The more
lives it has read, the better it knows them. The streamer reads it in the app (« Ma chaîne »,
« Mémoire ») and may correct it, but it is the AI's to keep.

    <data dir>/memory/memory.json         the memory: five sections of short lines
    <data dir>/memory/lives/<job>.json    what was noted of each live read (a live is read once)

Two calls to a small model per live (about a cent in all): one reads the transcript and
gives the live's entry, one rewrites the memory from that entry. The second also compares
the streamer's notes with what the lives show, and proposes a correction for a sentence that
is clearly no longer true (the app asks the streamer, who applies it or not).

What the streamer says of their tastes while changing a video (« I don't like it when you... »)
is noted too, without a call of its own (`remember`, fed by the plan's answer).

The memory is given to the AI wherever the notes are (`block`), after them: the notes win
when the two disagree. It is not part of what an answer kept on disk is filed under: it
changes after every analysis, and would throw every kept answer away each time.
"""

import difflib
import hashlib
import json
import logging
import os
import re
import threading
import unicodedata
from datetime import datetime, timezone

from app.services import llm_text, notes, paths

logger = logging.getLogger(__name__)

# The sections of the memory, and how long each may get (characters)
SECTIONS = ("who", "games", "people", "stories", "tastes")
LIMITS = {"who": 900, "games": 900, "people": 2200, "stories": 2200, "tastes": 1500}
# What each holds, as the model is told
_HOLDS = {
    "who": "who the streamer is: how they stream, their manner and humour, their habits (days, hours), what their community is like. "
    "Nothing that is only true for a day (the next live they announce, how tonight went)",
    "games": "what they play: each game with since when, what they stopped playing and when, and for a role-play game the server and "
    "their character(s) with their job. No events here",
    "people": "the people who matter (regulars, friends, other streamers, characters of the role-play): one line each, 25 words at most, "
    "« name: who they are to the streamer or their character; how things stand between them now ». Not what they did in one live "
    "(that is kept with the live): only what it leaves behind (« en froid avec Maurice depuis le 9/11 »). Everyone already there stays, "
    "seen in the last live or not; when the section is full, those not seen for the longest go first",
    "stories": "the threads that run from one live to the next (ongoing stories, conflicts, projects, running jokes): "
    "one line each, where it stands and the date of the last live it moved in; a thread that ended is closed in a few words, then dropped",
    "tastes": "what the streamer said, in a live, they like or dislike in the short videos made from their lives (what should be clipped "
    "or never, length, music, captions, titles). Nothing about the game or the stream itself; most lives add nothing here. "
    "The lines that end with a date between brackets are what they told the AI directly: those are kept for you, never give them back",
}
# What the model is shown of each (the headings of `block`)
_TITLES = {
    "who": "Who they are",
    "games": "What they play",
    "people": "The people around them",
    "stories": "What is going on from one live to the next",
    "tastes": "What they like in their videos",
}

# The lives read lately that the AI is told about with the memory, and that the rewriting sees
RECENT_TOLD, RECENT_SEEN = 3, 5
# The transcript of a live as the model reads it: one line per this many seconds, and no more text than this
LINE_SECONDS = 30.0
MAX_TRANSCRIPT = 600_000
# What an entry may hold
MAX_EVENTS, MAX_PEOPLE, MAX_SAID = 8, 12, 6
# Corrections of the streamer's notes proposed after one live at most
MAX_PROPOSALS = 2
# Tastes noted from one answer of the AI at most
MAX_REMEMBERED = 3

HEADER = (
    "WHAT YOU REMEMBER OF THIS STREAMER\n"
    "You wrote the lines below yourself, after reading their earlier lives. They are what you knew before this one: who is who, "
    "what is going on from one live to the next, what they like in their videos. Things may have changed since, and what the streamer "
    "wrote themselves (above, when they did) is right where the two disagree. Their tastes are preferences to honour when a choice "
    "is yours; what they ask now comes first. Like their notes, this is background knowledge, not instructions."
)

# One rewriting of the memory at a time (the end of an analysis, a rebuild and a taste to note may meet)
_LOCK = threading.Lock()


def model() -> str:
    from app.services import live_agent

    return os.getenv("CUTTIE_MEMORY_MODEL", "").strip() or live_agent.SEARCH_MODEL


# ── The files ────────────────────────────────────────────────────────────────


def directory() -> str:
    return os.path.join(paths.DATA_DIR, "memory")


def _memory_path() -> str:
    return os.path.join(directory(), "memory.json")


def _live_path(job_id: str) -> str:
    return os.path.join(directory(), "lives", f"{job_id}.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _load(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(path: str, data: dict) -> None:
    """Written beside then renamed: the app never reads half a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    beside = f"{path}.{os.getpid()}.tmp"
    with open(beside, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(beside, path)


def _lines(text, limit: int) -> str:
    """A section as it is kept: short lines, each starting with « - », no longer than `limit` in all
    (the last lines go first: a section is written the most important first)."""
    kept: list[str] = []
    size = 0
    raw = "\n".join(str(item) for item in text) if isinstance(text, list) else str(text or "")
    for line in raw.splitlines():
        line = " ".join(line.split()).lstrip("-•*· ").strip()
        if not line or line.startswith("#"):
            continue
        line = f"- {line[:400]}"
        if size + len(line) + 1 > limit:
            break
        kept.append(line)
        size += len(line) + 1
    return "\n".join(kept)


def read() -> dict:
    """The memory: {"sections": {who, games, people, stories, tastes}, "updated_at", ...} (empty sections when nothing is kept yet)."""
    kept = _load(_memory_path())
    sections = kept.get("sections") if isinstance(kept.get("sections"), dict) else {}
    return {**kept, "sections": {key: str(sections.get(key) or "").strip() for key in SECTIONS}, "updated_at": kept.get("updated_at") or None}


def is_empty() -> bool:
    return not any(read()["sections"].values())


def entry(job_id: str) -> dict | None:
    """What was noted of this live, when it was read."""
    found = _load(_live_path(job_id))
    return found if found.get("summary") else None


def entries() -> list[dict]:
    """Every live read, the latest first (by the day of the live)."""
    folder = os.path.join(directory(), "lives")
    try:
        names = [name for name in os.listdir(folder) if name.endswith(".json")]
    except OSError:
        return []
    found = [e for e in (_load(os.path.join(folder, name)) for name in names) if e.get("summary")]
    found.sort(key=lambda e: (str(e.get("date") or ""), str(e.get("read_at") or "")), reverse=True)
    return found


# ── What the AI is told ──────────────────────────────────────────────────────


def _told(e: dict, events: int = 0) -> str:
    head = " · ".join(part for part in (str(e.get("date") or ""), str(e.get("title") or ""), str(e.get("game") or "")) if part)
    more = "".join(f"\n  · {event}" for event in (e.get("events") or [])[:events])
    return f"- {head}: {e.get('summary')}{more}"


def block(recent: int = RECENT_TOLD) -> str:
    """The memory as the AI is given it, after the streamer's notes; empty when it holds nothing."""
    sections = read()["sections"]
    lives = entries()[:recent]
    if not any(sections.values()) and not lives:
        return ""
    parts = [f"## {_TITLES[key]}\n{sections[key]}" for key in SECTIONS if sections[key]]
    if lives:
        parts.append("## Their latest lives\n" + "\n".join(_told(e) for e in lives))
    return "\n\n" + HEADER + "\n\n" + "\n\n".join(parts)


def tastes() -> str:
    """What the streamer said they like in their videos (lines), for the choices made for them."""
    return read()["sections"]["tastes"]


# ── Tastes said to the AI ────────────────────────────────────────────────────


# A taste the streamer told the AI is kept with the day it was said: « - ... (15/11/2026) »
_TOLD = re.compile(r"\(\d{1,2}/\d{1,2}/\d{4}\)\s*$")


def _plain(line: str) -> str:
    line = _TOLD.sub("", line.lstrip("- "))
    line = unicodedata.normalize("NFKD", line.lower())
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", "".join(c for c in line if not unicodedata.combining(c))).split())


def remember(said, when: datetime | None = None) -> list[str]:
    """Notes what the streamer said of their tastes while talking to the AI (a few short sentences, the AI's
    words for it). Returns the ones that were new; what is already noted, or nearly, is not noted twice."""
    wanted: list[str] = []
    for raw in said if isinstance(said, list) else []:
        line = " ".join(str(raw).split()).lstrip("-•*· ").strip()[:220]
        if len(line) >= 8 and line not in wanted:
            wanted.append(line)
    if not wanted:
        return []
    day = (when or datetime.now()).strftime("%d/%m/%Y")
    with _LOCK:
        kept = read()
        lines = [line for line in kept["sections"]["tastes"].splitlines() if line.strip()]
        known = [_plain(line) for line in lines]
        new: list[str] = []
        for line in wanted[:MAX_REMEMBERED]:
            plain = _plain(line)
            if not plain or any(plain == other or difflib.SequenceMatcher(None, plain, other).ratio() > 0.85 for other in known):
                continue
            lines.append(f"- {line} ({day})")
            known.append(plain)
            new.append(line)
        if not new:
            return []
        # Too many to keep them all: the oldest go (the next rewriting folds them together before that)
        while len(lines) > 1 and sum(len(line) + 1 for line in lines) > LIMITS["tastes"] + 600:
            lines.pop(0)
        _save(_memory_path(), {**kept, "sections": {**kept["sections"], "tastes": "\n".join(lines)}, "updated_at": _now()})
    logger.info(f"Memory: {len(new)} taste(s) noted from what the streamer told the AI")
    return new


# ── Asking the model ─────────────────────────────────────────────────────────


def _cost(response) -> float:
    usage = getattr(response, "usage", None)
    billed = getattr(usage, "cost", None) if usage else None
    if billed is None and usage is not None and getattr(usage, "model_extra", None):
        billed = usage.model_extra.get("cost")
    return float(billed or 0.0)


def _ask(prompt: str, max_tokens: int) -> tuple[dict, float, str]:
    """The JSON a model answers to `prompt`: (answer, dollars, the model). The memory's model first, the
    search's fallback when it fails for a reason of its own; a provider that refuses for good raises ProviderUnavailable."""
    if llm_text.dev_command():
        answer = llm_text.complete(prompt, max_tokens=max_tokens)
        return llm_text.parse_json(answer.text), 0.0, "the development command"

    from app.services import live_agent
    from app.services.openai_client import get_openrouter_client
    from app.services.provider_errors import stop_if_fatal

    client = get_openrouter_client()
    failed: Exception | None = None
    for name in dict.fromkeys(m for m in (model(), live_agent.FALLBACK_MODEL) if m):
        try:
            response = client.chat.completions.create(
                model=name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=max_tokens,
                timeout=300,
                extra_body={"usage": {"include": True}, **({"reasoning": {"effort": "low"}} if name == model() else {})},
            )
            return llm_text.parse_json(response.choices[0].message.content or ""), _cost(response), name
        except Exception as e:
            stop_if_fatal(e)
            failed = e
            logger.warning(f"Memory: {name} failed ({type(e).__name__}: {e})")
    raise failed if failed else RuntimeError("no model to keep the memory with")


# ── Reading a live ───────────────────────────────────────────────────────────


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _whole(value, limit: int) -> str:
    """One line no longer than `limit`, never cut inside a word: what is too long ends on « … »
    (told to write one short sentence, a model still writes three: seen cut mid-word on a real live)."""
    line = " ".join(str(value or "").split())
    if len(line) <= limit:
        return line
    return line[:limit].rsplit(" ", 1)[0].rstrip(" ,;:([«") + "…"


def clean_entry(raw: dict) -> dict:
    """What a model noted of a live, as it is kept: bounded, nothing empty."""
    events = [_whole(event, 320) for event in raw.get("events") if _text(event, 8)] if isinstance(raw.get("events"), list) else []
    said = [_whole(line, 260) for line in raw.get("said") if _text(line, 8)] if isinstance(raw.get("said"), list) else []
    people: list[dict] = []
    for person in raw.get("people") if isinstance(raw.get("people"), list) else []:
        if not isinstance(person, dict):
            continue
        name = _text(person.get("name"), 60)
        if name and all(name.lower() != other["name"].lower() for other in people):
            people.append({"name": name, "who": _whole(person.get("who"), 200)})
    games = [_text(game, 80) for game in raw.get("games") if _text(game, 80)] if isinstance(raw.get("games"), list) else []
    return {
        "summary": _text(raw.get("summary"), 900),
        "events": events[:MAX_EVENTS],
        "people": people[:MAX_PEOPLE],
        "said": said[:MAX_SAID],
        "games": list(dict.fromkeys(games))[:4],
    }


def _context_lines(context: dict | None) -> str:
    """What the analysis understood of the live (its vod_context), as text."""
    if not isinstance(context, dict):
        return ""
    lines: list[str] = []
    for key in ("narrative", "summary"):
        if context.get(key):
            lines.append(_text(context[key], 1500))
    for key in ("phases", "protagonists", "themes", "glossary"):
        value = context.get(key)
        if isinstance(value, list) and value:
            shown = "; ".join(_text(item if isinstance(item, str) else json.dumps(item, ensure_ascii=False), 240) for item in value[:14])
            lines.append(f"{key}: {shown}")
        elif isinstance(value, str) and value.strip():
            lines.append(f"{key}: {_text(value, 1200)}")
    return "\n".join(lines)


def _transcript_lines(job_id: str) -> list[str]:
    from app.services.presort import transcript_lines
    from app.services.vod_transcript import load_cached

    transcript = load_cached(job_id)
    if not transcript:
        return []
    lines = transcript_lines(transcript, LINE_SECONDS)
    size = sum(len(line) + 1 for line in lines)
    if size > MAX_TRANSCRIPT and lines:
        # A very long live: every line is kept, each cut short
        room = max(80, MAX_TRANSCRIPT // len(lines))
        lines = [line[:room] for line in lines]
    return lines


def reading_prompt(meta: dict, hours: float, lines: list[str], chat: list[str], best: list[dict], context: str, known: str, remembered: str) -> str:
    what = (
        f"TRANSCRIPT (speech recognition of the whole live, one line per ~{LINE_SECONDS:.0f} s starting with its time; it has mistakes and no speaker names)\n"
        + "\n".join(lines)
        if lines
        else "(The transcript of this live is no longer on this machine: you only have what the analysis kept of it, below. Note less, and nothing you can't see.)"
    )
    return f"""You keep the long-term memory of an app that turns a streamer's Twitch lives into short videos. You are reading one whole live to note what is worth remembering of it later: what the streamer did, with whom, and what changed. Another step will fold your notes into the memory.

THE LIVE
Streamer: {meta.get('streamer') or '?'} · Game: {meta.get('game') or '?'} · Title: "{meta.get('title') or ''}" · Date: {meta.get('date') or '?'} · Length: {hours:.1f} h

{what}

WHEN THE CHAT REACTED
{chr(10).join(chat) if chat else '(nothing stands out)'}

THE MOMENTS THE ANALYSIS RATED THE BEST
{chr(10).join(f"[{m.get('at')}] {m.get('kind') or ''} · {m.get('name') or ''} · {m.get('what') or ''}" for m in best) or '(none)'}

WHAT THE ANALYSIS UNDERSTOOD OF THE LIVE
{context or '(nothing kept)'}{known}{remembered}

Answer with JSON only, everything in the stream's language:
{{"summary": "3 to 5 sentences: what this live was (what was played, what the streamer did, how it went, the mood)",
"events": ["up to {MAX_EVENTS}, in the order of the live: what happened that will matter later. A fight or a reconciliation with someone (name them), someone met for the first time, a decision, a plan announced, a change of game or of habit, a running joke that started, something big that happened to them or to their character. One short sentence each (30 words at most), starting with its time [H:MM:SS] when you have it"],
"people": [{{"name": "...", "who": "who they are to the streamer or to their character, and what happened with them in this live, in a few words"}}],
"said": ["up to {MAX_SAID}: what the streamer said about themselves: their tastes, their plans, their channel, their viewers, what they are tired of. Only what they really said"],
"games": ["what was played, as Twitch names it"]}}

Rules:
- Only what this live shows. Never guess, never fill: a quiet live has few events, and « people » holds only those who matter in it ({MAX_PEOPLE} at most).
- In a role-play, tell the streamer from the character they play: what happens to the character is the character's (say so), what the streamer says out of character is theirs.
- Spell names the way the streamer's notes and your memory do when the transcript gets them wrong.
- You are told what you already remember so that you can say what is new (« for the first time », « again », « since the last live »), not to copy it."""


def read_live(job_id: str, meta: dict, duration: float, moments: list[dict] | None = None, context: dict | None = None, lag: float = 5.0) -> dict:
    """Reads a whole live and notes what is worth remembering of it: its entry, kept on disk.
    Without its transcript (the folder was emptied), only from what the analysis kept: less, and cheaper."""
    from app.services.live_search import read_chat
    from app.services.live_tools import LiveTools
    from app.services.presort import chat_highlights

    lines = _transcript_lines(job_id)
    chat = chat_highlights(read_chat(job_id), lag) if lines else []
    try:
        best = LiveTools(job_id, duration, lag, moments).tool_best_moments().get("moments", [])[:30]
    except Exception as e:  # the worker's own record of the job may be gone: the API's moments are what matters
        logger.info(f"[{job_id[:8]}] Memory: best moments not listed ({type(e).__name__})")
        best = []
    told = _context_lines(context)
    if not lines and not best and not told:
        from app.services.live_search import NoTranscript

        raise NoTranscript(job_id)
    prompt = reading_prompt(meta, (duration or 0.0) / 3600.0, lines, chat, best, told, notes.block(meta.get("game")), block(recent=RECENT_SEEN))
    data, cost, by = _ask(prompt, 5000)
    noted = clean_entry(data)
    if not noted["summary"]:
        raise ValueError("the model noted nothing of the live")
    found = {
        "job": job_id,
        "title": _text(meta.get("title"), 140),
        "game": _text(meta.get("game"), 80),
        "date": _text(meta.get("date"), 20)[:10],
        "duration": round(duration or 0.0),
        **noted,
        "source": "transcript" if lines else "analysis",
        "read_at": _now(),
        "cost": round(cost, 4),
        "model": by,
    }
    _save(_live_path(job_id), found)
    logger.info(
        f"[{job_id[:8]}] Memory: live read with {by} ({'transcript' if lines else 'analysis only'}, {sum(len(line) + 1 for line in lines)} chars, "
        f"~{cost:.4f} $): {len(found['events'])} events, {len(found['people'])} people"
    )
    return found


# ── Rewriting the memory ─────────────────────────────────────────────────────


def _locate(body: str, before: str) -> str | None:
    """The words of `before` as the note really has them (spaces and line breaks may differ); None when it doesn't."""
    if before in body:
        return before
    words = before.split()
    if not words:
        return None
    found = re.search(r"\s+".join(re.escape(word) for word in words), body)
    return found.group(0) if found else None


def proposal_id(note_id: str, before: str) -> str:
    """What names a correction: the sentence it is about. Refused once, the same sentence is not brought up again."""
    return hashlib.sha1(f"{note_id}|{' '.join(before.split())}".encode("utf-8")).hexdigest()[:12]


def clean_proposals(raw, written: list[notes.Note]) -> list[dict]:
    """The corrections a model proposed for the streamer's notes, checked: about a note there is, on words it
    really holds, and that change something. The rest is dropped."""
    by_id = {note.id: note for note in written}
    kept: list[dict] = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        note = by_id.get(str(item.get("note") or "").strip().strip("[]"))
        before = str(item.get("before") or "").strip()
        after = str(item.get("after") or "").strip()[:900]
        if not note or not (8 <= len(before) <= 700) or not after:
            continue
        exact = _locate(note.body, before)
        # (the sentence given back whole with more after or before it is an addition, not a correction)
        if not exact or " ".join(exact.split()) in " ".join(after.split()):
            continue
        key = proposal_id(note.id, exact)
        if any(other["id"] == key for other in kept):
            continue
        kept.append({"id": key, "note": note.id, "note_title": note.title, "before": exact, "after": after, "why": _text(item.get("why"), 320)})
        if len(kept) >= MAX_PROPOSALS:
            break
    return kept


def consolidating_prompt(sections: dict, new: dict, earlier: list[dict], written: list[notes.Note]) -> str:
    memory = "\n\n".join(f"## {key}\n{sections[key] or '(nothing yet)'}" for key in SECTIONS)
    theirs = "\n\n".join(f"### [{note.id}] {note.title}" + (f" (only for: {', '.join(note.games)})" if note.games else "") + f"\n{note.body}" for note in written)
    people = "\n".join(f"  · {person['name']}: {person['who']}" for person in new.get("people") or [])
    said = "\n".join(f"  · {line}" for line in new.get("said") or [])
    return f"""You keep the long-term memory of an app that turns a streamer's Twitch lives into short videos. The AI of the app reads this memory before it analyses a live, searches it or builds a video: it is how it knows the streamer better with every live. You have just read one more live. Rewrite the memory so that it is true after it.

THE MEMORY AS IT IS
{memory}

THE LIVE YOU JUST READ
{_told(new, events=MAX_EVENTS)}
People in it:
{people or '  (nobody noted)'}
What the streamer said about themselves:
{said or '  (nothing noted)'}

THE LIVES READ BEFORE IT (the latest first)
{chr(10).join(_told(e, events=4) for e in earlier) or '(none: this is the first live you read)'}

WHAT THE STREAMER WROTE THEMSELVES (their notes: the AI is given them too, beside your memory)
{theirs or '(no notes)'}

1. THE MEMORY. Five sections, each a list of short lines, in the stream's language:
{chr(10).join(f'- "{key}" ({LIMITS[key]} characters at most): {_HOLDS[key]}' for key in SECTIONS)}
Rules:
- The memory adds up from live to live. What the live you just read doesn't mention is not thereby false or forgotten: give it back as it is. Change a line only when this live changes it (say since when), take one out only when it turned out wrong, ended, or the section is full (then the oldest and least useful go).
- Something seen in one live is a fact about that live (« le 9/11, ... »), not a habit: it becomes a general truth when it is seen again. Mind the dates: the live you just read may be older than others already in the memory, and what is newer wins.
- Don't copy the streamer's notes into the memory: note what the lives add to them, and what the lives show differently. Where a note and the memory disagree on who someone is or how a name is written, the note is right.
- In a role-play, tell the streamer from their character.
- Never invent. An empty section stays empty ("").

2. THEIR NOTES. Read each note and look for a sentence that the lives now show to be false: what they say they play, with whom, when they stream, who is who, where a story stands. When several lives show otherwise (or the streamer said so themselves in a live), propose its correction: {MAX_PROPOSALS} at most, and none in doubt. One live where something differs is not enough to rewrite what they wrote about themselves.
- A correction replaces what is wrong, in the note that says it: "before" is the false sentence itself (with the one next to it when they go together), "after" what is true now, written as they would write it (same person, same tone). A note written in the first person is still theirs to be corrected: « je joue surtout à X » while every recent live is on Y is exactly what to bring up.
- Never touch a sentence that is still true, and never add to a note something it doesn't talk about: adding a fact is not a correction. Questions a note asks the streamer are theirs to answer: leave them.

Answer with JSON only:
{{"who": "- ...\\n- ...", "games": "...", "people": "...", "stories": "...", "tastes": "...",
"proposals": [{{"note": "<the id between brackets>", "before": "<the sentence(s) of the note to change, copied character for character>", "after": "<what to write instead, in the note's language and tone>", "why": "<one sentence said to the streamer: what you saw in their lives>"}}]}}"""


def clean_sections(raw: dict, before: dict) -> dict:
    """The memory a model gave back, as it is kept. A section it left out stays as it was; the tastes the
    streamer stated are never lost to a model that forgot them."""
    sections = {key: _lines(raw[key], LIMITS[key]) if key in raw else before[key] for key in SECTIONS}
    if before["tastes"] and not sections["tastes"]:
        sections["tastes"] = before["tastes"]
    return sections


def _names(line: str) -> set[str]:
    """The words of the name a line of « people » starts with (« - Blue Granger : ... » -> {"blue", "granger"})."""
    name, colon, _rest = line.lstrip("- ").partition(":")
    return {word for word in _plain(name).split() if len(word) >= 3} if colon else set()


def _with_everyone(rewritten: str, before: str, limit: int) -> str:
    """The people after a rewriting: what the model wrote, then everyone it left out who was there before, while
    there is room. A model tends to keep the people of the live it just read and to drop the others: someone
    leaves the memory when the section is full, not because one live didn't show them. (Told so, it still did.)"""
    lines = [line for line in rewritten.splitlines() if line.strip()]
    kept = set().union(*(_names(line) for line in lines)) if lines else set()
    size = sum(len(line) + 1 for line in lines)
    for line in before.splitlines():
        names = _names(line)
        if not names or names & kept or size + len(line) + 1 > limit:
            continue
        lines.append(line)
        kept |= names
        size += len(line) + 1
    return "\n".join(lines)


def _with_told(rewritten: str, kept: str) -> str:
    """The tastes after a rewriting: what the model wrote (what the lives show), then every taste the streamer
    told the AI themselves, word for word. A model never drops, rewords or doubles those: they are the
    streamer's own words, noted the day they were said (also while the model was thinking)."""
    told = [line for line in kept.splitlines() if _TOLD.search(line)]
    plain = [_plain(line) for line in told]
    seen = [
        line for line in rewritten.splitlines()
        if line.strip() and not any(_plain(line) == other or difflib.SequenceMatcher(None, _plain(line), other).ratio() > 0.85 for other in plain)
    ]
    return "\n".join([*seen, *told])


def consolidate(new: dict) -> tuple[dict, list[dict], float]:
    """Rewrites the memory from a live just read: (the sections, the corrections proposed for the notes, dollars).
    What the streamer (or `remember`) wrote into the memory while the model was thinking is not lost: the
    rewriting is then done again from it, once."""
    written = notes.load()
    earlier = [e for e in entries() if e.get("job") != new.get("job")][:RECENT_SEEN]
    spent = 0.0
    for attempt in range(2):
        start = read()
        data, cost, by = _ask(consolidating_prompt(start["sections"], new, earlier, written), 7000)
        spent += cost
        with _LOCK:
            now = read()
            if now["sections"] != start["sections"] and attempt == 0:
                continue
            sections = clean_sections(data, now["sections"])
            sections["tastes"] = _with_told(sections["tastes"], now["sections"]["tastes"])
            sections["people"] = _with_everyone(sections["people"], now["sections"]["people"], LIMITS["people"])
            _save(_memory_path(), {**now, "sections": sections, "updated_at": _now()})
        proposals = clean_proposals(data.get("proposals"), written)
        logger.info(
            f"[{str(new.get('job'))[:8]}] Memory rewritten with {by} (~{spent:.4f} $): "
            + ", ".join(f"{key} {len(sections[key])}" for key in SECTIONS)
            + f"; {len(proposals)} correction(s) proposed for the notes"
        )
        return sections, proposals, spent
    raise RuntimeError("the memory kept changing while it was being rewritten")


def note_live(job_id: str, meta: dict, duration: float, moments: list[dict] | None = None, context: dict | None = None, fresh: bool = False) -> dict:
    """A live that has just been analysed (or one analysed before, on a rebuild) enters the memory:
    {"entry", "sections", "proposals", "cost", "cached"}. A live already read is not read again (`fresh`: it is)."""
    kept = None if fresh else entry(job_id)
    if kept:
        return {"entry": kept, "sections": read()["sections"], "proposals": [], "cost": 0.0, "cached": True}
    found = read_live(job_id, meta, duration, moments, context)
    sections, proposals, cost = consolidate(found)
    return {"entry": found, "sections": sections, "proposals": proposals, "cost": round(float(found.get("cost") or 0.0) + cost, 4), "cached": False}
