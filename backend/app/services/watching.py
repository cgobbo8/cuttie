"""Moments where the picture is the moment and the words say little.

The analysis rates its candidates on their words before any picture is looked at (the step from
200 candidates to 50): a scene that plays out in front of a streamer who only says "what the
fuck" never reached the model that sees. Whatever the game: one where the streamer watches more
than they act loses its best moments there.

Two steps:

1. `find_leads`: free signs that something is seen rather than said, from what the analysis
   already has on the live: a short stunned line after the streamer said little, a loud sound of
   the game (a crash, an explosion, shots, a scream) with few words on it, people laughing or
   gasping with no joke said, the chat writing all at once. Signs that fall together are one lead.
   They are many and mostly nothing: on a 4 h live, some 60 leads for 4 real moments.
2. `look`: three pictures of each lead (the scene comes before the reaction: 5 s and 1 s before
   it, 3 s after) shown to the small model that sees, a few leads per call. It says what happens
   on screen, the streamer's face, the words written on the screen (the subtitles of a cutscene,
   a message: it reads them on a 480p picture) and how much the scene is worth watching.

`watch` does both and returns the leads worth watching, the strongest first. The analysis gives
them places among the moments its multimodal model rates (see llm_analyzer), with what was seen.

Measured on a real live (GTA 6 story mode, 4 h 10, 23/11/2026, two passes for 0.029 $ in all):
0.00033 $ a lead. Scenes it brought out, checked by eye on the pictures: the character walks out
of a seaplane into its propeller (rated 65 then 85), walks in on a couple (60), dies for the
first time while the streamer laughs (65 then 60), a character frozen in a T in the middle of the
road during a fight (40 then 85). Rated as high and not clips: a chase at sunset, shots from a
helicopter. Its rating moves from one pass to the next, and it rates low: 85 was its highest.
"""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from app.services.vod_transcript import VodTranscript

logger = logging.getLogger(__name__)

# How many leads are looked at (a third of a thousandth of a dollar each: 2.4 cents at most), and how many per call
MAX_LEADS = 72
PER_CALL = 6
# Where the three pictures are taken around a lead: the scene comes before the reaction
OFFSETS = (-5.0, -1.0, 3.0)
# From how much a lead is worth a place among the rated moments (the model rates low: 65 was its
# highest on the live it was tried on), and how many get one
WATCH_FLOOR = 55
MAX_PICKS = 8
# The window of a moment found by looking: the scene, a little of what leads to it, the reaction
BEFORE, AFTER = 25.0, 20.0

# Sounds of a game that say something happens on screen
EVENTS = ("crash", "explosion", "gunfire", "scream", "skid")
EVENT_FLOOR = 0.3
# People laughing or gasping: a sign when nearly nothing is said around it
REACTIONS = ("laughter", "gasp")
REACTION_FLOOR = 0.35
# A short line after the streamer said little: they were watching
SHORT_LINE = 6
QUIET_SECONDS = 15.0
QUIET_WORDS = 10
# Signs this close are the same moment
TOGETHER = 12.0
APART = 25.0

# What someone taken aback says (fr, en, es). Not a rule of what a moment is: it only says where to look.
STUNNED = re.compile(
    r"what the|wtf|\bwhat\b|\bwhoa\b|oh my god|\bomg\b|no way|\bholy\b|"
    r"c'est quoi (ça|ce|cette|le|la|l')|qu'est[- ]ce qu|il fait quoi|elle fait quoi|ils font quoi|il se passe quoi|"
    r"mais (non|quoi|wesh|attends?|qu')|non mais|nan mais|\bhein\b|j'hallucine|je r[êe]ve|pas possible|"
    r"oh (putain|la vache|merde|non|l[àa]|mon dieu|wow|punaise|purée)|\bputain\b|\bwow\b|waouh|\bouah\b|oul[aà]|oh là là|"
    r"c'est une blague|s[ée]rieux|rien compris|t'as vu|vous avez vu|regarde[z]? (ça|moi ça)|il est (fou|malade)|pourquoi il|comment ça|d'où (il|ça)|"
    r"\bquoi\s*\??$|qu[ée] es eso|no puede ser|madre m[íi]a|\bjoder\b|\bhostia\b|dios m[íi]o",
    re.I,
)


