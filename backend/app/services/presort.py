"""The AI reads the whole live and points at the moments worth a clip.

The audio peaks miss what's said calmly: a punchline, a roleplay payoff, an
absurd exchange. One text-only call reads the live's transcript (one line per
~20 s) and the chat's high points, and proposes moments; they join the
candidates the heuristics found. About 0.05 $ for a 7-hour live.
"""

import json
import logging
import re
import statistics
from dataclasses import dataclass

from app.services.chat_analyzer import _BOT_NAMES, CLIP_REQUEST
from app.services.openai_client import LLM_MODEL, get_openrouter_client
from app.services.vod_transcript import VodTranscript

logger = logging.getLogger(__name__)

MAX_MOMENTS = 40
LINE_SECONDS = 20.0
# Viewers clip the reaction, just after the moment: candidate windows get room
# before the setup and after the payoff (the LLM then picks the cut inside)
PRE_MARGIN, POST_MARGIN = 10.0, 20.0
MIN_SECONDS, MAX_SECONDS = 15.0, 120.0
CHAT_PEAKS = 30


@dataclass
class PresortMoment:
    start: float
    end: float
    score: float  # 0-1, how strong a clip the AI thinks it is
    why: str


def hms(seconds: float) -> str:
    s = int(max(0.0, seconds))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


def parse_hms(value) -> float | None:
    """"1:23:45", "23:45" or seconds -> seconds."""
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    parts = value.strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    seconds = 0.0
    for n in nums:
        seconds = seconds * 60 + n
    return seconds


def transcript_lines(transcript: VodTranscript, line_seconds: float = LINE_SECONDS) -> list[str]:
    """The live as "[H:MM:SS] what's said" lines of about `line_seconds` each."""
    lines: list[str] = []
    current: list[str] = []
    line_start: float | None = None
    for start, _end, text in transcript.segments:
        text = text.strip()
        if not text:
            continue
        if line_start is not None and start - line_start >= line_seconds and current:
            lines.append(f"[{hms(line_start)}] {' '.join(current)}")
            current, line_start = [], None
        if line_start is None:
            line_start = start
        current.append(text)
    if current and line_start is not None:
        lines.append(f"[{hms(line_start)}] {' '.join(current)}")
    return lines


