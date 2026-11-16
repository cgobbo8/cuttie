"""The whole live transcribed once, in 10-minute chunks: what the pre-sort reads.

Runs in the background while the audio and the chat are analyzed. Chunks are
cached on disk (a retry picks up where it stopped). This computer does them one
at a time (its GPU), the cloud engines a few at once; a chunk this computer or
Groq can't do goes to OpenRouter. An Apple chip skips word timings (2.5x faster
without): the clips kept at the end get theirs from their own audio.

A line is a sentence. Lives transcribed on an NVIDIA card before that held (up to
0.2.5) are made of half-minute lines: `refine` transcribes them again, once.
"""

import json
import logging
import math
import os
import re
import shutil
import subprocess
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from app.services import transcriber
from app.services.paths import transcript_dir

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 600.0
# What a chunk written now says of itself: its lines are sentences (`transcriber.split_long`)
LINES = 2
# A line that is half a minute of talk rather than a sentence, and the share of what is said
# that sits in such lines for a live to be transcribed again
COARSE_SECONDS = 15.0
COARSE_WORDS = 25
COARSE_SHARE = 0.4
WORKERS = 6  # cloud engines in parallel; this computer queues on its GPU lock
# Whisper loops on music ("a a a a a..."): a word said more than 3 times in a row is kept 3 times
_REPEATS = re.compile(r"\b(\w+)(?:[\s,]+\1\b){3,}", re.IGNORECASE)


def squash_repeats(text: str) -> str:
    return _REPEATS.sub(lambda m: f"{m.group(1)} {m.group(1)} {m.group(1)}", text)


@dataclass
class VodTranscript:
    """Segments (and words, when the engine gave them) in live seconds."""

    segments: list[tuple[float, float, str]] = field(default_factory=list)
    words: list[dict] = field(default_factory=list)
    failed: int = 0
    total: int = 0

    def window(self, start: float, end: float) -> tuple[str, list[tuple[float, float, str]], list[dict]]:
        """Text, segments and words said between `start` and `end`, times from `start`."""
        segments = [(max(0.0, s - start), e - start, t) for s, e, t in self.segments if e > start and s < end]
        words = [{**w, "start": w["start"] - start, "end": w["end"] - start} for w in self.words if w["end"] > start and w["start"] < end]
        text = " ".join(t.strip() for _s, _e, t in segments if t.strip())
        return text, segments, words

    def find(self, pattern: re.Pattern[str]) -> list[float]:
        """Live seconds where a segment matches `pattern` (start of the segment, or of the matching word)."""
        hits: list[float] = []
        if self.words:
            hits = [w["start"] for w in self.words if pattern.search(w["word"])]
        else:
            hits = [s for s, _e, t in self.segments if pattern.search(t)]
        return sorted(hits)


