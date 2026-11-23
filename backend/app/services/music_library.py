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


def beat_grid(y, sr: int, around: float) -> tuple[float, float] | None:
    """(when a beat falls near `around`, seconds between two beats there), from a line drawn through the beats
    that follow. An intro played on the track lasts four of its beats and what lands in it lands on them: a
    tempo rounded to the beat a minute, or measured over the whole track, is 40 ms off by the fourth beat (seen
    on a track at 126 measured 129).

    A tracker can hear a track at one tempo or at another, so several readings are tried, and the one the
    track itself repeats at is kept: how much its sound, moved by one beat, by two and by four, looks like
    itself. (Twice or half the tempo is no harm here; one and a half times is, and was what "the beats that
    fall on the most sound" chose on tracks with busy hi-hats.) None: too few beats there, or beats too
    uneven to draw a line through."""
    import librosa
    import numpy as np

    # How the track repeats over the 24 s that follow: its sound against itself, moved by a lag
    hop = 256
    envelope = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    here = envelope[librosa.time_to_frames(max(0.0, around), sr=sr, hop_length=hop) :][: int(24 * sr / hop)]
    here = here - here.mean()
    alike = np.correlate(here, here, mode="full")[len(here) - 1 :]
    alike = alike / (alike[0] + 1e-9)

    def repeats(period: float) -> float:
        lag = period * sr / hop
        low = int(lag)
        return float(alike[low] + (alike[low + 1] - alike[low]) * (lag - low)) if low + 1 < len(alike) else 0.0

    best: tuple[float, float, float] | None = None
    for tracker_hop in (256, 512):
        strength = envelope if tracker_hop == hop else librosa.onset.onset_strength(y=y, sr=sr, hop_length=tracker_hop)
        for start_bpm in (120, 90, 150):
            _, beats = librosa.beat.beat_track(onset_envelope=strength, sr=sr, hop_length=tracker_hop, start_bpm=start_bpm)
            times = librosa.frames_to_time(beats, sr=sr, hop_length=tracker_hop)
            after = times[times >= around - 0.08][:17]
            if len(after) < 8:
                continue
            k = np.arange(len(after))
            period, first = np.polyfit(k, after, 1)
            if float(np.std(after - (first + period * k))) > 0.025 or not 0.2 < period < 1.5:
                continue
            # (between readings the track repeats at equally, as happens when it swings in threes, the one nearest to 120 beats a minute: the beat people tap)
            score = (repeats(period) + 0.5 * repeats(2 * period) + 0.25 * repeats(4 * period)) * float(np.exp(-0.5 * np.log2(60 / period / 120) ** 2))
            if best is None or score > best[2] + 1e-6:
                best = (float(first), float(period), score)
    return (best[0], best[1]) if best else None


def attack_foot(y, sr: int, at: float) -> float:
    """Exactly where the sound of an attack starts to rise, looked at closely (every 6 ms). A detector dates
    an attack at the height of its rise, a few hundredths late, and an attack can take a tenth of a second
    to come: a start a tenth of a second early is a tenth of a second of nothing at the very start of a
    video; late, the attack is cut off and what lands in an intro no longer lands on the beat."""
    import librosa
    import numpy as np

    fine = 128
    low = max(0, int((at - 0.3) * sr))
    close = librosa.feature.rms(y=y[low : int((at + 0.15) * sr)], frame_length=512, hop_length=fine)[0]
    if len(close) < 3 or close.max() <= 0:
        return at
    # The steepest of the rise, near where the detector heard it; then down to its foot
    near = max(0, int((at - 0.12) * sr - low) // fine)
    rise = near + int(np.argmax(np.diff(close[near:])))
    peak = float(close[rise + 1 : rise + 1 + int(0.1 * sr / fine)].max())
    for _ in range(int(0.15 * sr / fine)):
        if rise == 0 or close[rise] <= 0.15 * peak or close[rise - 1] >= close[rise]:
            break
        rise -= 1
    return low / sr + rise * fine / sr


def best_start(y, sr: int) -> float:
    """Where a video starts the track: on a clear attack from which the music is loud at once and stays so.
    The start of a video is what matters most: a track started in a quiet bar, in the tail of a note or just
    before a break leaves a hole there (seen: a theme started in a second of near silence between two hits; a
    song started 1.6 s before an 18 s break, because one loud second had been taken for its chorus).

    Every attack of the first 60 % of the track is a candidate, judged on three things: how loud the 0.35 s
    that follow are (it starts at once), that nothing goes nearly silent in the 2 s that follow (no hole: a hit
    followed by a bar of rest is not a start), and how loud the 8 s that follow stay (no break). The very
    first attack is taken when it does at least half as well as the best one: a track that is in swing from
    its first note starts on it, which is how people know it. Otherwise the earliest attack that does nearly
    as well as the best."""
    import librosa
    import numpy as np

    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    per_second = sr / hop
    full = float(np.percentile(rms, 90)) + 1e-9
    sums = np.concatenate([[0.0], np.cumsum(rms)])

    def loud(seconds_from: float, seconds_to: float) -> float:
        a = min(len(rms) - 1, max(0, int(seconds_from * per_second)))
        b = min(len(rms), max(a + 1, int(seconds_to * per_second)))
        return float(sums[b] - sums[a]) / (b - a) / full

    def foot(at: float) -> float:
        return attack_foot(y, sr, at)

    scored = []
    for heard in librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, units="time"):
        if heard > len(y) / sr * 0.6:
            break
        at = foot(float(heard))
        at_once = min(1.0, loud(at, at + 0.35))
        # The quietest third of a second of the two that follow: a hole there is heard as one
        no_hole = min(1.0, min(loud(at + step / 10, at + step / 10 + 0.3) for step in range(0, 18)) / 0.45)
        lasting = min(1.0, loud(at, at + 8))
        scored.append((at, at_once * no_hole * lasting))
    if not scored:
        return 0.0
    top = max(score for _, score in scored)
    first, first_score = scored[0]
    at = first if first_score >= 0.5 * top else next(at for at, score in scored if score >= 0.7 * top)
    # Three hundredths before the attack, never in it
    return max(0.0, at - 0.03)