@dataclass
class Lead:
    """A place of the live where something says the picture matters."""

    at: float  # live seconds: the strongest sign (the reaction, the sound)
    signs: list[str] = field(default_factory=list)  # "stunned", "sound", "laughter", "gasp", "chat"
    said: str = ""  # what is said around it
    strength: float = 0.0


@dataclass
class Seen:
    """What the model that sees says of a lead."""

    at: float
    seen: str = ""
    face: str = ""
    text: str = ""  # the words written on the screen that matter
    watch: int = 0  # 0-100: how much the scene is worth watching
    signs: list[str] = field(default_factory=list)


def _words_between(lines: list[tuple[float, float, str]], start: float, end: float) -> int:
    return sum(len(text.split()) for s, e, text in lines if e > start and s < end)


def find_leads(transcript: VodTranscript | None, sounds, chat: list[dict], lag: float, duration: float, limit: int = MAX_LEADS) -> list[Lead]:
    """The places worth a look, the strongest first (`sounds`: the live's sound index, or None)."""
    lines = [(s, e, t.strip()) for s, e, t in (transcript.segments if transcript else []) if t.strip()]
    signs: list[tuple[float, str, float]] = []  # when, which, how strong

    if sounds is not None:
        import numpy as np

        def tops(columns: list, floor: float, most: int) -> list[tuple[float, float]]:
            """The strongest distinct seconds of these sounds: (when, how sure)."""
            if not columns:
                return []
            best = np.max(np.stack(columns, axis=1), axis=1)
            taken: list[tuple[float, float]] = []
            for i in np.argsort(-best):
                if best[i] < floor or len(taken) >= most:
                    break
                at = float(i) * sounds.hop
                if all(abs(at - other) >= APART for other, _score in taken):
                    taken.append((at, float(best[i])))
            return taken

        # Something loud in the game: stronger when few words are said on it
        for at, score in tops([sounds._column(g) for g in EVENTS if g in sounds.groups], EVENT_FLOOR, 120):
            signs.append((at, "sound", score + (0.3 if _words_between(lines, at - 4, at + 6) <= 8 else 0.0)))
        # Laughter or a gasp with nearly nothing said: the joke is not in the words
        for kind in REACTIONS:
            if kind in sounds.groups:
                for at, score in tops([sounds._column(kind)], REACTION_FLOOR, 60):
                    if _words_between(lines, at - 6, at + 4) <= QUIET_WORDS:
                        signs.append((at, kind, score + 0.2))

    # A short stunned line after little was said
    for start, _end, text in lines:
        if len(text.split()) <= SHORT_LINE and STUNNED.search(text):
            before = _words_between(lines, start - QUIET_SECONDS, start - 0.5)
            if before <= QUIET_WORDS:
                # (the less was said before it, the more they were watching)
                signs.append((start, "stunned", 0.6 + 0.3 * (1 - before / QUIET_WORDS)))

    # The chat writing all at once (a small chat never does: nothing then)
    if chat:
        from app.services import live_search

        for peak in live_search.chat_peaks(chat, lag, duration):
            # (a peak starts a few seconds before what the chat reacts to: the lead is that instant on the stream)
            signs.append((float(peak["start"]) + live_search.CHAT_BEFORE, "chat", 0.8))

    # Signs that fall together are one lead, at its strongest sign (the reaction follows the scene:
    # of two as strong, the later). Two kinds of signs agreeing count for more than either.
    signs.sort()
    groups: list[list[tuple[float, str, float]]] = []
    for sign in signs:
        if groups and sign[0] - groups[-1][-1][0] < TOGETHER:
            groups[-1].append(sign)
        else:
            groups.append([sign])
    leads: list[Lead] = []
    for group in groups:
        strongest = max(group, key=lambda sign: (sign[2], sign[0]))
        kinds = sorted({kind for _at, kind, _strength in group})
        at = min(max(0.0, strongest[0]), max(0.0, duration - 1.0)) if duration else strongest[0]
        said = " / ".join(text for s, _e, text in lines if at - 12 <= s <= at + 10)[:220]
        leads.append(Lead(at=round(at, 1), signs=kinds, said=said, strength=round(strongest[2] + 0.5 * (len(kinds) - 1), 2)))
    # Too many to look at them all: those two kinds of signs agree on first, then a reaction and a sound of the
    # game in turn, the strongest of each first. (By strength alone the shots of a shooting game, 0.9 each, took
    # every place: the scene of a live it was tried on was a short line said after 8 words, left out.)
    leads.sort(key=lambda lead: -lead.strength)
    agreed = [lead for lead in leads if len(lead.signs) > 1]
    reactions = [lead for lead in leads if len(lead.signs) == 1 and lead.signs[0] != "sound"]
    heard = [lead for lead in leads if lead.signs == ["sound"]]
    chosen = agreed[:limit]
    for i in range(max(len(reactions), len(heard))):
        chosen += reactions[i:i + 1] + heard[i:i + 1]
    return chosen[:limit]


