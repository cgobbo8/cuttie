"""Chat analysis — multi-signal extraction from Twitch chat messages.

Extracts per time window:
- chat_speed: messages per second (raw activity)
- chat_burst: acceleration of chat activity (sudden spikes)
- caps_ratio: proportion of ALL CAPS messages (excitement marker)
- unique_ratio: unique chatters / total messages (broad engagement vs spam)
- emote_density: estimated emote/reaction density
"""

import re

import numpy as np

# Common Twitch emotes and reaction patterns
_EMOTE_PATTERNS = re.compile(
    r"\b(?:LUL|LULW|KEKW|PogChamp|Pog|PogU|OMEGALUL|monkaS|monkaW|"
    r"Kreygasm|PepeHands|Sadge|COPIUM|HOPIUM|Clap|EZ|GIGACHAD|"
    r"catJAM|HYPERS|PogBones|D:|FeelsBadMan|FeelsGoodMan|"
    r"ResidentSleeper|BibleThump|Jebaited|HeyGuys|VoHiYo|"
    r"WutFace|NotLikeThis|TriHard|CoolStoryBob|4Head|"
    r"xdd*|mdr+|lol+|haha+|ptdr+|rofl+|lmao+|omg+|wtf+|gg|ez)\b",
    re.IGNORECASE,
)

# Bot usernames to filter out
_BOT_NAMES = {
    "streamelements", "nightbot", "streamlabs", "moobot",
    "fossabot", "wizebot", "sery_bot", "soundalerts",
}


def analyze_chat(
    messages: list[dict],
    total_duration: float,
    window_sec: float = 5.0,
    hop_sec: float = 2.5,
) -> list[dict]:
    """Compute multi-dimensional chat features per time window.

    Returns a list of dicts aligned to the audio analyzer's time grid.
    """
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

        # Unique chatters ratio (1.0 = all unique, low = spam)
        if count > 1:
            unique_authors = len(set(authors[i] for i in indices))
            unique_ratio = unique_authors / count
        else:
            unique_ratio = 1.0 if count == 1 else 0.0

        # Emote density (emotes per message)
        emote_density = float(np.mean(emote_counts[indices])) if count > 0 else 0.0

        # Burst: acceleration (change in speed vs previous window)
        burst = max(0.0, speed - prev_count)
        prev_count = speed

        windows.append({
            "time": t,
            "chat_speed": speed,
            "chat_burst": burst,
            "caps_ratio": caps,
            "unique_ratio": unique_ratio,
            "emote_density": emote_density,
        })
        t += hop_sec

    return windows
