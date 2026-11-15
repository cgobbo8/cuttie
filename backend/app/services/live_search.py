"""Looking for moments in the whole live, after the analysis.

By words: what was said (the live's transcript) or written in the chat, free
and instant. By asking the AI: it searches like an editor would, with small
tools (words said, chat, sounds, loud moments, reading a passage, listening
to it: live_tools.py, live_agent.py), checks each moment and only then
answers; about a cent, kept on disk so the same question is never paid twice.
The AI can also plan a whole video from a description (sections of moments),
for the compilations.

With the development command (CUTTIE_LLM_CMD), which can't call tools, the AI
reads the whole transcript once instead, as it did before the tools.
"""

import hashlib
import json
import logging
import os
import re
import threading
import time
import unicodedata
from bisect import bisect_left
from dataclasses import asdict, dataclass, field

from app.services import notes
from app.services import llm_text, paths
from app.services.presort import chat_highlights, hms, parse_hms
from app.services.vod_transcript import VodTranscript, load_cached

logger = logging.getLogger(__name__)

# Most results of a search by words, and moments the AI may give
MAX_HITS = 150
MAX_AI_MOMENTS = 30
# The words of a search must be said within this many seconds (a sentence often spans two segments)
PHRASE_SECONDS = 8.0
PHRASE_SEGMENTS = 4
# Chat messages about the same thing: no more than this apart
CHAT_GAP = 20.0
# The chat reacts after the stream: what it talks about started this long before its first message
CHAT_BEFORE, CHAT_AFTER = 8.0, 3.0
# What is said around a result, shown to judge it without playing it
AROUND_SECONDS = 8.0
AROUND_CHARS = 160
# The AI reads one line per this many seconds
AI_LINE_SECONDS = 10.0
# Share of the lines marked as the loudest
LOUD_SHARE = 0.08
# Where a moment the AI gave may be looked for, around the times it gave
QUOTE_SLACK = 30.0
# Shortest and longest moment the AI may give: of a search, of a planned video (made of many)
MIN_MOMENT, MAX_MOMENT, MAX_PLANNED = 2.0, 45.0, 30.0

_BOTS = {"nightbot", "streamelements", "streamlabs", "moobot", "fossabot", "wizebot", "sery_bot", "soundalerts"}
# Words too common to look for (when a search has others)
_STOP = {
    "a", "au", "aux", "c", "ca", "ce", "ces", "d", "de", "des", "du", "elle", "en", "est", "et", "il", "ils", "j", "je", "l", "la",
    "le", "les", "m", "me", "n", "ne", "on", "ou", "qu", "que", "qui", "s", "se", "t", "te", "tu", "un", "une", "y",
    "the", "an", "is", "it", "of", "to", "and", "in", "el", "los", "las", "es", "y",
}


@dataclass
class Hit:
    """A moment of the live that matches a search, in live seconds."""

    start: float
    end: float
    # Where it was found: "voice" (said), "chat" (written), "ai" (the AI read it)
    sources: list[str]
    # What is said there
    text: str = ""
    before: str = ""
    after: str = ""
    # Chat messages that match, "author: text"
    chat: list[str] = field(default_factory=list)
    # The AI's reason and how sure it is (0-1)
    why: str = ""
    score: float = 0.0
    # The moment is something said, and its bounds are those the transcript gives to these words
    # (rough when it has lines only): once it has its clip, it is cut on where they are really said
    spoken: bool = False


# ── Words ────────────────────────────────────────────────────────────────────


def tokens(text: str) -> list[str]:
    """Lowercase words without accents ("C'est très calme" -> c, est, tres, calme)."""
    plain = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")
    return re.findall(r"[a-z0-9]+", plain)


def stem(token: str) -> str:
    """A word without its plural or its final e: "calmes", "calme" and "calmement" all start with "calm"."""
    if len(token) >= 5 and token[-1] in "sx":
        token = token[:-1]
    if len(token) >= 5 and token[-1] == "e":
        token = token[:-1]
    return token


def query_terms(query: str) -> list[str]:
    """What to look for: the query's words, the hollow ones dropped (unless there is nothing else)."""
    words = tokens(query)
    kept = [w for w in words if w not in _STOP] or words
    seen: list[str] = []
    for term in (stem(w) for w in kept):
        if term not in seen:
            seen.append(term)
    return seen


def _has(term: str, stems: list[str]) -> bool:
    # Short terms must be the whole word ("or" is not in "alors")
    return any(s == term or (len(term) >= 3 and s.startswith(term)) for s in stems)


def _excerpt(parts: list[str], limit: int = AROUND_CHARS, tail: bool = False) -> str:
    text = " ".join(p.strip() for p in parts if p.strip())
    if len(text) <= limit:
        return text
    return f"…{text[-limit:]}" if tail else f"{text[:limit]}…"


def _around(transcript: VodTranscript, start: float, end: float) -> tuple[str, str]:
    """What is said just before `start` and just after `end`."""
    before = [t for s, e, t in transcript.segments if e <= start + 0.01 and e > start - AROUND_SECONDS]
    after = [t for s, e, t in transcript.segments if s >= end - 0.01 and s < end + AROUND_SECONDS]
    return _excerpt(before, tail=True), _excerpt(after)


def _said(transcript: VodTranscript, start: float, end: float) -> str:
    return _excerpt([t for s, e, t in transcript.segments if e > start and s < end], limit=260)


# A sentence, around the words looked for: it stops at a pause, at a full stop, or this far from them
SENTENCE_PAUSE = 0.7
SENTENCE_REACH = 6.0
_SENTENCE_END = (".", "?", "!", "…")


def _sentence(transcript: VodTranscript, terms: list[str], start: float, end: float) -> tuple[float, float, str] | None:
    """The sentence in which `terms` are said between `start` and `end`, from the live's timed words
    (None without them: the local engine gives segments only)."""
    words = transcript.words
    if not words:
        return None
    lo = bisect_left(_word_starts(transcript), start - 0.3)
    hi = lo
    while hi < len(words) and words[hi]["start"] < end + 0.3:
        hi += 1
    said = [i for i in range(lo, hi) if any(_has(term, [stem(w) for w in tokens(str(words[i]["word"]))]) for term in terms)]
    if not said:
        return None
    a, b = said[0], said[-1]
    while (
        a > 0
        and words[a]["start"] - words[a - 1]["end"] < SENTENCE_PAUSE
        and not str(words[a - 1]["word"]).rstrip().endswith(_SENTENCE_END)
        and words[said[0]]["start"] - words[a - 1]["start"] < SENTENCE_REACH
    ):
        a -= 1
    while (
        b < len(words) - 1
        and words[b + 1]["start"] - words[b]["end"] < SENTENCE_PAUSE
        and not str(words[b]["word"]).rstrip().endswith(_SENTENCE_END)
        and words[b + 1]["end"] - words[said[-1]]["end"] < SENTENCE_REACH
    ):
        b += 1
    return float(words[a]["start"]), float(words[b]["end"]), " ".join(str(w["word"]).strip() for w in words[a : b + 1])


