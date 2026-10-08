"""Live view of an analysis, streamed to the app while the pipeline runs.

- The live's intensity (voice energy) and chat activity, once measured
- The candidate passages, then each one as the AI rates it

Events go through api_events like status updates; the API keeps them on the
job ("timeline") so a page opened mid-analysis sees everything so far.
"""

import numpy as np

from app.services import api_events

ENERGY_POINTS = 240
CHAT_BINS = 120


def energy_curve(audio_windows: list[dict], duration: float, points: int = ENERGY_POINTS) -> list[float]:
    """Voice energy across the live, 0-1, on `points` evenly spaced samples.

    Normalized on the live's own baseline (10th..99th percentile, in dB), so a
    quiet streamer's peaks still show.
    """
    if not audio_windows or duration <= 0:
        return []
    times = np.array([w["time"] for w in audio_windows], dtype=float)
    rms = np.array([w["rms"] for w in audio_windows], dtype=float)
    db = 20 * np.log10(np.maximum(rms, 1e-6))
    lo, hi = np.percentile(db, 10), np.percentile(db, 99)
    norm = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1)
    # Light smoothing (~15 s) so the curve reads as a shape, not noise
    if len(norm) >= 5:
        norm = np.convolve(norm, np.ones(5) / 5, mode="same")
    grid = np.linspace(0, duration, points)
    return [round(float(v), 3) for v in np.interp(grid, times, norm)]


def chat_histogram(chat_messages: list[dict], duration: float, bins: int = CHAT_BINS) -> list[int]:
    """Number of chat messages in each of `bins` slices of the live."""
    if duration <= 0:
        return []
    stamps = [m["timestamp"] for m in chat_messages if isinstance(m.get("timestamp"), (int, float))]
    counts, _ = np.histogram(stamps, bins=bins, range=(0, duration))
    return [int(c) for c in counts]


def publish(job_id: str, **timeline) -> None:
    """Merge fields into the job's timeline (duration, energy, chat, candidates)."""
    api_events.publish({"job_id": job_id, "type": "timeline", "timeline": timeline})


def publish_candidate(job_id: str, candidate: dict) -> None:
    """One candidate passage changed (rated by the AI, kept, dropped)."""
    api_events.publish({"job_id": job_id, "type": "candidate", "candidate": candidate})


def candidate(hp, state: str) -> dict:
    """Timeline entry for a hot point: where it is, what the AI thought of it."""
    entry = {"t": round(float(hp.timestamp_seconds), 1), "state": state}
    if hp.final_score is not None:
        entry["score"] = round(float(hp.final_score), 3)
    if hp.clip_name:
        entry["name"] = hp.clip_name
    if hp.llm and hp.llm.category:
        entry["category"] = hp.llm.category
    return entry