def measure(path: str) -> dict:
    """{"seconds", "bpm", "start", "lufs"}: how long the track is, its tempo where a video starts it (to the
    hundredth of a beat a minute), where a video starts it (see `best_start`) and how loud it was recorded."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    if len(y) < sr:
        raise ValueError("this file has less than a second of sound")
    seconds = len(y) / sr
    start = best_start(y, sr)
    # The beats from there, measured closely: the tempo a video's intro follows
    grid = beat_grid(y, sr, start + 0.02)
    if grid:
        bpm = round(60 / grid[1], 2)
    else:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
        bpm = round(float(np.atleast_1d(tempo)[0]))
    printed = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True, timeout=300).stderr
    found = re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", printed)
    lufs = float(found[-1]) if found else -14.0
    return {"seconds": round(seconds, 1), "bpm": bpm, "start": round(start, 2), "lufs": max(-40.0, min(0.0, lufs))}


# How far from the time the streamer gives an attack is looked for: they say "about 35 seconds"
MOMENT_REACH = 0.75


def moment(path: str, at: float) -> dict:
    """{"start", "bpm"}: the track's strong moment as the streamer points at it (the riff comes in, the drop),
    where a video starts it or, with an intro that builds up to it, the first picture of the video.

    They give a time by ear, to the second or so; an attack near it is taken, to the hundredth: nobody can
    type where a note starts, and a moment a tenth of a second off is heard. How loud it is does not count:
    the riff a song is known by can be quieter than the drum fill that leads to it (seen: a guitar riff at
    35.1 s after 8 s of drums twice as loud, which no measure of loudness would ever choose). Among the
    attacks within reach, the one that starts something wins over a hit in what leads to it: how much louder
    the sound is just after than just before, with the nearer ones ahead. No attack within reach: the time
    as given. `bpm`: the tempo from there, None when no beat can be followed."""
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    seconds = len(y) / sr
    at = min(max(0.0, float(at)), max(0.0, seconds - 1))
    hop = 128
    rms = librosa.feature.rms(y=y, frame_length=512, hop_length=hop)[0]
    usual = float(np.percentile(rms, 90)) + 1e-9

    def loud(seconds_from: float, seconds_to: float) -> float:
        a = min(len(rms) - 1, max(0, int(seconds_from * sr / hop)))
        b = min(len(rms), max(a + 1, int(seconds_to * sr / hop)))
        return float(rms[a:b].mean())

    def starts_something(foot: float) -> float:
        # Louder after than before (four times at most: after a silence anything is), and nearer to what was said
        rises = min(4.0, loud(foot + 0.01, foot + 0.16) / (loud(foot - 0.14, foot - 0.02) + 0.05 * usual))
        return rises * (1 - 0.6 * (abs(foot - at) / MOMENT_REACH) ** 2)

    feet = [attack_foot(y, sr, float(heard)) for heard in librosa.onset.onset_detect(y=y, sr=sr, hop_length=512, units="time") if abs(float(heard) - at) <= MOMENT_REACH + 0.2]
    near = [foot for foot in feet if abs(foot - at) <= MOMENT_REACH]
    start = max(0.0, max(near, key=starts_something) - 0.03) if near else at
    grid = beat_grid(y, sr, start + 0.03)
    return {"start": round(start, 2), "bpm": round(60 / grid[1], 2) if grid else None}


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