# What a word takes to say on a stream (people speak fast: 4 to 5 words a second), and the breath around a sentence
WORD_SECONDS = 0.22
SENTENCE_AIR = 0.4


def spoken_seconds(transcript: VodTranscript, start: float, end: float, text: str) -> float:
    """How long a line of the transcript takes to say. With timed words its own times tell; the
    local engine gives lines whose times hold silence (a 2 s sentence in a 6 s line): its words
    are counted instead."""
    length = max(0.0, end - start)
    if transcript.words:
        return length
    return min(length, WORD_SECONDS * len(text.split()) + SENTENCE_AIR)


def stamp(seconds: float) -> str:
    """A time to the tenth of a second, "1:16:59.9": what tells two short lines apart."""
    tenths = int(round(max(0.0, seconds) * 10))
    whole, tenth = divmod(tenths, 10)
    return f"{whole // 3600}:{whole % 3600 // 60:02d}:{whole % 60:02d}.{tenth}"


def _word_starts(transcript: VodTranscript) -> list[float]:
    starts = getattr(transcript, "_starts", None)
    if starts is None:
        starts = [float(w["start"]) for w in transcript.words]
        transcript._starts = starts  # type: ignore[attr-defined]
    return starts


def _tighten_to_words(transcript: VodTranscript, start: float, end: float) -> tuple[float, float]:
    """A segment's bounds are rough (whole seconds with some engines): the words inside, when timed, are exact."""
    inside = [w for w in transcript.words if w["end"] > start - 0.3 and w["start"] < end + 0.3]
    if len(inside) < 2:
        return start, end
    return float(inside[0]["start"]), float(inside[-1]["end"])


def search_voice(transcript: VodTranscript, terms: list[str]) -> list[Hit]:
    """Moments when all the `terms` are said, close together."""
    if not terms:
        return []
    segments = [(s, e, t, [stem(w) for w in tokens(t)]) for s, e, t in transcript.segments]
    hits: list[Hit] = []
    taken = -1
    for i, (start, _end, _text, stems) in enumerate(segments):
        if i <= taken or not any(_has(term, stems) for term in terms):
            continue
        found: set[str] = set()
        last = i
        for j in range(i, min(len(segments), i + PHRASE_SEGMENTS)):
            if segments[j][0] - start > PHRASE_SECONDS:
                break
            here = {term for term in terms if _has(term, segments[j][3])}
            if here - found:
                last = j
            found |= here
            if len(found) == len(terms):
                break
        if len(found) < len(terms):
            continue
        taken = last
        # With timed words: the very sentence, not the whole segment (some run for 20 s)
        sentence = _sentence(transcript, terms, start, segments[last][1])
        if sentence:
            hits.append(Hit(start=sentence[0], end=sentence[1], sources=["voice"], text=sentence[2], spoken=True))
        else:
            hits.append(Hit(start=start, end=segments[last][1], sources=["voice"], text=" ".join(seg[2].strip() for seg in segments[i : last + 1]), spoken=True))
    return hits


def search_chat(messages: list[dict], terms: list[str], lag: float, duration: float) -> list[Hit]:
    """Moments when the chat writes all the `terms` (bots aside), messages about the same thing together."""
    if not terms:
        return []
    matching: list[tuple[float, str]] = []
    for m in messages:
        author = str(m.get("author", ""))
        text = str(m.get("text") or m.get("message") or "")
        if author.lower() in _BOTS or not text:
            continue
        stems = [stem(w) for w in tokens(text)]
        if all(_has(term, stems) for term in terms):
            matching.append((float(m.get("timestamp", 0.0)), f"{author}: {text[:120]}"))
    matching.sort()
    hits: list[Hit] = []
    group: list[tuple[float, str]] = []
    for item in [*matching, None]:
        if item is not None and (not group or item[0] - group[-1][0] <= CHAT_GAP):
            group.append(item)
            continue
        if group:
            # On the stream's clock: what they react to came before their messages
            start = max(0.0, group[0][0] - lag - CHAT_BEFORE)
            end = min(duration, group[-1][0] - lag + CHAT_AFTER) if duration else group[-1][0] - lag + CHAT_AFTER
            hits.append(Hit(start=start, end=max(end, start + MIN_MOMENT), sources=["chat"], chat=[line for _t, line in group[:6]]))
        group = [item] if item is not None else []
    return hits


# A burst of the chat: messages within this many seconds, at least this many (and well over its
# usual pace) from at least two viewers; two bursts are this far apart at least
BURST_SECONDS = 20.0
BURST_MESSAGES = 4
BURST_OVER_USUAL = 2.5
BURST_APART = 45.0
# Where a burst really starts: where its messages come closest together, over this many seconds
BURST_ONSET = 5.0


def _onset(times: list[float]) -> float:
    most, at, end = 0, times[0], 0
    for i, t in enumerate(times):
        while end < len(times) and times[end] < t + BURST_ONSET:
            end += 1
        if end - i > most:
            most, at = end - i, t
    return at


def chat_peaks(messages: list[dict], lag: float, duration: float, limit: int = 20) -> list[dict]:
    """The moments when the chat writes the most at once (bots and commands aside), the strongest first.
    For each: where it is on the stream (the chat reacts `lag` seconds late, to what came just before),
    how many messages from how many viewers, how many it usually writes in that time, some of the
    messages, and whether viewers ask for a clip."""
    from collections import Counter

    from app.services.chat_analyzer import CLIP_REQUEST

    written: list[tuple[float, str, str]] = []
    for m in messages:
        author = str(m.get("author", ""))
        text = str(m.get("text") or m.get("message") or "").strip()
        if not text or text.startswith("!") or author.lower() in _BOTS:
            continue
        written.append((float(m.get("timestamp", 0.0)), author, text))
    written.sort()
    if len(written) < BURST_MESSAGES:
        return []
    usual = len(written) / max(duration or written[-1][0], BURST_SECONDS) * BURST_SECONDS
    needed = max(BURST_MESSAGES, BURST_OVER_USUAL * usual)
    # From each message, how many are written within the burst's length, by how many viewers
    bursts: list[tuple[int, int, int, int]] = []  # viewers, messages, first index, one past the last
    inside: Counter = Counter()
    end = 0
    for i, (t, author, _text) in enumerate(written):
        while end < len(written) and written[end][0] < t + BURST_SECONDS:
            inside[written[end][1].lower()] += 1
            end += 1
        if end - i >= needed and len(inside) >= 2:
            bursts.append((len(inside), end - i, i, end))
        inside[author.lower()] -= 1
        if not inside[author.lower()]:
            del inside[author.lower()]
    peaks: list[dict] = []
    taken: list[float] = []
    for viewers, count, i, j in sorted(bursts, key=lambda b: (-b[0], -b[1], b[2])):
        if len(peaks) >= limit:
            break
        group = written[i:j]
        first = _onset([t for t, _a, _x in group])
        if any(abs(first - other) < BURST_APART for other in taken):
            continue
        taken.append(first)
        said = Counter(text.lower() for _t, _a, text in group)
        lines: list[str] = []
        for t, author, text in group:
            # From where the burst starts; the same message from many viewers (an emote, "clip") is given once
            if t >= first and said[text.lower()] and len(lines) < 5:
                lines.append(f"{author}: {text[:80]}" + (f" (x{said[text.lower()]})" if said[text.lower()] > 1 else ""))
                said[text.lower()] = 0
        start = max(0.0, first - lag - CHAT_BEFORE)
        stop = group[-1][0] - lag + CHAT_AFTER
        peaks.append({
            "start": start,
            "end": max(start + MIN_MOMENT, min(duration, stop) if duration else stop),
            "messages": count,
            "viewers": viewers,
            "usual": round(usual, 1),
            "lines": lines,
            "clip_requests": sum(1 for _t, _a, text in group if CLIP_REQUEST.search(text)),
        })
    return peaks


