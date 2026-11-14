"""A passage of the live cut on its words.

The live's transcript often knows only roughly when a sentence is said: the
local engine gives lines, not words, and a line's times can hold seconds of
silence (a 2 s sentence in a 6 s line). A passage taken from it starts too
early and ends too late. Once the passage has its own small clip, its words
are timed one by one: the passage's text is found among them, and the cut goes
just before its first word and just after its last one, where the sound is
the quietest. What an editor does by hand with a waveform.
"""

import logging
import subprocess
from difflib import SequenceMatcher

import numpy as np

from app.services.live_search import stem, tokens

logger = logging.getLogger(__name__)

# The passage's words are looked for this far around the rough times (seconds)
REACH = 1.5
# Share of the passage's words that must be found among the timed ones: under it, the passage is left as it is
FOUND = 0.6
# One or two words found at an end of the passage, apart from the rest by more than this, are
# another sentence that happens to share them
APART = 1.6
STRAY = 2
# Air kept before the first sound of the passage and after its last one
AIR_IN, AIR_OUT = 0.1, 0.1
# Without the sound to look at: a word's time starts on its first sound and ends before its last one has died out
BLIND_IN, BLIND_OUT = 0.08, 0.16
# A word's time can be this wrong: where the first word is looked for before and after its time, the last one's end likewise
EARLY, LATE = 0.3, 0.45
# The shortest a word lasts and what each of its letters takes at least (never cut sooner after its
# start), and how long the sound stays up or down to count
WORD = 0.15
LETTER = 0.055
# How much sooner than the voice a word's time may end
SLACK = 0.2
# A breath between two sentences, and how far a passage that stops in the middle of one goes on to finish it
BREATH = 0.35
FINISH = 3.0
UP, DOWN = 0.05, 0.12
# A neighbour this close leaves no silence: the cut goes between the two words, where it dips
CLOSE = 0.3
PULL = 25.0
# A word mis-heard at the edge of the passage is given back when it runs straight into it
JOINED = 0.25
MISHEARD = 2
# The sound's level is read every 10 ms, over 30 ms
ENV_RATE = 100
ENV_SAMPLES = 16000
# Quiet is this far under the passage's loudest sound: most of the way down to the background, 30 dB at most
QUIET_SHARE, QUIET_MIN, QUIET_MAX = 0.6, 10.0, 30.0


def passage_text(transcript, start: float, end: float) -> str:
    """What the live's transcript has in the passage `start`-`end`: its timed words when it has
    them, else the lines that sit in it (their middle inside; the one it overlaps most when none does)."""
    if transcript.words:
        return " ".join(str(w["word"]).strip() for w in transcript.words if start - 0.05 <= (w["start"] + w["end"]) / 2 <= end + 0.05)
    lines = [(s, e, t) for s, e, t in transcript.segments if e > start and s < end and t.strip()]
    inside = [t for s, e, t in lines if start - 0.05 <= (s + e) / 2 <= end + 0.05]
    if not inside and lines:
        inside = [max(lines, key=lambda line: min(line[1], end) - max(line[0], start))[2]]
    return " ".join(t.strip() for t in inside)


def _said(word: dict) -> list[str]:
    return [stem(t) for t in tokens(str(word.get("word", "")))]


def _ends_sentence(word: dict) -> bool:
    return str(word.get("word", "")).rstrip().endswith((".", "?", "!", "…"))


def locate(words: list[dict], text: str, start: float, end: float) -> tuple[int, int] | None:
    """The first and last of `words` (timed, sorted) that say `text`, looked for around `start`-`end`.
    None when too little of it is found there (other words, a sound, a transcript too different)."""
    wanted = [stem(t) for t in tokens(text)]
    near = [i for i, w in enumerate(words) if w["end"] > start - REACH and w["start"] < end + REACH]
    if not wanted or not near:
        return None
    said: list[tuple[int, str]] = [(i, t) for i in near for t in _said(words[i])]
    blocks = [b for b in SequenceMatcher(None, wanted, [t for _i, t in said], autojunk=False).get_matching_blocks() if b.size]
    if not blocks:
        return None
    # A word or two found well apart at either end ("c'est", said seconds before) are another
    # sentence that happens to share them. Inside the passage, a sentence the two transcriptions
    # heard differently leaves a hole: that is no reason to stop there
    first_of = lambda b: said[b.b][0]
    last_of = lambda b: said[b.b + b.size - 1][0]
    apart = lambda x, y: words[first_of(y)]["start"] - words[last_of(x)]["end"] > APART
    lo, hi = 0, len(blocks) - 1
    while lo < hi and blocks[lo].size <= STRAY and apart(blocks[lo], blocks[lo + 1]):
        lo += 1
    while hi > lo and blocks[hi].size <= STRAY and apart(blocks[hi - 1], blocks[hi]):
        hi -= 1
    kept = blocks[lo : hi + 1]
    if sum(b.size for b in kept) < FOUND * len(wanted):
        return None
    first, last = first_of(kept[0]), last_of(kept[-1])
    # Words of the text not found at its edges were heard otherwise by the second transcription:
    # the words that run straight into the passage, inside the same sentence, are those
    head, tail = kept[0].a, len(wanted) - (kept[-1].a + kept[-1].size)
    # One word can be heard as two ("Cytale" for "c'est calme"): a couple more than what is missing
    more = (head + MISHEARD) if head > 0 else 0
    while more > 0 and first > 0 and words[first]["start"] - words[first - 1]["end"] <= JOINED and not _ends_sentence(words[first - 1]):
        first -= 1
        more -= 1
    more = (tail + MISHEARD) if tail > 0 else 0
    while more > 0 and last < len(words) - 1 and words[last + 1]["start"] - words[last]["end"] <= JOINED and not _ends_sentence(words[last]):
        last += 1
        more -= 1
    return first, last


