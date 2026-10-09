"""The whole live transcribed once, in 10-minute chunks: what the pre-sort reads.

Runs in the background while the audio and the chat are analyzed. Chunks are
cached on disk (a retry picks up where it stopped). This computer does them one
at a time (its GPU), the cloud engines a few at once; a chunk this computer or
Groq can't do goes to OpenRouter. This computer skips word timings (2.5x faster
on an Apple chip): the clips kept at the end get theirs from their own audio.
"""

import json
import logging
import math
import os
import re
import subprocess
import threading
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from app.services import transcriber
from app.services.paths import transcript_dir

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 600.0
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


def transcribe_vod(
    job_id: str,
    wav_path: str,
    duration: float,
    stop: threading.Event | None = None,
    on_chunk=None,
) -> VodTranscript:
    """Transcribe the whole live (cached by chunk). `on_chunk(done, total)` after
    each chunk. ProviderUnavailable (OpenRouter refusing for good) propagates."""
    from app.services.llm_analyzer import TranscriptionFailed, _transcribe_audio

    cache_dir = transcript_dir(job_id)
    os.makedirs(cache_dir, exist_ok=True)
    total = max(1, math.ceil(max(0.0, duration) / CHUNK_SECONDS))
    chunks: dict[int, dict] = {}
    for i in range(total):
        cached = _load_chunk(_chunk_path(cache_dir, i))
        if cached is not None:
            chunks[i] = cached
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
        try:
            engine = transcriber.chosen_engine()
            _text, _rate, segments, words = _transcribe_audio(audio, engine, words=engine != "local")
        finally:
            if os.path.isfile(audio):
                os.remove(audio)
        chunk = {
            "start": start,
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
                if on_chunk:
                    on_chunk(len(chunks) + failed, total)

    out = VodTranscript(failed=failed, total=total)
    for i in sorted(chunks):
        out.segments += [(float(s), float(e), t) for s, e, t in chunks[i]["segments"]]
        out.words += chunks[i]["words"]
    logger.info(f"[{job_id[:8]}] Live transcript: {len(out.segments)} segments, {len(out.words)} words, {failed} chunk(s) failed")
    return out


class Background:
    """The live transcript running next to the rest of the analysis."""

    def __init__(self, job_id: str, wav_path: str, duration: float) -> None:
        self.stop = threading.Event()
        self.done = 0
        self.total = max(1, math.ceil(max(0.0, duration) / CHUNK_SECONDS))
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="live-transcript")
        self._future = self._pool.submit(transcribe_vod, job_id, wav_path, duration, self.stop, self._progress)

    def _progress(self, done: int, total: int) -> None:
        self.done, self.total = done, total

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