def merge_hits(voice: list[Hit], chat: list[Hit]) -> list[Hit]:
    """One list in the live's order: a chat reaction to something said joins it."""
    merged: list[Hit] = []
    for hit in sorted(voice, key=lambda h: h.start):
        last = merged[-1] if merged else None
        if last and hit.start <= last.end + 1.0:
            last.end = max(last.end, hit.end)
            last.text = f"{last.text} {hit.text}".strip()
        else:
            merged.append(hit)
    for hit in chat:
        near = next((v for v in merged if v.start <= hit.end + 3.0 and v.end >= hit.start - 3.0), None)
        if near:
            near.chat += hit.chat
            if "chat" not in near.sources:
                near.sources.append("chat")
        else:
            merged.append(hit)
    return sorted(merged, key=lambda h: h.start)


def read_chat(job_id: str) -> list[dict]:
    try:
        with open(os.path.join(paths.clip_dir(job_id), "chat.json"), encoding="utf-8") as f:
            chat = json.load(f)
        return chat if isinstance(chat, list) else []
    except (OSError, ValueError):
        return []


def _complete(hits: list[Hit], transcript: VodTranscript | None) -> list[dict]:
    """Hits ready for the app: what is said in and around each, times to the hundredth."""
    out: list[dict] = []
    for hit in hits:
        if transcript:
            if not hit.text:
                hit.text = _said(transcript, hit.start, hit.end)
            hit.before, hit.after = _around(transcript, hit.start, hit.end)
        hit.start, hit.end = round(hit.start, 2), round(hit.end, 2)
        out.append(asdict(hit))
    return out


def search_words(job_id: str, query: str, duration: float = 0.0, lag: float = 5.0) -> dict:
    """Every moment when `query` is said or written in the chat."""
    transcript = load_cached(job_id)
    terms = query_terms(query)
    voice = search_voice(transcript, terms) if transcript else []
    chat = search_chat(read_chat(job_id), terms, lag, duration)
    hits = merge_hits(voice, chat)
    logger.info(f"[{job_id[:8]}] Search \"{query[:60]}\": {len(voice)} said, {len(chat)} in the chat")
    return {"hits": _complete(hits[:MAX_HITS], transcript), "total": len(hits), "transcript": transcript is not None}


# ── The AI reads the live ────────────────────────────────────────────────────


def ai_lines(transcript: VodTranscript, energy: list[float] | None, duration: float) -> list[str]:
    """The live as "[H:MM:SS] what is said" lines of about 10 s, the loudest ones marked (LOUD)."""
    lines: list[tuple[float, str]] = []
    current: list[str] = []
    line_start: float | None = None
    for start, _end, text in transcript.segments:
        text = text.strip()
        if not text:
            continue
        if line_start is not None and start - line_start >= AI_LINE_SECONDS and current:
            lines.append((line_start, " ".join(current)))
            current, line_start = [], None
        if line_start is None:
            line_start = start
        current.append(text)
    if current and line_start is not None:
        lines.append((line_start, " ".join(current)))

    loud: set[int] = set()
    if energy and duration > 0 and lines:
        step = duration / len(energy)

        def level(at: float) -> float:
            a = int(at / step)
            window = energy[a : max(a + 1, int((at + AI_LINE_SECONDS) / step) + 1)]
            return max(window) if window else 0.0

        levels = [level(start) for start, _text in lines]
        threshold = sorted(levels)[int(len(levels) * (1 - LOUD_SHARE))] if levels else 1.0
        loud = {i for i, value in enumerate(levels) if value >= threshold and value > 0}
    return [f"[{hms(start)}] {'(LOUD) ' if i in loud else ''}{text}" for i, (start, text) in enumerate(lines)]


def _header(meta: dict) -> str:
    return (
        "You are helping a Twitch streamer turn a live stream into short vertical videos. Below is the full transcript of the stream "
        f"by {meta.get('streamer') or 'the streamer'} (game: {meta.get('game') or '?'}, title: \"{meta.get('title') or ''}\"), "
        "one line per ~10 seconds, each starting with its time. Lines marked (LOUD) are the loudest moments of the stream "
        "(shouting, action, laughter). After the transcript come the moments when the chat reacted; the chat's times are already "
        "moved back onto the stream."
    )


def _body(lines: list[str], chat: list[str]) -> str:
    return f"TRANSCRIPT\n{chr(10).join(lines)}\n\nCHAT HIGH POINTS\n{chr(10).join(chat) if chat else '(quiet chat)'}"


_MOMENT_RULES = """For each moment give:
- "start" and "end": H:MM:SS from the transcript, the tightest window that contains it and still makes sense on its own
- "quote": the exact words of the transcript where it happens (5 to 15 words, copied verbatim, no time)
- "why": one short sentence in the stream's language
- "score": 0-100, how well it fits and how good it would be in a video
Only moments that are in the transcript: never invent a time or a quote."""


def search_prompt(lines: list[str], chat: list[str], query: str, meta: dict, max_moments: int = MAX_AI_MOMENTS) -> str:
    # The transcript first: the same live asked again is read from the provider's cache
    return f"""{_header(meta)}

{_body(lines, chat)}

THE STREAMER IS LOOKING FOR: "{query}"

Find every moment of the stream that matches, up to {max_moments}, in the order of the stream. A match can be literal (the words are
said) or by meaning (the situation fits: read what is actually said, how people react, and the (LOUD) marks). Leave out weak or
doubtful matches: better few good ones. Windows are 5 to 30 seconds, never more than 40: start just before the first sentence that
matters, end right after the payoff or the reaction; of a longer scene, give its best 30 seconds.
{_MOMENT_RULES}
Answer with JSON only: {{"moments": [{{"start": "H:MM:SS", "end": "H:MM:SS", "quote": "...", "why": "...", "score": 0-100}}]}}"""