ASK = """You are helping a clip editor go through a Twitch live stream of a video game{game}. For each numbered moment below you get 3 images
a few seconds apart, in order (the streamer's webcam may show in a corner), and the few words said around it.
These are moments where the streamer says little: the question is whether what is ON SCREEN is the moment.
For each one, answer with what you see only:
- "seen": one or two sentences: what happens on screen (the game, a cutscene, a menu, a crash, a fight, a character doing something odd...)
- "face": the streamer's face in the webcam if it shows (laughing, stunned, neutral, not visible)
- "text": the words written on screen that matter (subtitles of a cutscene, a message, a sign), copied as they are, 150 characters at most; "" when none
- "watch": 0-100, how much a viewer scrolling short videos would want to SEE this: 0-20 ordinary play or a menu, 40-60 something
  happens but nothing special, 70-100 absurd, spectacular, shocking or very funny to look at even without sound
Answer with JSON only: {{"moments": [{{"n": 1, "seen": "...", "face": "...", "text": "...", "watch": 0}}]}}"""


def _clock(seconds: float) -> str:
    t = int(seconds)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


def look(leads: list[Lead], video_url: str, game: str | None = None, client=None, fetch=None) -> tuple[list[Seen], float]:
    """Each lead looked at by the model that sees: (what it says of each, what it cost).
    A call that fails is skipped (its leads are not looked at); a provider refusing for good
    (credits, key) stops the analysis like everywhere else."""
    from app.services import llm_text
    from app.services.live_agent import EYES_MODEL, fetch_frames
    from app.services.looks import _cost
    from app.services.provider_errors import stop_if_fatal

    if client is None:
        from app.services.openai_client import get_openrouter_client

        client = get_openrouter_client()
    fetch = fetch or fetch_frames
    seen: list[Seen] = []
    cost = 0.0
    ask = ASK.format(game=f" ({game})" if game else "")
    for first in range(0, len(leads), PER_CALL):
        group = leads[first:first + PER_CALL]
        content: list[dict] = [{"type": "text", "text": ask}]
        shown: dict[int, Lead] = {}
        # (the pictures of a call fetched together: one lead after the other took 2 s each)
        with ThreadPoolExecutor(max_workers=PER_CALL) as pool:
            pictures = list(pool.map(lambda lead: fetch(video_url, [max(0.0, lead.at + offset) for offset in OFFSETS]), group))
        for n, (lead, frames) in enumerate(zip(group, pictures), first + 1):
            if len(frames) < 2:
                continue  # this part of the live could not be fetched
            shown[n] = lead
            content.append({"type": "text", "text": f"Moment {n} (at {_clock(lead.at)}). Said around it: {lead.said or '(nothing)'}"})
            content += [{"type": "image_url", "image_url": {"url": frame, "detail": "low"}} for frame in frames]
        if not shown:
            continue
        try:
            response = client.chat.completions.create(
                model=EYES_MODEL,
                messages=[{"role": "user", "content": content}],
                temperature=0.2,
                max_tokens=3000,
                timeout=120,
                extra_body={"usage": {"include": True}},
            )
        except Exception as e:
            stop_if_fatal(e)
            logger.warning(f"Watching: {len(shown)} leads not looked at: {type(e).__name__}: {e}")
            continue
        cost += _cost(response)
        try:
            answers = llm_text.parse_json(response.choices[0].message.content or "").get("moments", [])
        except Exception:
            answers = []
        if not answers:
            # (tried for real with half the room to answer: 2 calls of 8 came back unreadable, 12 leads never looked at, and nothing said so)
            logger.warning(f"Watching: the answer about {len(shown)} leads could not be read (finish: {getattr(response.choices[0], 'finish_reason', '?')})")
        for answer in answers if isinstance(answers, list) else []:
            if not isinstance(answer, dict):
                continue
            try:
                lead = shown.get(int(answer.get("n")))
                watch = int(float(answer.get("watch") or 0))
            except (TypeError, ValueError):
                continue
            if lead is None:
                continue
            seen.append(Seen(
                at=lead.at,
                seen=str(answer.get("seen") or "").strip()[:400],
                face=str(answer.get("face") or "").strip()[:60],
                text=str(answer.get("text") or "").strip()[:300],
                watch=max(0, min(100, watch)),
                signs=lead.signs,
            ))
    return seen, cost


