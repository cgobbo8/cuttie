"""When an analysis should be done, published in its timeline (eta: {start, end}).

From what an analysis is made of, timed on the Mac and the test PC: downloading
and analyzing the audio follow the live's length; transcribing the whole live
runs next to them, as fast as its engine (Groq, OpenRouter, or this computer at
the speed machine.py measured); then the AI watches the passages and the clips
are cut. As the work goes, its real pace replaces the guess: transcription
chunks, passages rated, clips extracted.
"""

import logging
import re
import threading
import time

logger = logging.getLogger(__name__)

DOWNLOAD_RATE = 270.0  # seconds of live downloaded per second (audio + chat)
AUDIO_RATE = 150.0  # seconds of live analyzed per second (librosa + PANNs)
SCORING_SECONDS = 15.0
LLM_SECONDS = 210.0  # once the transcript is there: the AI reads the live, then watches ~50 passages
CLIP_SECONDS = 150.0  # ~20 clips fetched from the live, then the cam checked on them
CLIP_AUDIO = 20 * 75.0  # their audio, transcribed again when the live transcript has no word timings
RATING_SECONDS = 1.5  # per passage the AI rates, its calls running side by side (until its pace is known)
RATES = {"groq": 500.0, "openrouter": 60.0}
DEFAULT_LOCAL_RATE = 10.0
# The same estimate isn't sent again before this, unless it moved by more than MOVED
PUBLISH_EVERY = 30.0
MOVED = 20.0

_RATED = re.compile(r"Analyse IA : (\d+) sur (\d+)")
_CLIPS = re.compile(r"Extraction clips \((\d+)/(\d+)\)")
_CHUNKS = re.compile(r"Transcription du live : (\d+) sur (\d+)")


class AnalysisEta:
    def __init__(self, job_id: str, duration: float, engine: str, local_rate: float | None, now: float | None = None):
        self.job_id = job_id
        self.duration = max(0.0, duration)
        self.rate = RATES.get(engine) or local_rate or DEFAULT_LOCAL_RATE
        # Groq and OpenRouter give word timings with the live transcript; this computer doesn't
        self.words = CLIP_AUDIO / self.rate if engine == "local" else 0.0
        self.start = time.time() if now is None else now
        self.downloaded_at: float | None = None
        self.scored_at: float | None = None
        self.transcribed_at: float | None = None
        self.chunks: tuple[int, int] = (0, 0)
        self.rated: tuple[float, int, int, int] | None = None  # first seen, done then, done, total
        self.rated_done_at: float | None = None
        self.clips: tuple[float, int, int] | None = None
        self._lock = threading.Lock()
        self._sent = (0.0, 0.0)  # end, at
        self.first_end = self.end(self.start)

    # ── What happened ──

    def observe(self, status: str | None, progress: str | None, now: float | None = None) -> None:
        now = time.time() if now is None else now
        with self._lock:
            if status in ("ANALYZING_AUDIO", "ANALYZING_CHAT", "SCORING") and self.downloaded_at is None:
                self.downloaded_at = now
            if status == "ANALYZING_CLIPS" and self.scored_at is None:
                self.scored_at = now
            if status == "CLIPPING" and self.rated_done_at is None:
                self.rated_done_at = now
                self.transcribed_at = self.transcribed_at or now
            if progress:
                if m := _CHUNKS.search(progress):
                    self.chunks = (int(m[1]), int(m[2]))
                if m := _RATED.search(progress):
                    done, total = int(m[1]), int(m[2])
                    first, first_done = (self.rated[0], self.rated[1]) if self.rated else (now, done)
                    self.rated = (first, first_done, done, total)
                    # Rating starts once the transcript is in
                    self.transcribed_at = self.transcribed_at or now
                if m := _CLIPS.search(progress):
                    done, total = int(m[1]), int(m[2])
                    first = self.clips[0] if self.clips else now
                    self.clips = (first, done, total)

    def transcribing(self, done: int, total: int, now: float | None = None) -> None:
        """A chunk of the live transcript came back (the transcript runs in its own thread)."""
        now = time.time() if now is None else now
        with self._lock:
            self.chunks = (done, total)
            if total and done >= total:
                self.transcribed_at = self.transcribed_at or now

    # ── When it should be done ──

    def end(self, now: float | None = None) -> float:
        now = time.time() if now is None else now
        with self._lock:
            d = self.duration
            download_end = self.downloaded_at or max(now, self.start + d / DOWNLOAD_RATE)
            scored = self.scored_at or max(now, download_end + d / AUDIO_RATE + SCORING_SECONDS)

            if self.transcribed_at:
                transcript_end = self.transcribed_at
            elif self.chunks[0] > 0 and self.downloaded_at:
                done, total = self.chunks
                transcript_end = max(now, self.downloaded_at + (now - self.downloaded_at) / done * total)
            else:
                transcript_end = max(now, download_end + d / self.rate)

            if self.rated_done_at:
                rated_end = self.rated_done_at
            elif self.rated:
                first, first_done, done, total = self.rated
                per = (now - first) / (done - first_done) if done > first_done else RATING_SECONDS
                rated_end = now + per * max(0, total - done)
            else:
                rated_end = max(scored, transcript_end) + LLM_SECONDS

            if self.clips and self.clips[1] > 0:
                first, done, total = self.clips
                extracted = now + (now - first) / done * max(0, total - done)
                return extracted + CLIP_SECONDS * 0.2 + self.words
            return max(rated_end, now) + CLIP_SECONDS + self.words

    def publish(self, now: float | None = None, force: bool = False) -> None:
        from app.services import timeline

        now = time.time() if now is None else now
        end = self.end(now)
        last_end, last_at = self._sent
        if not force and abs(end - last_end) < MOVED and now - last_at < PUBLISH_EVERY:
            return
        self._sent = (end, now)
        timeline.publish(self.job_id, eta={"start": round(self.start), "end": round(end)})


_tracked: dict[str, AnalysisEta] = {}


def track(job_id: str, duration: float, engine: str, local_rate: float | None) -> AnalysisEta:
    estimate = AnalysisEta(job_id, duration, engine, local_rate)
    _tracked[job_id] = estimate
    try:
        estimate.publish(force=True)
    except Exception as e:
        logger.warning(f"[{job_id[:8]}] ETA not published: {e}")
    return estimate


def observe(job_id: str, status: str | None = None, progress: str | None = None) -> None:
    """Every update of a tracked analysis (db.update_job): the estimate follows."""
    estimate = _tracked.get(job_id)
    if estimate is None:
        return
    if status in ("DONE", "ERROR"):
        _tracked.pop(job_id, None)
        # How good the guess was: tells from the logs what to tune
        took = time.time() - estimate.start
        logger.info(f"[{job_id[:8]}] Time estimate: {(estimate.first_end - estimate.start) / 60:.1f} min at start, took {took / 60:.1f} min ({status})")
        return
    try:
        estimate.observe(status, progress)
        estimate.publish()
    except Exception as e:
        logger.warning(f"[{job_id[:8]}] ETA not updated: {e}")


def transcribing(job_id: str, done: int, total: int) -> None:
    estimate = _tracked.get(job_id)
    if estimate is None:
        return
    try:
        estimate.transcribing(done, total)
        estimate.publish()
    except Exception as e:
        logger.warning(f"[{job_id[:8]}] ETA not updated: {e}")