def plan_prompt(lines: list[str], chat: list[str], brief: str, target: float, meta: dict) -> str:
    return f"""{_header(meta)}

{_body(lines, chat)}

THE STREAMER DESCRIBES THE VIDEO THEY WANT: "{brief}"
Target length: about {target:.0f} seconds in all (never more than {target * 1.15:.0f}).

Build that video from moments of the stream. Make one section per idea of the description, in the order described (a single section
when it has only one idea). Each section has a short on-screen title (2 to 4 words, in the stream's language, like a chapter card)
and its moments in the order they should play. For a fast compilation each moment is short (2 to 12 seconds: the sentence or the
action itself, no lead-in); for a story, fewer and longer ones. The moments of all sections together must fit the target length.
{_MOMENT_RULES}
Answer with JSON only:
{{"title": "name of the video", "sections": [{{"title": "...", "moments": [{{"start": "H:MM:SS", "end": "H:MM:SS", "quote": "...", "why": "...", "score": 0-100}}]}}]}}"""


def locate_quote(transcript: VodTranscript, quote: str, around: tuple[float, float]) -> tuple[float, float] | None:
    """Where `quote` is said near `around` (live seconds): the run of segments that shares the most
    words with it, tightened to the very words when they are timed."""
    wanted = [stem(w) for w in tokens(quote) if w not in _STOP]
    if len(wanted) < 2:
        return None
    nearby = [(s, e, {stem(w) for w in tokens(t)}) for s, e, t in transcript.segments if e > around[0] and s < around[1]]
    best: tuple[float, float, float] | None = None
    for i in range(len(nearby)):
        said: set[str] = set()
        for j in range(i, min(len(nearby), i + 5)):
            said |= nearby[j][2]
            share = sum(1 for w in wanted if w in said) / len(wanted)
            # The shortest run that says it (a longer one must say clearly more)
            score = share - 0.03 * (j - i)
            if share >= 0.6 and (best is None or score > best[2]):
                best = (nearby[i][0], nearby[j][1], score)
    if not best:
        return None
    return _quote_words(transcript, set(wanted), best[0], best[1]) or (best[0], best[1])


def _quote_words(transcript: VodTranscript, wanted: set[str], start: float, end: float) -> tuple[float, float] | None:
    """Inside `start`-`end`, the shortest stretch of timed words that says most of the quote."""
    words = transcript.words
    if not words:
        return None
    lo = bisect_left(_word_starts(transcript), start - 0.3)
    stems = []
    for i in range(lo, len(words)):
        if words[i]["start"] >= end + 0.3:
            break
        stems.append((i, {stem(w) for w in tokens(str(words[i]["word"]))}))
    most = len({w for _i, said in stems for w in said if w in wanted})
    if most < 2:
        return None
    best: tuple[float, int, int] | None = None
    for a, (i, said) in enumerate(stems):
        if not said & wanted:
            continue
        found: set[str] = set()
        for j, more in stems[a:]:
            found |= more & wanted
            if len(found) >= 0.8 * most:
                length = float(words[j]["end"]) - float(words[i]["start"])
                if best is None or length < best[0]:
                    best = (length, i, j)
                break
    return (float(words[best[1]]["start"]), float(words[best[2]]["end"])) if best else None


# A window's edge moves to the nearest sentence edge when one is this close (segments only: no timed words)
SNAP_REACH = 2.0


def _snap(transcript: VodTranscript, start: float, end: float) -> tuple[float, float]:
    """A window opened and closed between sentences, without getting much longer: on the timed
    words it touches, else on the nearest segment edges."""
    if transcript.words:
        return _tighten_to_words(transcript, start, end)
    starts = [s for s, _e, _t in transcript.segments if abs(s - start) <= SNAP_REACH]
    ends = [e for _s, e, _t in transcript.segments if abs(e - end) <= SNAP_REACH]
    return (min(starts, key=lambda s: abs(s - start)) if starts else start), (min(ends, key=lambda e: abs(e - end)) if ends else end)


def parse_moments(raw_moments: list, transcript: VodTranscript, duration: float, limit: int = MAX_AI_MOMENTS, longest: float = MAX_MOMENT) -> list[Hit]:
    """The AI's moments as hits: valid windows only, set on the words it quoted, never over `longest` seconds."""
    hits: list[Hit] = []
    for raw in raw_moments if isinstance(raw_moments, list) else []:
        if not isinstance(raw, dict):
            continue
        start, end = parse_hms(raw.get("start")), parse_hms(raw.get("end"))
        if start is None:
            continue
        end = start + 10.0 if end is None or end <= start else end
        quote = str(raw.get("quote") or "").strip()
        spot = locate_quote(transcript, quote, (start - QUOTE_SLACK, end + QUOTE_SLACK)) if quote else None
        if spot:
            # The quote anchors the window: lines are 10 s long, the AI's times are that rough
            if spot[0] >= start - 1.0 and spot[1] <= end + 1.0:
                # Said inside it: the window stands, opened where the quote sticks out
                start, end = min(start, spot[0]), max(end, spot[1])
            else:
                # Said elsewhere: the window goes there, as long as the AI meant it (the reaction comes after)
                room = max(0.0, (end - start) - (spot[1] - spot[0]))
                start, end = spot[0] - 0.3 * room, spot[1] + 0.7 * room
        if end - start > longest:
            # Too long for a compilation: what it quoted and what follows, else its beginning
            start = max(start, spot[0] - 0.3 * longest) if spot else start
            end = start + longest
        start, end = _snap(transcript, max(0.0, start), end)
        if duration:
            end = min(duration, end)
        if end - start < MIN_MOMENT:
            end = start + MIN_MOMENT
        try:
            score = max(0.0, min(1.0, float(raw.get("score", 50)) / 100))
        except (TypeError, ValueError):
            score = 0.5
        # What it quoted, as the transcript has it: the sentence that shows why this moment was picked
        said = _said(transcript, spot[0], spot[1]) if spot else ""
        hits.append(Hit(start=start, end=end, sources=["ai"], text=said, why=str(raw.get("why") or "")[:200], score=score, spoken=bool(spot)))
    return hits[:limit]


# How far a line's time may be from the one the AI copied (it copies them to the tenth)
LINE_SLACK = 0.06
# A moment without words (a sound): at least this long
SOUND_SECONDS = 2.0


def _lines_between(transcript: VodTranscript, first, last) -> list[tuple[float, float, str]]:
    """The lines from the one stamped `first` to the one stamped `last`, as the AI copied these
    times from `read` ("1:16:59.9", or "1:16:59" when it dropped the tenths)."""
    a, b = parse_hms(first), parse_hms(last)
    if a is None:
        return []
    b = a if b is None or b < a else b
    # Without tenths, a time names every line that starts within that second
    lo = a - LINE_SLACK
    hi = b + (LINE_SLACK if "." in str(last if last is not None else first) else 0.999)
    return [(s, e, t) for s, e, t in transcript.segments if lo <= s <= hi and t.strip()]