def envelope(path: str, timeout: float = 60.0) -> np.ndarray | None:
    """How loud the file's sound is, in dB, every 10 ms (None when it can't be read)."""
    try:
        raw = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(ENV_SAMPLES), "-f", "s16le", "-"],
            capture_output=True, check=True, timeout=timeout,
        ).stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
        logger.warning(f"Sound of {path} not read for the cuts: {type(e).__name__}")
        return None
    return envelope_of(np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0)


def envelope_of(samples: np.ndarray, rate: int = ENV_SAMPLES) -> np.ndarray | None:
    hop = rate // ENV_RATE
    n = len(samples) // hop
    if n < 3:
        return None
    power = (samples[: n * hop].reshape(n, hop) ** 2).mean(axis=1)
    # Over 30 ms: one hop on each side
    wide = np.convolve(power, np.ones(3) / 3, mode="same")
    return 10 * np.log10(wide + 1e-10)


def _dip(env: np.ndarray, lo: float, hi: float, wanted: float) -> float:
    """Where the sound dips the most between `lo` and `hi`, near `wanted`."""
    wanted = min(max(wanted, lo), hi)
    a, b = max(0, int(lo * ENV_RATE)), min(len(env) - 1, int(hi * ENV_RATE))
    if b <= a:
        return wanted
    at = np.arange(a, b + 1) / ENV_RATE
    return float(at[int(np.argmin(env[a : b + 1] + PULL * np.abs(at - wanted)))])


def _quiet_under(env: np.ndarray, start: float, end: float) -> float:
    """The level under which the sound around the passage counts as quiet."""
    a, b = max(0, int(start * ENV_RATE)), min(len(env), int(end * ENV_RATE) + 1)
    peak = float(env[a:b].max()) if b > a else float(env.max())
    around = env[max(0, a - ENV_RATE) : min(len(env), b + ENV_RATE)]
    floor = float(np.percentile(around, 10)) if len(around) else peak - QUIET_MAX
    return peak - min(QUIET_MAX, max(QUIET_MIN, QUIET_SHARE * (peak - floor)))


def _first_sound(env: np.ndarray, quiet: float, lo: float, hi: float) -> float | None:
    """When the sound comes up between `lo` and `hi` after being quiet (None: it never is quiet, or never comes up)."""
    a, b = max(0, int(lo * ENV_RATE)), min(len(env), int(hi * ENV_RATE) + 1)
    up = env[a:b] > quiet
    need = max(1, int(UP * ENV_RATE))
    if len(up) <= need or up[0]:
        return None
    for i in range(1, len(up) - need + 1):
        if up[i : i + need].all():
            return (a + i) / ENV_RATE
    return None


