"""Chat analysis — multi-signal extraction from Twitch chat messages.

Extracts per time window:
- chat_speed: messages per second (raw activity)
- chat_burst: acceleration of chat activity (sudden spikes)
- caps_ratio: proportion of ALL CAPS messages (excitement marker)
- unique_ratio: unique chatters / total messages (broad engagement vs spam)
- emote_density: estimated emote/reaction density
- sentiment_hype: semantic score for hype/skill moments (PogChamp, GG, etc.)
- sentiment_fun: semantic score for humor/fail moments (KEKW, LUL, etc.)
- sentiment_rip: semantic score for death/sadness moments (F, RIP, etc.)
- sentiment_intensity: overall emotional intensity (max of all sentiments)
- dominant_mood: the dominant mood label for this window
"""

import re
from collections import Counter

import numpy as np

# ──────────────────────────────────────────────────────
# Semantic mood dictionaries
# Each entry: word/emote → weight (higher = stronger signal)
# ──────────────────────────────────────────────────────

_MOOD_HYPE = {
    # Emotes
    "pogchamp": 1.0, "pog": 0.9, "pogu": 0.9, "poggers": 0.9,
    "hypers": 1.0, "gigachad": 0.8, "clap": 0.7, "ez": 0.6,
    "feelsgoodman": 0.7, "kreygasm": 0.8, "catjam": 0.6,
    "pogbones": 0.8, "popoff": 0.9,
    # Keywords (FR + EN)
    "gg": 0.7, "wp": 0.5, "insane": 0.9, "clutch": 1.0,
    "clean": 0.7, "godlike": 1.0, "goated": 0.9, "cracked": 0.9,
    "let's go": 0.8, "lets go": 0.8, "goooo": 0.8,
    "incroyable": 0.9, "enorme": 0.8, "trop fort": 0.9,
    "bien joue": 0.7, "bravo": 0.6, "magnifique": 0.8,
    "propre": 0.7, "monstre": 0.8, "dingue": 0.8,
}

_MOOD_FUN = {
    # Emotes
    "lul": 0.8, "lulw": 0.9, "kekw": 1.0, "omegalul": 1.0,
    "4head": 0.7, "jebaited": 0.8, "coolstorybob": 0.6,
    "pepega": 0.8, "kappa": 0.5, "trihard": 0.5,
    # Keywords (FR + EN)
    "lol": 0.7, "lmao": 0.8, "rofl": 0.8, "xd": 0.7, "xdd": 0.8,
    "mdr": 0.8, "ptdr": 0.9, "haha": 0.6, "hihi": 0.5,
    "mort de rire": 0.9, "jsuis mort": 0.9, "je suis mort": 0.9,
    "nul": 0.5, "clown": 0.7, "boulet": 0.6,
    "fail": 0.7, "noob": 0.6, "oof": 0.6,
}

_MOOD_RIP = {
    # Emotes
    "pepehands": 0.9, "sadge": 0.9, "biblethump": 0.8,
    "feelsbadman": 0.8, "notlikethis": 0.9, "wutface": 0.7,
    "monkas": 0.7, "monkaw": 0.8, "copium": 0.6,
    # Keywords (FR + EN)
    "f": 0.8, "rip": 0.9, "oof": 0.5, "noooo": 0.8, "nooo": 0.7,
    "aie": 0.6, "ouch": 0.6, "dead": 0.7,
    "c'est fini": 0.7, "pas possible": 0.7, "oh non": 0.8,
}

# Compile patterns for fast matching (word boundaries, case-insensitive)
def _build_pattern(mood_dict: dict) -> list[tuple[re.Pattern, float]]:
    patterns = []
    for word, weight in mood_dict.items():
        # Escape special regex chars and allow flexible matching
        escaped = re.escape(word)
        # For single-char like "f", require it to be standalone
        if len(word) == 1:
            pat = re.compile(rf"^{escaped}$", re.IGNORECASE)
        else:
            pat = re.compile(rf"\b{escaped}\b", re.IGNORECASE)
        patterns.append((pat, weight))
    return patterns

_HYPE_PATTERNS = _build_pattern(_MOOD_HYPE)
_FUN_PATTERNS = _build_pattern(_MOOD_FUN)
_RIP_PATTERNS = _build_pattern(_MOOD_RIP)