def parse_line_moments(raw_moments: list, transcript: VodTranscript, duration: float, limit: int = MAX_AI_MOMENTS, longest: float = MAX_MOMENT) -> list[Hit]:
    """The moments of the AI that searches with tools, as hits. It gives each one as lines of
    the transcript (`start`: the time of the first line to keep, `end`: the time of the last),
    so a moment is whole sentences whatever their times are worth; what it quoted is looked for
    when its times name no line. A moment with no words (a sound) keeps the times it gave."""
    hits: list[Hit] = []
    for raw in raw_moments if isinstance(raw_moments, list) else []:
        if not isinstance(raw, dict):
            continue
        start, end = parse_hms(raw.get("start")), parse_hms(raw.get("end"))
        if start is None:
            continue
        end = start if end is None or end < start else end
        quote = str(raw.get("quote") or "").strip()
        lines = _lines_between(transcript, raw.get("start"), raw.get("end"))
        spot = locate_quote(transcript, quote, (start - QUOTE_SLACK, end + QUOTE_SLACK)) if quote else None
        if spot and not any(e > spot[0] and s < spot[1] for s, e, _t in lines):
            # What it quoted is said elsewhere than the lines it named (or it named none): there, then
            lines = [(s, e, t) for s, e, t in transcript.segments if e > spot[0] and s < spot[1] and t.strip()]
        # Too long for a compilation: its first lines
        said = 0.0
        kept: list[tuple[float, float, str]] = []
        for line in lines:
            said += spoken_seconds(transcript, *line)
            if kept and said > longest:
                break
            kept.append(line)
        if kept:
            a, b = _tighten_to_words(transcript, kept[0][0], kept[-1][1]) if transcript.words else (kept[0][0], kept[-1][1])
            text = _excerpt([t for _s, _e, t in kept], limit=260)
        else:
            # Nobody speaks there: a sound, as long as the AI said
            a, b, text = max(0.0, start), min(max(end, start + SOUND_SECONDS), start + longest), ""
        if duration:
            a, b = min(a, max(0.0, duration - 0.5)), min(duration, b)
        if b - a < 0.3:
            continue
        try:
            score = max(0.0, min(1.0, float(raw.get("score", 50)) / 100))
        except (TypeError, ValueError):
            score = 0.5
        hits.append(Hit(start=a, end=b, sources=["ai"], text=text, why=str(raw.get("why") or "")[:200], score=score, spoken=bool(kept)))
    return hits[:limit]


def _cache_path(job_id: str, kind: str, *parts: str) -> str:
    key = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:20]
    return os.path.join(paths.transcript_dir(job_id), "search", f"{kind}_{key}.json")


def answered_by() -> list[str]:
    """What an answer of the AI kept on disk is filed under besides the question: the version of the app that
    asked. An update never serves what an older version answered: its instructions, its tools and what is made
    of the answer change from one version to the next, and the streamer who asks again after updating wants
    what the new one finds (it happened: three versions answered from the first one's disk). Outside the
    installed app there is no version: a development run keeps its answers until ANSWERS_VERSION changes."""
    version = os.getenv("CUTTIE_APP_VERSION", "").strip()
    # ...and what the streamer had written for the AI then: a note added or changed since, and the AI is asked again
    written = notes.signature()
    return [*([f"app {version}"] if version else []), *([f"notes {written}"] if written else [])]