def _last_sound(env: np.ndarray, quiet: float, lo: float, hi: float, said_end: float) -> float | None:
    """When the voice stops between `lo` and `hi`: where the sound goes down and stays down for a
    while. A word can dip in its middle, and its time (`said_end`) can run on long after the
    voice: of the places where the sound goes down, the last one by that time. None: it doesn't
    by then."""
    a, b = max(0, int(lo * ENV_RATE)), min(len(env), int(hi * ENV_RATE) + 1)
    down = env[a:b] <= quiet
    need = max(1, int(DOWN * ENV_RATE))
    stops: list[float] = []
    i = 0
    while i < len(down):
        if not down[i]:
            i += 1
            continue
        j = i
        while j < len(down) and down[j]:
            j += 1
        # Down for long enough, or still down where the look ends
        if j - i >= need or (j == len(down) and j - i >= need // 2):
            stops.append((a + i) / ENV_RATE)
        i = j
    # A word's time rarely ends before its voice does: the last stop up to there (and a little
    # after). A sound that only stops later is the next word, said straight after
    by_then = [t for t in stops if t <= said_end + SLACK]
    return max(by_then) if by_then else None


def bounds(words: list[dict], first: int, last: int, env: np.ndarray | None = None, length: float | None = None) -> tuple[float, float]:
    """Where to cut to keep `words[first..last]`: on the passage's first and last sounds with a
    little air, never into the word before or after. A word's time is only about right (the last
    one's often runs on into the silence, the next one's can start in it): with the sound's
    level, the cut goes where the voice really starts and stops."""
    w0, w1 = words[first], words[last]
    before = words[first - 1]["end"] if first > 0 else None
    after = words[last + 1]["start"] if last < len(words) - 1 else None
    tied_in = before is not None and w0["start"] - before < CLOSE
    tied_out = after is not None and after - w1["end"] < CLOSE
    start = (before + w0["start"]) / 2 if tied_in else w0["start"] - BLIND_IN
    end = (w1["end"] + after) / 2 if tied_out else w1["end"] + BLIND_OUT
    if env is not None:
        quiet = _quiet_under(env, w0["start"], w1["end"])
        # From where the word before ends (when it really runs into this one, the sound is up
        # there and nothing is found), through the whole first word when its time starts in a silence
        look = before - 0.05 if tied_in else max(before or 0.0, w0["start"] - EARLY)
        heard = _first_sound(env, quiet, max(0.0, look), min(max(w0["start"] + LATE, w0["end"]), w1["end"] - WORD))
        if heard is not None:
            start = heard - AIR_IN
        elif tied_in:
            start = _dip(env, before - 0.05, w0["start"] + 0.05, start)
        # Never before the word had time to be said, whatever its sound does
        said = "".join(c for c in str(w1.get("word", "")) if c.isalnum())
        earliest = w1["start"] + min(w1["end"] - w1["start"], max(WORD, LETTER * len(said)))
        over = _last_sound(env, quiet, earliest, w1["end"] + LATE, w1["end"])
        if over is not None:
            end, after = over + AIR_OUT, None
        elif tied_out:
            end = _dip(env, w1["end"] - 0.05, after + 0.05, end)
    if before is not None:
        start = max(start, before - 0.05 if tied_in else before)
    if after is not None:
        end = min(end, after + 0.05 if tied_out else after)
    if length is not None:
        end = min(end, length)
    start = max(0.0, start)
    return start, max(end, start + 0.2)


def _breath_after(words: list[dict], j: int, env: np.ndarray | None, quiet: float | None) -> bool:
    """Someone stops speaking after `words[j]`: a gap before the next word, or (a word's time often
    runs on over the silence that follows) a stretch of quiet in the sound before the next one."""
    if j >= len(words) - 1 or words[j + 1]["start"] - words[j]["end"] >= BREATH:
        return True
    if env is None or quiet is None:
        return False
    a, b = max(0, int((words[j]["start"] + WORD) * ENV_RATE)), min(len(env), int((words[j + 1]["start"] + 0.05) * ENV_RATE))
    run = longest = 0
    for down in env[a:b] <= quiet:
        run = run + 1 if down else 0
        longest = max(longest, run)
    return longest >= int(BREATH * ENV_RATE)


def finish_sentence(words: list[dict], first: int, last: int, env: np.ndarray | None = None) -> int:
    """The last word to keep for a passage that would stop in the middle of running speech (a
    line of the transcript often ends before its sentence does): on to where the speaker stops,
    when that is within a few seconds. An editor doesn't cut someone off mid-breath."""
    quiet = _quiet_under(env, words[first]["start"], words[last]["end"]) if env is not None else None
    j = last
    while not _ends_sentence(words[j]) and not _breath_after(words, j, env, quiet):
        if words[j + 1]["end"] - words[last]["end"] > FINISH:
            return last
        j += 1
    return j


def _whole_words(words: list[dict]) -> list[dict]:
    """Timed words in order; a punctuation mark given a time of its own ("!" after a shout) belongs to the word before it."""
    whole: list[dict] = []
    for w in sorted((w for w in words if "start" in w and "end" in w), key=lambda w: w["start"]):
        if whole and not any(c.isalnum() for c in str(w.get("word", ""))):
            whole[-1] = {**whole[-1], "word": f'{whole[-1].get("word", "")}{str(w.get("word", "")).strip()}', "end": max(whole[-1]["end"], w["end"])}
        else:
            whole.append(w)
    return whole


def fit(words: list[dict], text: str, start: float, end: float, env: np.ndarray | None = None, length: float | None = None) -> tuple[float, float] | None:
    """The passage that says `text` around `start`-`end`, cut on its timed `words` (same clock
    as `start` and `end`). None when its words are not found: the passage stays as it was."""
    words = _whole_words(words)
    found = locate(words, text, start, end)
    if not found:
        return None
    return bounds(words, found[0], finish_sentence(words, found[0], found[1], env), env, length)
