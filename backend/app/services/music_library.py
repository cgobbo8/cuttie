"""A background music as the app knows it: what is measured on it (how long, how fast, how loud,
where it is in full swing) and what it sounds like to a model that hears it.

Used when the streamer adds a track of their own (the API keeps the result in its catalogue,
where they can correct it), and to describe the tracks that ship with the app
(scripts/make-musics.py --listen).
"""

import base64
import logging
import os
import re
import subprocess
import tempfile

from app.services import llm_text, paths

logger = logging.getLogger(__name__)

KINDS = {
    "funny": "jokes, fails, absurd or silly moments",
    "skill": "kills, clutch plays, action where the game is the show",
    "suspense": "tension, fear, something that builds up slowly",
    "chill": "people talking, stories being told, calm role-play",
    "hype": "a best-of, highlights of an evening, energy",
}
LANGUAGES = {"fr": "French", "en": "English", "es": "Spanish"}
# What is sent to the ears: its main part, then a later part (a track can change)
MAIN_SECONDS = 24.0
LATER_SECONDS = 14.0


def measure(path: str) -> dict:
    """{"seconds", "bpm", "start", "lufs"}: how long the track is, its tempo, where it is in full
    swing (a video starts it there, on a beat) and how loud it was recorded."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    if len(y) < sr:
        raise ValueError("this file has less than a second of sound")
    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    per_second = sr / hop
    window = max(1, int(per_second))
    # How loud each second-long stretch is: "in full swing" is near the loudest tenth of them
    energy = np.convolve(rms**2, np.ones(window) / window, mode="valid")
    full = float(np.percentile(energy, 90))
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, units="time")
    if energy[: max(1, int(0.5 * per_second))].mean() >= 0.5 * full:
        start = max(0.0, float(onsets[0]) - 0.02) if len(onsets) else 0.0
    else:
        at = int(np.argmax(energy >= 0.8 * full)) / per_second
        start = max(0.0, float(beat_times[np.abs(beat_times - at).argmin()]) - 0.02) if len(beat_times) else at
    seconds = len(y) / sr
    # Never so late that little of the track is left to play
    if start > seconds * 0.6:
        start = 0.0
    printed = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, timeout=300).stderr
    found = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", printed)
    lufs = float(found[-1]) if found else -14.0
    return {"seconds": round(seconds, 1), "bpm": round(float(np.atleast_1d(tempo)[0])), "start": round(start, 2), "lufs": max(-40.0, min(0.0, lufs))}


def to_mp3(source: str, target: str) -> None:
    """The track as the app keeps it: stereo MP3 at 128 kb/s, nothing else in the file."""
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", source, "-map", "0:a:0", "-map_metadata", "-1", "-ac", "2", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", target],
        check=True, timeout=600, capture_output=True,
    )


def excerpt(path: str, start: float, seconds: float) -> str:
    """A part of the track as a small mono MP3, base64."""
    os.makedirs(paths.WORK_DIR, exist_ok=True)
    fd, out = tempfile.mkstemp(suffix=".mp3", dir=paths.WORK_DIR)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-ss", f"{start:.2f}", "-t", f"{seconds:.2f}", "-i", path, "-vn", "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", out],
            check=True, timeout=120, capture_output=True,
        )
        with open(out, "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")
    finally:
        os.unlink(out)


def listen(path: str, measured: dict, language: str = "fr", client=None, hint: str = "") -> dict:
    """What the track sounds like and what it is for, from a model that hears two parts of it:
    {"genre", "kinds", "description" (for the streamer, in their language), "about" (in English, for
    the model that will choose a music without hearing it), "cost"}."""
    from app.services.live_agent import EARS_MODEL
    from app.services.provider_errors import stop_if_fatal

    if client is None:
        from app.services.openai_client import get_openrouter_client

        client = get_openrouter_client()
    seconds = float(measured.get("seconds") or 0)
    start = float(measured.get("start") or 0)
    later = max(start + MAIN_SECONDS, min(seconds - LATER_SECONDS - 2, seconds * 0.65))
    parts = [excerpt(path, start, MAIN_SECONDS)]
    if later + LATER_SECONDS < seconds:
        parts.append(excerpt(path, later, LATER_SECONDS))
    spoken = LANGUAGES.get(language, "French")
    ask = f"""You hear {len(parts)} part(s) of one music track{f" (its main part, then a later part)" if len(parts) > 1 else ""}. A streamer will use it as background music for short vertical videos (TikTok, Shorts, Reels) made from their live streams: it plays low under people talking and louder when the game plays alone.{f" Its file is named « {hint[:80]} »." if hint else ""} It was measured at about {int(measured.get("bpm") or 0)} beats a minute (the measure can be double or half the real tempo).

Say what it is, from what you hear only:
- its genre, in one or two words;
- the kinds of video it suits, best first, one to three among: {"; ".join(f"{kind} ({what})" for kind, what in KINDS.items())};
- a description for the streamer, in {spoken}: one sentence on what it sounds like (pace, instruments, mood), one on the videos it is for. Plain words, no superlatives, under 190 characters;
- the same in English for another model that will pick a music for a video without hearing any: mood, energy, what it suits, and what it would ruin. Under 300 characters.

Answer with JSON only: {{"genre": "...", "kinds": ["..."], "description": "...", "about": "..."}}"""
    content = [{"type": "text", "text": ask}] + [{"type": "input_audio", "input_audio": {"data": part, "format": "mp3"}} for part in parts]
    try:
        response = client.chat.completions.create(
            model=EARS_MODEL,
            messages=[{"role": "user", "content": content}],
            temperature=0.2,
            max_tokens=700,
            timeout=120,
            extra_body={"usage": {"include": True}},
        )
    except Exception as e:
        stop_if_fatal(e)
        raise
    data = llm_text.parse_json(response.choices[0].message.content or "")
    kinds = [kind for kind in (data.get("kinds") or []) if kind in KINDS]
    cost = float(getattr(getattr(response, "usage", None), "cost", 0) or 0)
    return {
        "genre": " ".join(str(data.get("genre") or "").split())[:40].lower(),
        "kinds": list(dict.fromkeys(kinds))[:3],
        "description": " ".join(str(data.get("description") or "").split())[:240],
        "about": " ".join(str(data.get("about") or "").split())[:360],
        "cost": round(cost, 5),
    }


def describe(path: str, language: str = "fr", client=None, hint: str = "") -> dict:
    """Everything the app keeps of a track: what is measured, and what is heard. A model that can't
    be reached (no credits, a refused key, a failure) leaves the description empty for the streamer
    to write: `heard` says which it was, `why` what went wrong ("credits", "key", "failed")."""
    from app.services.provider_errors import ProviderUnavailable

    measured = measure(path)
    try:
        heard = listen(path, measured, language, client, hint)
    except Exception as e:
        # No credits, a refused key, a model that fails: the track is added all the same, and why it was not heard is said
        why = e.reason if isinstance(e, ProviderUnavailable) else "failed"
        logger.warning(f"Music {os.path.basename(path)} not listened to ({type(e).__name__}: {e}): kept with its measures only")
        return {**measured, "genre": "", "kinds": [], "description": "", "about": "", "cost": 0.0, "heard": False, "why": why}
    logger.info(f"Music {os.path.basename(path)}: {measured['bpm']} bpm, {measured['lufs']} LUFS, {heard['genre']}, for {', '.join(heard['kinds']) or 'nothing said'} (~{heard['cost']:.4f} $)")
    return {**measured, **heard, "heard": True}