def _cached(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _keep(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _signature(transcript: VodTranscript) -> str:
    return f"{len(transcript.segments)}:{transcript.segments[-1][1]:.0f}"


class NoTranscript(Exception):
    """The live was not transcribed (or its transcript is gone): the AI has nothing to read."""


def _reading(job_id: str, duration: float, energy: list[float] | None, lag: float) -> tuple[VodTranscript, list[str], list[str]]:
    transcript = load_cached(job_id)
    if not transcript:
        raise NoTranscript(job_id)
    return transcript, ai_lines(transcript, energy, duration), chat_highlights(read_chat(job_id), lag)


def info(job_id: str, duration: float = 0.0) -> dict:
    """What can be searched in this live, and about what asking the AI costs (dollars)."""
    from app.services import live_agent, sound_index

    transcript = load_cached(job_id)
    chat = read_chat(job_id)
    if not transcript:
        return {"transcript": False, "chat": len(chat), "ai_cost": None, "plan_cost": None, "sounds": False}
    dev = bool(llm_text.dev_command())
    if dev:
        lines = ai_lines(transcript, None, duration)
        cost = plan = llm_text.estimate_cost(sum(len(line) + 1 for line in lines) + 2500)
    else:
        cost, plan = live_agent.TYPICAL_COST, live_agent.TYPICAL_PLAN_COST
    return {
        "transcript": True,
        "segments": len(transcript.segments),
        "chat": len(chat),
        "ai_cost": cost,
        "plan_cost": plan,
        # The most a question can cost: the search stops there and answers with what it has
        "max_cost": None if dev else live_agent.MAX_COST,
        "plan_max_cost": None if dev else live_agent.PLAN_MAX_COST,
        # The live was listened to (its sounds can be searched); else the first question does it
        "sounds": os.path.isfile(sound_index.index_path(job_id)),
        # Tried with another model than the one that will be billed
        "dev": dev,
    }


# ── The AI searches with tools ───────────────────────────────────────────────

# What the AI is doing for each live being searched: {"step", "detail", "count", "at"}
_doing: dict[str, dict] = {}
_doing_lock = threading.Lock()
# Shown this long after its last step at most (a search that died leaves nothing behind)
DOING_TTL = 180.0


def doing(job_id: str) -> dict | None:
    """What the AI searching this live is doing right now, None when nothing is being searched."""
    with _doing_lock:
        now = _doing.get(job_id)
    if not now or time.time() - now["at"] > DOING_TTL:
        return None
    return {"step": now["step"], "detail": now["detail"], "count": now["count"]}


def _tell(job_id: str, step: str, detail: str = "") -> None:
    with _doing_lock:
        count = _doing.get(job_id, {}).get("count", 0) + 1
        _doing[job_id] = {"step": step, "detail": str(detail)[:80], "count": count, "at": time.time()}


def _step_detail(args: dict) -> str:
    """The one argument that says what a tool call is about: the words, the kind of sound, the time."""
    for key in ("words", "kind", "start"):
        if args.get(key):
            return str(args[key])
    return ""


def _ask(job_id: str, duration: float, lag: float, url: str | None, work, moments: list[dict] | None = None,
         models: list[str] | None = None, max_cost: float | None = None, others: list[dict] | None = None, date: str | None = None):
    """Have the AI do `work(searcher)` over this live: with its tools and its ears, the live
    listened to first when it never was. When the model fails for a reason of its own (retired,
    down, no answer), the next one does the work instead (`models`: the searching model then its
    fallback, unless given). Returns the run, the tools, and what all the tries cost.
    `others`: more lives to work on at once ({"job_id", "duration", "url", "moments", "date"}); the
    tools then say which live each call is about (live 1 is `job_id`)."""
    from app.services import live_agent, sound_index
    from app.services.live_tools import LiveTools, ManyLives
    from app.services.openai_client import get_openrouter_client
    from app.services.provider_errors import ProviderUnavailable

    try:
        lives = [{"job_id": job_id, "duration": duration, "url": url, "moments": moments, "date": date}, *(others or [])]
        for live in lives:
            if live.get("url") and not os.path.isfile(sound_index.index_path(live["job_id"])):
                _tell(job_id, "hearing")
                sound_index.ensure(live["job_id"], live["url"])
        each = [LiveTools(live["job_id"], live.get("duration") or 0.0, lag, live.get("moments"), date=live.get("date")) for live in lives]
        tools = ManyLives(each) if others else each[0]
        urls = [live.get("url") for live in lives] if others else url
        models = list(dict.fromkeys(m for m in (models or (live_agent.SEARCH_MODEL, live_agent.FALLBACK_MODEL)) if m))
        spent = 0.0
        for attempt, model in enumerate(models):
            _tell(job_id, "thinking")
            searcher = live_agent.Searcher(
                tools, get_openrouter_client(), model, vod_url=urls,
                on_step=lambda name, args: _tell(job_id, name, _step_detail(args)),
                max_cost=max_cost if max_cost is not None else live_agent.MAX_COST,
            )
            failure: Exception | None = None
            try:
                work(searcher)
            except ProviderUnavailable:
                # No credits, a refused key: the other model would be refused too
                raise
            except Exception as e:
                failure = e
            spent += searcher.run.cost
            if failure is None and searcher.run.finished:
                return searcher.run, tools, spent
            reason = f"{type(failure).__name__}: {failure}" if failure else f"no answer after {searcher.run.steps} steps"
            if attempt == len(models) - 1:
                raise RuntimeError(f"the AI ({model}) failed: {reason}"[:300]) from failure
            logger.warning(f"[{job_id[:8]}] AI search: {model} failed ({reason[:200]}), trying {models[attempt + 1]}")
        raise RuntimeError("no model to search with")
    finally:
        with _doing_lock:
            _doing.pop(job_id, None)


def search_ai(
    job_id: str, query: str, meta: dict, duration: float, energy: list[float] | None = None, lag: float = 5.0,
    url: str | None = None, moments: list[dict] | None = None, fresh: bool = False,
) -> dict:
    """Moments that match `query` by meaning: the AI searches the live with tools and checks what it finds.
    `url`: the live on Twitch, to listen to it (without it, the search reads only); `moments`: every
    candidate the analysis rated, as the app keeps them. `fresh`: asked again on purpose: the answer kept
    on disk is not served, and the new one takes its place."""
    transcript = load_cached(job_id)
    if not transcript:
        raise NoTranscript(job_id)
    if llm_text.dev_command():
        return _search_by_reading(job_id, query, meta, duration, energy, lag)
    from app.services import live_agent

    path = _cache_path(job_id, "agent", " ".join(tokens(query)), _signature(transcript), live_agent.SEARCH_MODEL, live_agent.ANSWERS_VERSION, *answered_by())
    kept = None if fresh else _cached(path)
    if kept:
        return {**kept, "cached": True, "cost": 0.0}
    run, tools, cost = _ask(job_id, duration, lag, url, lambda searcher: searcher.search(query), moments)
    hits = live_agent.to_hits(run, tools)
    result = {"hits": _complete(hits, transcript), "total": len(hits), "transcript": True, "note": run.note}
    _keep(path, result)
    logger.info(f"[{job_id[:8]}] AI search \"{query[:60]}\": {len(hits)} moments with {run.model} (~{cost:.4f} $, {run.seconds:.0f} s)")
    return {**result, "cached": False, "cost": round(cost, 4)}


def _lives(job_id: str, transcript: VodTranscript, duration: float, others: list[dict] | None) -> list[tuple[str, VodTranscript, float]]:
    """The lives a video is made from, in the order the AI numbers them: (job id, transcript, length)."""
    lives = [(job_id, transcript, duration)]
    for other in others or []:
        theirs = load_cached(other["job_id"])
        if not theirs:
            raise NoTranscript(other["job_id"])
        lives.append((other["job_id"], theirs, float(other.get("duration") or 0.0)))
    return lives


def _many_cost(others: list[dict] | None) -> float:
    """The most a described video may cost: half as much again for each live more, three times at most."""
    from app.services import live_agent

    return live_agent.PLAN_MAX_COST * min(3.0, 1.0 + 0.5 * len(others or []))


def plan_video(
    job_id: str, brief: str, target: float, meta: dict, duration: float, energy: list[float] | None = None, lag: float = 5.0,
    url: str | None = None, moments: list[dict] | None = None, others: list[dict] | None = None, leads: list[float] | None = None,
    fresh: bool = False,
) -> dict:
    """A whole video from a description: sections (a title, moments in playing order).
    `others`: more lives the video may take moments from; each hit then says its live (`job`).
    `leads`: moments already spotted for this video (live seconds), when it is one the AI proposed (live_ideas.py).
    `fresh`: asked again on purpose: the plan kept on disk is not served, and the new one takes its place."""
    transcript = load_cached(job_id)
    if not transcript:
        raise NoTranscript(job_id)
    lives = _lives(job_id, transcript, duration, others)
    if llm_text.dev_command():
        return _plan_by_reading(job_id, brief, target, meta, duration, energy, lag)
    from app.services import live_agent

    path = _cache_path(
        job_id, "agent_plan", " ".join(tokens(brief)), f"{target:.0f}", _signature(transcript), live_agent.PLAN_MODEL, live_agent.ANSWERS_VERSION, "answer",
        *[f"{other}:{_signature(theirs)}" for other, theirs, _length in lives[1:]],
        *answered_by(),
    )
    kept = None if fresh else _cached(path)
    if kept:
        return {**kept, "cached": True, "cost": 0.0}
    # A model of its own (sorting moments between the parts of a description takes more than finding them),
    # then those of the search when it fails
    # More lives to go through: more steps, and more to spend at most
    steps = live_agent.PLAN_STEPS + MORE_STEPS * len(others or [])
    run, _tools, cost = _ask(
        job_id, duration, lag, url, lambda searcher: searcher.plan(brief, target, max_steps=steps, leads=leads), moments,
        models=[live_agent.PLAN_MODEL, live_agent.SEARCH_MODEL, live_agent.FALLBACK_MODEL], max_cost=_many_cost(others),
        others=others, date=meta.get("date"),
    )
    result = {"title": run.title, "sections": _sections(run.sections, transcript, duration, by_lines=True, lives=lives if others else None), "note": run.note, "look": run.look, "hook": run.hook}
    _keep(path, result)
    total = sum(h["end"] - h["start"] for s in result["sections"] for h in s["hits"])
    logger.info(f"[{job_id[:8]}] AI plan \"{brief[:60]}\": {len(result['sections'])} sections, {total:.0f} s for a target of {target:.0f} s with {run.model} (~{cost:.4f} $, {run.seconds:.0f} s)")
    return {**result, "cached": False, "cost": round(cost, 4)}


# A line shares at least this much with a passage that holds it (seconds)
LINE_SHARED = 0.4
# Steps the AI gets on top of its own for each live more it works on
MORE_STEPS = 12


def as_lines(transcript: VodTranscript, start: float, end: float) -> dict:
    """A passage of a video as the AI names moments: the times of its first and last line (as
    `read` gives them) and what is said. Nobody speaks there: its own times."""
    # A passage cut on its words is shorter than its lines (their times hold silence): a line is
    # part of it when the passage holds its middle, or a good part of what it takes to say
    def in_it(s: float, e: float, t: str) -> bool:
        shared = min(e, end) - max(s, start)
        return start - 0.3 <= (s + e) / 2 <= end + 0.3 or shared >= min(LINE_SHARED, 0.5 * spoken_seconds(transcript, s, e, t))

    lines = [(s, e, t) for s, e, t in transcript.segments if t.strip() and e > start and s < end and in_it(s, e, t)]
    if not lines:
        over = [(s, e, t) for s, e, t in transcript.segments if e > start and s < end and t.strip()]
        lines = [max(over, key=lambda line: min(line[1], end) - max(line[0], start))] if over else []
    if not lines:
        return {"start": stamp(start), "end": stamp(end), "said": ""}
    return {"start": stamp(lines[0][0]), "end": stamp(lines[-1][0]), "said": _excerpt([t for _s, _e, t in lines], limit=200)}


def _other_lines(mine: dict, sent: list[dict]) -> bool:
    """A moment the AI gave back is one of the video's, but not with the same lines."""
    a, b = parse_hms(mine["start"]), parse_hms(mine["end"])
    if a is None or b is None:
        return False
    for moment in sent:
        s, e = parse_hms(moment["start"]), parse_hms(moment["end"])
        if s is not None and e is not None and a <= e and s <= b:
            return (mine["start"], mine["end"]) != (moment["start"], moment["end"])
    return False


def revise_video(
    job_id: str, brief: str, current: list[dict], asks: list[str], request: str, duration: float, lag: float = 5.0,
    url: str | None = None, moments: list[dict] | None = None, others: list[dict] | None = None, date: str | None = None,
) -> dict:
    """A video the AI planned, changed as the streamer now asks: the whole video again (sections of
    hits), what is kept given back at its place. `current`: its parts as they are now,
    [{"title", "items": [{"start", "end"}]}] in live seconds; `asks`: what was asked before.
    Never kept on disk: the video it starts from is never the same twice."""
    transcript = load_cached(job_id)
    if not transcript:
        raise NoTranscript(job_id)
    from app.services import live_agent

    # With several lives (`others`), each passage says which one it is from (`job`: a live's id, absent: this one)
    lives = _lives(job_id, transcript, duration, others)
    number = {live: n + 1 for n, (live, _theirs, _length) in enumerate(lives)}

    def told(item: dict) -> dict:
        n = number.get(str(item.get("job") or job_id), 1)
        lines = as_lines(lives[n - 1][1], float(item["start"]), float(item["end"]))
        # (the moment the video can open on says so, as the AI would say it)
        if item.get("opening") is True:
            lines = {**lines, "opens": True}
        return {"live": n, **lines} if others else lines

    video = [{"title": str(part.get("title") or ""), "moments": [told(i) for i in part.get("items") or []]} for part in current]
    steps = live_agent.PLAN_STEPS + MORE_STEPS * len(others or [])
    run, _tools, cost = _ask(
        job_id, duration, lag, url, lambda searcher: searcher.revise(brief, video, asks, request, max_steps=steps), moments,
        models=[live_agent.PLAN_MODEL, live_agent.SEARCH_MODEL, live_agent.FALLBACK_MODEL], max_cost=_many_cost(others),
        others=others, date=date,
    )
    result = {"title": run.title, "sections": _sections(run.sections, transcript, duration, by_lines=True, lives=lives if others else None), "note": run.note, "look": ""}
    # A moment of the video given back with other lines (tighter, longer) is to be cut again:
    # the app would else keep the cut it has
    sent = [m for part in video for m in part["moments"]]
    recut = 0
    for section in result["sections"]:
        for hit in section["hits"]:
            n = number.get(hit.get("job", job_id), 1)
            hit["recut"] = _other_lines(as_lines(lives[n - 1][1], hit["start"], hit["end"]), [m for m in sent if m.get("live", 1) == n])
            recut += hit["recut"]
    logger.info(f"[{job_id[:8]}] AI change: {recut} moments given with other lines")
    logger.info(f"[{job_id[:8]}] AI change \"{request[:60]}\": {sum(len(s['hits']) for s in result['sections'])} moments with {run.model} (~{cost:.4f} $, {run.seconds:.0f} s)")
    return {**result, "cached": False, "cost": round(cost, 4)}


def _sections(raw_sections, transcript: VodTranscript, duration: float, by_lines: bool = False,
              lives: list[tuple[str, VodTranscript, float]] | None = None) -> list[dict]:
    """The AI's sections as the app shows them: a title and hits, in playing order (the AI's, not the stream's);
    a moment given twice is kept once. `by_lines`: its moments name lines of the transcript (the AI with tools).
    `lives`: the video is made from several lives; each moment says which (`live`: 1, 2...) and its hit
    says that live's id (`job`)."""
    sections = []
    taken: list[tuple[float, float]] = []
    parse = parse_line_moments if by_lines else parse_moments

    def named(found: list[dict]) -> list[dict]:
        """The sections with the moment the AI marked as the one the video can open on (`opens`) said on its hit
        ("opening"): one at most, never the video's first moment (it would play twice in a row)."""
        marked = next((m for raw in raw_sections if isinstance(raw, dict) for m in (raw.get("moments") if isinstance(raw.get("moments"), list) else []) if isinstance(m, dict) and m.get("opens") is True), None) if isinstance(raw_sections, list) else None
        if not marked:
            return found
        try:
            n = int(marked.get("live") or 1)
        except (TypeError, ValueError):
            n = 1
        job, theirs, length = lives[n - 1] if lives and 1 <= n <= len(lives) else (None, transcript, duration)
        spot = parse([marked], theirs, length, limit=1, longest=MAX_PLANNED)
        hits = [hit for section in found for hit in section["hits"]]
        for hit in hits[1:] if spot else []:
            if hit.get("job") == job and min(hit["end"], spot[0].end) - max(hit["start"], spot[0].start) > 0.5 * min(hit["end"] - hit["start"], spot[0].end - spot[0].start):
                hit["opening"] = True
                break
        return found

    if lives:
        used: list[tuple[str, float, float]] = []
        for raw in raw_sections if isinstance(raw_sections, list) else []:
            if not isinstance(raw, dict):
                continue
            hits = []
            for moment in raw.get("moments", []) if isinstance(raw.get("moments"), list) else []:
                try:
                    n = int(moment.get("live") or 1) if isinstance(moment, dict) else 0
                except (TypeError, ValueError):
                    n = 0
                if not 1 <= n <= len(lives):
                    continue
                live, theirs, length = lives[n - 1]
                for hit in parse([moment], theirs, length, limit=1, longest=MAX_PLANNED):
                    if any(job == live and min(hit.end, b) - max(hit.start, a) > 0.5 * min(hit.end - hit.start, b - a) for job, a, b in used):
                        continue
                    used.append((live, hit.start, hit.end))
                    hits.append({**_complete([hit], theirs)[0], "job": live})
            if hits:
                sections.append({"title": str(raw.get("title") or "")[:60], "hits": hits[:60]})
        return named(sections)
    for raw in raw_sections if isinstance(raw_sections, list) else []:
        if not isinstance(raw, dict):
            continue
        hits = []
        for hit in parse(raw.get("moments", []), transcript, duration, limit=60, longest=MAX_PLANNED):
            if any(min(hit.end, b) - max(hit.start, a) > 0.5 * min(hit.end - hit.start, b - a) for a, b in taken):
                continue
            taken.append((hit.start, hit.end))
            hits.append(hit)
        if hits:
            sections.append({"title": str(raw.get("title") or "")[:60], "hits": _complete(hits, transcript)})
    return named(sections)


# ── The AI reads the whole live once (development command only) ──────────────


def _search_by_reading(job_id: str, query: str, meta: dict, duration: float, energy: list[float] | None, lag: float) -> dict:
    transcript, lines, chat = _reading(job_id, duration, energy, lag)
    path = _cache_path(job_id, "ai", " ".join(tokens(query)), _signature(transcript))
    kept = _cached(path)
    if kept:
        return {**kept, "cached": True, "cost": 0.0}
    answer = llm_text.complete(search_prompt(lines, chat, query, meta))
    hits = parse_moments(llm_text.parse_json(answer.text).get("moments", []), transcript, duration)
    hits.sort(key=lambda h: h.start)
    result = {"hits": _complete(hits, transcript), "total": len(hits), "transcript": True}
    _keep(path, result)
    logger.info(f"[{job_id[:8]}] AI search by reading \"{query[:60]}\": {len(hits)} moments (~{answer.cost:.3f} $, {answer.seconds:.0f} s)")
    return {**result, "cached": False, "cost": answer.cost}


def _plan_by_reading(job_id: str, brief: str, target: float, meta: dict, duration: float, energy: list[float] | None, lag: float) -> dict:
    transcript, lines, chat = _reading(job_id, duration, energy, lag)
    path = _cache_path(job_id, "plan", " ".join(tokens(brief)), f"{target:.0f}", _signature(transcript))
    kept = _cached(path)
    if kept:
        return {**kept, "cached": True, "cost": 0.0}
    answer = llm_text.complete(plan_prompt(lines, chat, brief, target, meta))
    data = llm_text.parse_json(answer.text)
    result = {"title": str(data.get("title") or "")[:80], "sections": _sections(data.get("sections"), transcript, duration)}
    _keep(path, result)
    total = sum(h["end"] - h["start"] for s in result["sections"] for h in s["hits"])
    logger.info(f"[{job_id[:8]}] AI plan by reading \"{brief[:60]}\": {len(result['sections'])} sections, {total:.0f} s for a target of {target:.0f} s (~{answer.cost:.3f} $)")
    return {**result, "cached": False, "cost": answer.cost}


# ── The AI cuts one clip ─────────────────────────────────────────────────────

CUT_LINE_GAP = 0.6
CUT_LINE_WORDS = 14


def clip_lines(words: list[dict]) -> list[str]:
    """A clip's words as "[start-end] sentence" lines (clip seconds), split where the speaker pauses."""
    lines: list[str] = []
    current: list[dict] = []
    for w in words:
        if current and (w["start"] - current[-1]["end"] >= CUT_LINE_GAP or len(current) >= CUT_LINE_WORDS or w.get("speaker") != current[-1].get("speaker")):
            lines.append(_clip_line(current))
            current = []
        current.append(w)
    if current:
        lines.append(_clip_line(current))
    return lines


def _clip_line(words: list[dict]) -> str:
    speaker = words[0].get("speaker")
    text = " ".join(str(w["word"]).strip() for w in words)
    return f"[{words[0]['start']:.1f}-{words[-1]['end']:.1f}] {f'{speaker}: ' if speaker else ''}{text}"


def cut_prompt(lines: list[str], clip_seconds: float, summary: str, current: list[list[float]], wish: str) -> str:
    now = ", ".join(f"{a:.1f}-{b:.1f}" for a, b in current) or "the whole clip"
    return f"""You are the editor of a Twitch streamer's short vertical videos (TikTok, Shorts, Reels). Below is everything said in one
clip of their stream ({clip_seconds:.0f} seconds long), one line per sentence with its start and end in seconds.
What happens in it: {summary or "(no summary)"}
The cut kept now: {now} seconds.

WORDS
{chr(10).join(lines)}

Choose the parts to keep so the video tells its story as tightly as possible: the context that is needed to get it, then the payoff
and the reaction. Take out dead air, repetitions, digressions and false starts. The parts play one after the other: the result must
still make sense. 1 to 5 parts, each at least 2 seconds; cut between sentences, never inside one; 15 to 45 seconds in all unless the
story needs more.{f" What the streamer asks for: {wish}" if wish else ""}
Answer with JSON only: {{"parts": [{{"start": seconds, "end": seconds}}], "note": "one short sentence in the clip's language on what you kept and why"}}"""


def suggest_cut(words: list[dict], clip_seconds: float, summary: str = "", current: list[list[float]] | None = None, wish: str = "") -> dict:
    """The parts of a clip worth keeping, for a tight video: [[start, end], ...] in clip seconds."""
    lines = clip_lines(words)
    if not lines:
        raise NoTranscript("clip")
    answer = llm_text.complete(cut_prompt(lines, clip_seconds, summary, current or [], wish), max_tokens=6000)
    data = llm_text.parse_json(answer.text)
    parts: list[list[float]] = []
    for raw in data.get("parts", []) if isinstance(data.get("parts"), list) else []:
        try:
            start, end = float(raw["start"]), float(raw["end"])
        except (KeyError, TypeError, ValueError):
            continue
        start, end = max(0.0, start - 0.15), min(clip_seconds, end + 0.25)
        if end - start >= 1.0:
            parts.append([round(start, 2), round(end, 2)])
    parts.sort()
    return {"parts": parts, "note": str(data.get("note") or "")[:240], "cost": answer.cost}