# General emote detection (for emote_density)
_EMOTE_PATTERNS = re.compile(
    r"\b(?:LUL|LULW|KEKW|PogChamp|Pog|PogU|OMEGALUL|monkaS|monkaW|"
    r"Kreygasm|PepeHands|Sadge|COPIUM|HOPIUM|Clap|EZ|GIGACHAD|"
    r"catJAM|HYPERS|PogBones|D:|FeelsBadMan|FeelsGoodMan|"
    r"ResidentSleeper|BibleThump|Jebaited|HeyGuys|VoHiYo|"
    r"WutFace|NotLikeThis|TriHard|CoolStoryBob|4Head|Pepega|Kappa|"
    r"xdd*|mdr+|lol+|haha+|ptdr+|rofl+|lmao+|omg+|wtf+|gg|ez)\b",
    re.IGNORECASE,
)

# Bot usernames to filter out
_BOT_NAMES = {
    "streamelements", "nightbot", "streamlabs", "moobot",
    "fossabot", "wizebot", "sery_bot", "soundalerts",
}


def _score_mood(text: str, patterns: list[tuple[re.Pattern, float]]) -> float:
    """Score a message against a mood's patterns. Returns max matched weight."""
    best = 0.0
    for pat, weight in patterns:
        if pat.search(text):
            best = max(best, weight)
    return best


def _compute_message_sentiments(texts: list[str]) -> dict[str, np.ndarray]:
    """Pre-compute per-message sentiment scores for all moods."""
    n = len(texts)
    hype = np.zeros(n)
    fun = np.zeros(n)
    rip = np.zeros(n)

    for i, text in enumerate(texts):
        hype[i] = _score_mood(text, _HYPE_PATTERNS)
        fun[i] = _score_mood(text, _FUN_PATTERNS)
        rip[i] = _score_mood(text, _RIP_PATTERNS)

    return {"hype": hype, "fun": fun, "rip": rip}


def analyze_chat(
    messages: list[dict],
    total_duration: float,
    window_sec: float = 5.0,
    hop_sec: float = 2.5,
) -> list[dict]:
    """Compute multi-dimensional chat features per time window."""
    if not messages or total_duration <= 0:
        return []

    # Filter out bots
    filtered = [m for m in messages if m.get("author", "").lower() not in _BOT_NAMES]
    if not filtered:
        return []

    timestamps = np.array([m["timestamp"] for m in filtered])
    texts = [m.get("text", "") for m in filtered]
    authors = [m.get("author", "") for m in filtered]

    # Pre-compute per-message features
    is_caps = np.array([
        1.0 if len(t) > 3 and t == t.upper() and any(c.isalpha() for c in t) else 0.0
        for t in texts
    ])
    emote_counts = np.array([
        len(_EMOTE_PATTERNS.findall(t)) for t in texts
    ])
    sentiments = _compute_message_sentiments(texts)

    # Build windows matching audio analyzer's grid
    windows = []
    prev_count = 0.0
    t = 0.0
    while t + window_sec <= total_duration:
        mask = (timestamps >= t) & (timestamps < t + window_sec)
        indices = np.where(mask)[0]
        count = len(indices)

        speed = count / window_sec

        # Caps ratio
        caps = float(np.mean(is_caps[indices])) if count > 0 else 0.0

        # Unique chatters ratio
        if count > 1:
            unique_authors = len(set(authors[i] for i in indices))
            unique_ratio = unique_authors / count
        else:
            unique_ratio = 1.0 if count == 1 else 0.0

        # Emote density (emotes per message)
        emote_density = float(np.mean(emote_counts[indices])) if count > 0 else 0.0

        # Burst: acceleration
        burst = max(0.0, speed - prev_count)
        prev_count = speed

        # Semantic sentiment scores (mean of best match per message)
        # These are BONUS signals: 0 when no emotes/keywords → no penalty
        sentiment_hype = float(np.mean(sentiments["hype"][indices])) if count > 0 else 0.0
        sentiment_fun = float(np.mean(sentiments["fun"][indices])) if count > 0 else 0.0
        sentiment_rip = float(np.mean(sentiments["rip"][indices])) if count > 0 else 0.0

        # Overall emotional intensity = max of all sentiments
        sentiment_intensity = max(sentiment_hype, sentiment_fun, sentiment_rip)

        # Dominant mood label
        mood_scores = {"hype": sentiment_hype, "fun": sentiment_fun, "rip": sentiment_rip}
        dominant_mood = max(mood_scores, key=mood_scores.get) if sentiment_intensity > 0.1 else ""

        windows.append({
            "time": t,
            "chat_speed": speed,
            "chat_burst": burst,
            "caps_ratio": caps,
            "unique_ratio": unique_ratio,
            "emote_density": emote_density,
            "sentiment_hype": sentiment_hype,
            "sentiment_fun": sentiment_fun,
            "sentiment_rip": sentiment_rip,
            "sentiment_intensity": sentiment_intensity,
            "dominant_mood": dominant_mood,
        })
        t += hop_sec

    return windows