def shape(segments: list, words: list | None = None) -> dict:
    """How a transcript is cut: its lines, what a line lasts (median), and the share of the
    words said that sit in lines too long to be a sentence. The AI picks passages by lines:
    this is what tells, in the logs, a live it can cut finely from one it cannot."""
    lasts = sorted(float(e) - float(s) for s, e, _t in segments)
    said = [len(str(t).split()) for _s, _e, t in segments]
    long = sum(n for (s, e, _t), n in zip(segments, said) if float(e) - float(s) >= COARSE_SECONDS and n >= COARSE_WORDS)
    return {
        "lines": len(segments),
        "words": len(words or []),
        "median": round(lasts[len(lasts) // 2], 1) if lasts else 0.0,
        "longest": round(lasts[-1], 1) if lasts else 0.0,
        "long": round(long / sum(said), 3) if sum(said) else 0.0,
    }


def told(found: dict) -> str:
    """`shape` in a sentence, for the logs."""
    return (
        f"{found['lines']} lines of {found['median']:.1f} s (median, longest {found['longest']:.0f} s), "
        f"{found['long']:.0%} of what is said in lines over {COARSE_SECONDS:.0f} s, {found['words']} dated words"
    )


def _extract_chunk(wav_path: str, start: float, end: float, out_path: str) -> bool:
    """A chunk of the live's WAV as a small mono MP3 (seeks straight to it: no
    decoding of the hours before; well under the cloud engines' 25 MB)."""
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", wav_path,
             "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", out_path],
            check=True,
            timeout=180,
            capture_output=True,
        )
        return os.path.isfile(out_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning(f"Live transcript: could not cut {start:.0f}-{end:.0f}s: {e}")
        return False


def _chunk_path(cache_dir: str, index: int) -> str:
    return os.path.join(cache_dir, f"chunk_{index:03d}.json")


def _load_chunk(path: str) -> dict | None:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def cached_words(job_id: str, start: float, end: float) -> list[dict] | None:
    """Words said between `start` and `end` (live seconds) in the live transcript's cache.

    None when the cache doesn't cover them with word timings (part of the live
    not transcribed, or transcribed by the local engine, which gives none).
    """
    cache_dir = transcript_dir(job_id)
    words: list[dict] = []
    for i in range(int(start // CHUNK_SECONDS), int(max(start, end - 0.001) // CHUNK_SECONDS) + 1):
        chunk = _load_chunk(_chunk_path(cache_dir, i))
        if chunk is None:
            return None
        spoken = [s for s in chunk.get("segments", []) if s[1] > start and s[0] < end]
        inside = [w for w in chunk.get("words", []) if w["start"] >= start and w["end"] <= end]
        if spoken and not inside:
            return None
        words += inside
    return words


def load_cached(job_id: str) -> VodTranscript | None:
    """The live's transcript as far as it was made (searching the live, after the
    analysis), None when nothing is there. Chunks that failed are just missing."""
    cache_dir = transcript_dir(job_id)
    if not os.path.isdir(cache_dir):
        return None
    out = VodTranscript()
    for name in sorted(os.listdir(cache_dir)):
        if not re.fullmatch(r"chunk_\d+\.json", name):
            continue
        chunk = _load_chunk(os.path.join(cache_dir, name))
        if chunk is None:
            continue
        out.total += 1
        out.segments += [(float(s), float(e), t) for s, e, t in chunk.get("segments", [])]
        out.words += chunk.get("words", [])
    return out if out.segments else None


def transcribe_vod(
    job_id: str,
    wav_path: str,
    duration: float,
    stop: threading.Event | None = None,
    on_chunk=None,
    redo: list[int] | None = None,
    engine: str | None = None,
) -> VodTranscript:
    """Transcribe the whole live (cached by chunk). `on_chunk(done, total)` after
    each chunk. ProviderUnavailable (OpenRouter refusing for good) propagates.
    `redo`: chunks to transcribe again whatever the cache holds (one that fails keeps
    what it had); `engine`: this one rather than the settings' choice."""
    from app.services.llm_analyzer import TranscriptionFailed, _transcribe_audio

    cache_dir = transcript_dir(job_id)
    os.makedirs(cache_dir, exist_ok=True)
    total = max(1, math.ceil(max(0.0, duration) / CHUNK_SECONDS))
    again = set(redo or [])
    chunks: dict[int, dict] = {}
    kept: dict[int, dict] = {}
    for i in range(total):
        cached = _load_chunk(_chunk_path(cache_dir, i))
        if cached is not None:
            (kept if i in again else chunks)[i] = cached
    todo = [i for i in range(total) if i not in chunks]
    failed = 0
    if chunks:
        logger.info(f"[{job_id[:8]}] Live transcript: {len(chunks)}/{total} chunks already done")

    def _one(i: int) -> dict | None:
        if stop is not None and stop.is_set():
            return None
        start = i * CHUNK_SECONDS
        end = min(duration, start + CHUNK_SECONDS)
        audio = os.path.join(cache_dir, f"chunk_{i:03d}.mp3")
        if not _extract_chunk(wav_path, start, end, audio):
            raise TranscriptionFailed(f"chunk {i}: audio extraction failed")
        t0 = time.time()
        try:
            by = engine or transcriber.chosen_engine()
            _text, _rate, segments, words = _transcribe_audio(audio, by, words=by != "local" or transcriber.whole_live_words())
        finally:
            if os.path.isfile(audio):
                os.remove(audio)
        # How fast this computer / the service really goes, and how it cuts its lines (remote support reads it in the logs)
        elapsed = time.time() - t0
        logger.info(
            f"[{job_id[:8]}] Live transcript chunk {i + 1}/{total}: {end - start:.0f} s of audio in {elapsed:.1f} s "
            f"({(end - start) / max(elapsed, 0.01):.1f}x, {by}), {len(segments)} lines, {len(words)} dated words"
        )
        chunk = {
            "start": start,
            "lines": LINES,
            "segments": [[round(s + start, 2), round(e + start, 2), squash_repeats(t)] for s, e, t in segments],
            "words": [{"word": w["word"], "start": round(w["start"] + start, 3), "end": round(w["end"] + start, 3)} for w in words],
        }
        with open(_chunk_path(cache_dir, i), "w", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False)
        return chunk

    if todo:
        logger.info(f"[{job_id[:8]}] Transcribing the live: {len(todo)} chunks of {CHUNK_SECONDS / 60:.0f} min ({transcriber.chosen_engine()})")
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures: dict[Future, int] = {pool.submit(_one, i): i for i in todo}
            for future in as_completed(futures):
                i = futures[future]
                try:
                    chunk = future.result()
                except TranscriptionFailed as e:
                    logger.warning(f"[{job_id[:8]}] Live transcript chunk {i} failed: {e}")
                    failed += 1
                    chunk = None
                except Exception:
                    # Provider refusing for good (or a bug): stop the rest
                    pool.shutdown(wait=False, cancel_futures=True)
                    raise
                if chunk is not None:
                    chunks[i] = chunk
                elif i in kept:
                    # Could not be done again: what it had is still there
                    chunks[i] = kept[i]
                if on_chunk:
                    on_chunk(len(chunks) + failed, total)

    out = VodTranscript(failed=failed, total=total)
    for i in sorted(chunks):
        out.segments += [(float(s), float(e), t) for s, e, t in chunks[i]["segments"]]
        out.words += chunks[i].get("words", [])
    logger.info(f"[{job_id[:8]}] Live transcript: {len(out.segments)} segments, {len(out.words)} words, {failed} chunk(s) failed ({told(shape(out.segments, out.words))})")
    return out


# ── Lives transcribed in half-minute lines ───────────────────────────────────

_refining: dict[str, threading.Lock] = {}
_refining_lock = threading.Lock()


def _relistened_path(job_id: str) -> str:
    return os.path.join(transcript_dir(job_id), "relistened.json")


def coarse_chunks(job_id: str) -> list[int]:
    """The chunks of this live to transcribe again: those written before a line was a sentence,
    when together they date no word and hold most of what is said in half-minute lines (an
    NVIDIA card up to 0.2.5: one line per 30 seconds of speech). Empty for every other live,
    and for one already transcribed again."""
    cache_dir = transcript_dir(job_id)
    if not os.path.isdir(cache_dir) or os.path.isfile(_relistened_path(job_id)):
        return []
    old: list[int] = []
    segments: list = []
    for name in sorted(os.listdir(cache_dir)):
        found = re.fullmatch(r"chunk_(\d+)\.json", name)
        chunk = _load_chunk(os.path.join(cache_dir, name)) if found else None
        if chunk is None or chunk.get("lines") == LINES:
            continue
        if chunk.get("words"):
            return []
        old.append(int(found.group(1)))
        segments += chunk.get("segments", [])
    return old if segments and shape(segments)["long"] >= COARSE_SHARE else []


def refine(job_id: str, vod_url: str | None, on_chunk=None) -> bool:
    """Transcribe again, on this computer, a live whose lines are half minutes (`coarse_chunks`):
    its sound is downloaded again, then about as long as the first time (12 minutes for 7 hours
    on an RTX 4070 SUPER). Free, once per live: a pass that went to its end is not started again,
    one that was interrupted picks up where it stopped. False when there was nothing to do or it
    could not be done (the live left Twitch, no fast engine on this computer): the transcript
    stays as it was. `on_chunk(done, total)` after each chunk."""
    if not vod_url or not coarse_chunks(job_id):
        return False
    if transcriber.local_backend() not in ("mlx", "cuda"):
        logger.warning(f"[{job_id[:8]}] Live transcript in half-minute lines, and no fast engine on this computer to transcribe it again")
        return False
    with _refining_lock:
        lock = _refining.setdefault(job_id, threading.Lock())
    with lock:
        redo = coarse_chunks(job_id)
        if not redo:
            return True  # someone else just did it
        from app.services.downloader import download_audio
        from app.services.paths import work_dir

        before = load_cached(job_id)
        folder = work_dir(f"relisten_{job_id}")
        try:
            t0 = time.time()
            logger.info(f"[{job_id[:8]}] Live transcript in half-minute lines ({told(shape(before.segments, before.words)) if before else 'empty'}): transcribing {len(redo)} chunks again")
            wav = download_audio(vod_url, folder)
            import soundfile

            duration = float(soundfile.info(wav).duration)
            logger.info(f"[{job_id[:8]}] Live transcript: the live's sound ({duration / 3600:.1f} h) downloaded again in {time.time() - t0:.0f} s")
            again = transcribe_vod(job_id, wav, duration, on_chunk=on_chunk, redo=redo, engine="local")
            with open(_relistened_path(job_id), "w", encoding="utf-8") as f:
                json.dump({"at": time.time(), "chunks": len(redo), "failed": again.failed, "seconds": round(time.time() - t0)}, f)
            logger.info(f"[{job_id[:8]}] Live transcribed again in {time.time() - t0:.0f} s: {told(shape(again.segments, again.words))}")
            return True
        except Exception as e:
            logger.warning(f"[{job_id[:8]}] Live not transcribed again: {type(e).__name__}: {e}")
            return False
        finally:
            shutil.rmtree(folder, ignore_errors=True)


class Background:
    """The live transcript running next to the rest of the analysis."""

    def __init__(self, job_id: str, wav_path: str, duration: float) -> None:
        self.job_id = job_id
        self.stop = threading.Event()
        self.done = 0
        self.total = max(1, math.ceil(max(0.0, duration) / CHUNK_SECONDS))
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-transcript")
        self._future = self._pool.submit(transcribe_vod, job_id, wav_path, duration, self.stop, self._progress)

    def _progress(self, done: int, total: int) -> None:
        from app.services import eta

        self.done, self.total = done, total
        eta.transcribing(self.job_id, done, total)

    def result(self, on_wait=None, poll: float = 2.0) -> VodTranscript:
        """Wait for the transcript, calling `on_wait(done, total)` while it runs."""
        while True:
            try:
                return self._future.result(timeout=poll)
            except TimeoutError:
                if on_wait:
                    on_wait(self.done, self.total)

    def cancel(self) -> None:
        self.stop.set()
        self._pool.shutdown(wait=False, cancel_futures=True)