def picks(seen: list[Seen], floor: int = WATCH_FLOOR, most: int = MAX_PICKS) -> list[Seen]:
    """The leads worth a place among the rated moments, the most worth watching first."""
    worth = sorted((s for s in seen if s.watch >= floor and s.seen), key=lambda s: -s.watch)
    kept: list[Seen] = []
    for s in worth:
        # (two leads of the same scene: one place)
        if all(abs(s.at - other.at) >= APART for other in kept):
            kept.append(s)
    return kept[:most]


def window(moment: Seen, duration: float) -> tuple[float, float]:
    """The passage of the live a moment found by looking is rated on."""
    end = moment.at + AFTER
    return max(0.0, moment.at - BEFORE), min(duration, end) if duration else end


def watch(transcript: VodTranscript | None, sounds, chat: list[dict], lag: float, duration: float, video_url: str, game: str | None = None, client=None, fetch=None) -> list[Seen]:
    """The moments of the live worth watching where little is said, the strongest first."""
    leads = find_leads(transcript, sounds, chat, lag, duration)
    if not leads or not video_url:
        return []
    t0 = time.time()
    seen, cost = look(leads, video_url, game, client=client, fetch=fetch)
    kept = picks(seen)
    logger.info(
        f"Watching: {len(leads)} leads, {len(seen)} looked at in {time.time() - t0:.0f} s for ~{cost:.4f} $, {len(kept)} worth watching"
        + (": " + "; ".join(f"{_clock(s.at)} ({s.watch}) {s.seen[:70]}" for s in kept) if kept else "")
    )
    return kept


def told(moment: Seen, at_second: float | None = None) -> str:
    """What was seen, as the model that rates the moment is told it."""
    where = f" at about {at_second:.0f}s" if at_second is not None else ""
    lines = [f"A first look at three pictures of this moment{where} saw: {moment.seen}"]
    if moment.face and moment.face.lower() not in ("neutral", "not visible"):
        lines.append(f"The streamer's face then: {moment.face}.")
    if moment.text:
        lines.append(f'Written on screen: "{moment.text}"')
    return "\n".join(lines)