def chat_highlights(messages: list[dict], lag: float = 5.0) -> list[str]:
    """Minutes when the chat speeds up, and viewers asking for a clip (times
    moved back by the chat's lag, onto the stream)."""
    per_minute: dict[int, list[str]] = {}
    requests: list[str] = []
    for m in messages:
        t = float(m.get("timestamp", m.get("offset", 0.0))) - lag
        text = str(m.get("text") or m.get("message") or "").strip()
        if t < 0 or not text or str(m.get("author", "")).lower() in _BOT_NAMES:
            continue
        per_minute.setdefault(int(t // 60), []).append(text)
        if CLIP_REQUEST.search(text):
            requests.append(f"[{hms(t)}] a viewer asks for a clip: \"{text[:60]}\"")
    if not per_minute:
        return requests
    median = statistics.median(len(v) for v in per_minute.values())
    peaks = [(minute, texts) for minute, texts in per_minute.items() if len(texts) >= max(5, 3 * median)]
    peaks = sorted(peaks, key=lambda p: -len(p[1]))[:CHAT_PEAKS]
    lines = [
        f"[{hms(minute * 60)}] {len(texts)} chat messages this minute, e.g. " + " | ".join(t[:40] for t in texts[:3])
        for minute, texts in sorted(peaks)
    ]
    return lines + requests


def build_prompt(lines: list[str], chat: list[str], vod_meta: dict, max_moments: int = MAX_MOMENTS) -> str:
    streamer = vod_meta.get("streamer") or "the streamer"
    return f"""You are the best short-form clip editor for Twitch streamers. Below is the full transcript of a live stream by {streamer}
(game: {vod_meta.get("game") or "?"}, title: "{vod_meta.get("title") or ""}"), one line per ~20 seconds, and the moments when
the chat reacted. Your job: point at the moments that would make the best standalone vertical clips (TikTok, Shorts, Reels).

What makes a great clip here:
- a punchline, a roleplay payoff, an absurd or awkward exchange, a running gag landing, a big reaction, a fail, a clutch,
  an emotional beat, a chat explosion, the streamer or the chat asking for a clip
- it works on its own in 15 to 60 seconds, without knowing the rest of the stream
- many great moments are said calmly: don't only look for shouting; read what is actually said and how people react

Avoid: starting soon / break screens, long monologues without a payoff, moments that need too much context.
Chat reacts about 5 seconds after the stream; its times below are already moved back onto the stream.

Give up to {max_moments} moments, the strongest first, spread over the whole stream. Each window starts a few seconds
before the setup and ends after the payoff or the reaction, 20 to 90 seconds long. Times as H:MM:SS from the transcript.
Answer with JSON only:
{{"moments": [{{"start": "H:MM:SS", "end": "H:MM:SS", "score": 0-100, "why": "short reason, in the stream's language"}}]}}

CHAT HIGH POINTS
{chr(10).join(chat) if chat else "(quiet chat)"}

TRANSCRIPT
{chr(10).join(lines)}"""


def parse_moments(content: str, duration: float, max_moments: int = MAX_MOMENTS) -> list[PresortMoment]:
    """The AI's answer as moments: valid windows only, overlaps merged into the stronger one."""
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    match = re.search(r"\{.*\}", content, re.DOTALL)
    data = json.loads(match.group(0) if match else content)
    moments: list[PresortMoment] = []
    for raw in data.get("moments", []):
        start, end = parse_hms(raw.get("start")), parse_hms(raw.get("end"))
        if start is None or end is None:
            continue
        start, end = max(0.0, start), min(duration, end)
        if end - start < MIN_SECONDS:
            # Too short: around its middle
            middle = (start + end) / 2
            start, end = max(0.0, middle - MIN_SECONDS), min(duration, middle + MIN_SECONDS)
        if end - start > MAX_SECONDS or end <= start:
            end = min(duration, start + MAX_SECONDS)
        try:
            score = max(0.0, min(1.0, float(raw.get("score", 50)) / 100))
        except (TypeError, ValueError):
            score = 0.5
        moments.append(PresortMoment(start, end, score, str(raw.get("why", ""))[:200]))
    moments.sort(key=lambda m: -m.score)
    kept: list[PresortMoment] = []
    for m in moments:
        if all(min(m.end, k.end) - max(m.start, k.start) < 0.5 * min(m.end - m.start, k.end - k.start) for k in kept):
            kept.append(m)
    return kept[:max_moments]


def window(moment: PresortMoment, duration: float) -> tuple[float, float]:
    """The candidate window of a moment: with room before and after."""
    return max(0.0, moment.start - PRE_MARGIN), min(duration, moment.end + POST_MARGIN)


def presort(
    transcript: VodTranscript,
    chat_messages: list[dict],
    vod_meta: dict,
    duration: float,
    chat_lag: float = 5.0,
) -> list[PresortMoment]:
    """Moments the AI proposes after reading the whole live (OpenRouter errors propagate)."""
    lines = transcript_lines(transcript)
    if not lines:
        return []
    prompt = build_prompt(lines, chat_highlights(chat_messages, chat_lag), vod_meta)
    response = get_openrouter_client().chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.4,
        # Gemini's thinking tokens count toward this limit
        max_completion_tokens=20000,
    )
    content = response.choices[0].message.content or ""
    moments = parse_moments(content, duration)
    usage = getattr(response, "usage", None)
    logger.info(
        f"Pre-sort: {len(moments)} moments from {len(lines)} transcript lines "
        f"({getattr(usage, 'prompt_tokens', '?')} tokens in, {getattr(usage, 'completion_tokens', '?')} out)"
    )
    return moments
