"""LLM triage pass — light analysis on audio-only segments to filter candidates.

Pipeline:
1. Extract audio segments from full WAV for top N candidates
2. Whisper transcription (parallel)
3. Light LLM triage in batches: transcript + chat + signals -> interest score
4. Re-rank and return top K with pre-computed transcripts for reuse
"""

import json
import logging
import os
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint
from app.services.clipper import POST_PEAK_WINDOW, PRE_PEAK_WINDOW
from app.services.db import save_hot_points, update_job
from app.services.llm_analyzer import _extract_chat_for_clip
from app.services.openai_client import get_openai_client, get_groq_client, LLM_MODEL, WHISPER_MODEL

logger = logging.getLogger(__name__)

TRIAGE_DIR = "triage_audio"
MAX_TRIAGE_WORKERS = 5
TRIAGE_BATCH_SIZE = 10

# Triage blending weights
HEURISTIC_TRIAGE_W = 0.4
LLM_TRIAGE_W = 0.6


def _extract_audio_segment(
    audio_path: str, start: float, end: float, output_path: str
) -> bool:
    """Extract audio segment from full WAV as mp3 for Whisper."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", audio_path,
                "-ss", str(start),
                "-t", str(end - start),
                "-vn",
                "-c:a", "libmp3lame", "-b:a", "64k",
                output_path,
            ],
            check=True,
            timeout=15,
            capture_output=True,
        )
        return os.path.isfile(output_path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning("Failed to extract triage audio segment %s: %s", output_path, e)
        return False


def _transcribe_segment(segment_path: str) -> tuple[str, float]:
    """Transcribe an audio segment via Whisper API.

    Returns (transcript_text, speech_rate).
    """
    client = get_groq_client()
    try:
        with open(segment_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=f,
                response_format="verbose_json",
            )

        text = result.text or ""
        word_count = len(text.split())

        duration = 0.0
        if hasattr(result, "segments") and result.segments:
            duration = max(s.end for s in result.segments)

        speech_rate = word_count / duration if duration > 0 else 0.0
        return text, speech_rate

    except Exception as e:
        logger.error(f"Whisper triage transcription failed: {e}")
        return "", 0.0


def _triage_batch(
    candidates: list[dict],
    vod_meta: dict,
) -> list[dict]:
    """Send a batch of candidates to LLM for quick interest scoring.

    Returns list of {"idx": N, "interest": 0.X}.
    """
    client = get_openai_client()

    vod_title = vod_meta.get("title", "")
    vod_game = vod_meta.get("game", "")
    streamer = vod_meta.get("streamer", "")

    candidates_text = ""
    for c in candidates:
        mood_line = f"\nMood chat: {c['chat_mood']}" if c["chat_mood"] else ""
        signals = c.get("signals")
        if signals:
            signals_line = (
                f"\nSignaux: volume={signals.rms:.0%}, chat={signals.chat_speed:.0%}, "
                f"flux={signals.spectral_flux:.0%}, pitch={signals.pitch_variance:.0%}"
            )
        else:
            signals_line = ""
        candidates_text += f"""
---
**Candidat #{c['idx']}** — {c['timestamp_display']} (score heuristique: {c['score']:.0%})
{signals_line}
Transcription: {c['transcript'] if c['transcript'] else '(silence)'}
Chat: {c['chat_context'] if c['chat_context'] else '(pas de chat)'}
{mood_line}
"""

    prompt = f"""Tu es un expert en détection de moments viraux sur Twitch.
Stream: {vod_title} | {streamer} | {vod_game}

Voici {len(candidates)} candidats potentiels pour des clips viraux. Pour chacun, tu as la transcription audio et les messages chat.

{candidates_text}

Pour CHAQUE candidat, évalue son potentiel viral de 0 à 1 :
- 0.8+ = moment gold (réaction forte, clutch, fail épique, moment drôle évident)
- 0.5-0.8 = intéressant (réaction notable, gameplay intense, conversation engageante)
- 0.2-0.5 = moyen (activité mais rien de remarquable)
- <0.2 = à skip (bruit de fond, silence, conversation banale)

Retourne un JSON object :
{{"results": [{{"idx": N, "interest": 0.X}}, ...]}}

Sois exigeant. JSON uniquement, pas de markdown."""

    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_completion_tokens=1000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content.strip()
        parsed = json.loads(content)

        # json_object mode returns an object — extract the array
        if isinstance(parsed, dict):
            for v in parsed.values():
                if isinstance(v, list):
                    return v
        if isinstance(parsed, list):
            return parsed
        return []

    except Exception as e:
        logger.error(f"Triage LLM call failed: {e}")
        return [{"idx": c["idx"], "interest": c["score"]} for c in candidates]


def run_triage(
    job_id: str,
    audio_path: str,
    hot_points: list[HotPoint],
    vod_duration: float,
    chat_messages: list[dict],
    vod_meta: dict,
    candidates_n: int = 50,
    keep_n: int = 20,
) -> tuple[list[HotPoint], dict[int, tuple[str, float]]]:
    """Run LLM triage on top candidates, return filtered list + transcripts.

    Returns:
        (filtered_hot_points, transcripts_dict)
        transcripts_dict: maps index in filtered list -> (transcript, speech_rate)
    """
    candidates = hot_points[:candidates_n]

    # Skip triage if we already have fewer than keep_n
    if len(candidates) <= keep_n:
        logger.info(f"Triage: only {len(candidates)} candidates, skipping (need > {keep_n})")
        return candidates, {}

    triage_dir = os.path.join(TRIAGE_DIR, job_id)
    os.makedirs(triage_dir, exist_ok=True)

    try:
        # ── Step 1: Extract audio segments + transcribe in parallel ──
        logger.info(f"Triage: transcribing {len(candidates)} audio segments")
        update_job(
            job_id, status="TRIAGE",
            progress=f"Pre-analyse : transcription de {len(candidates)} segments...",
        )

        transcripts: dict[int, tuple[str, float]] = {}

        def _extract_and_transcribe(idx: int, hp: HotPoint) -> tuple[int, str, float]:
            start = max(0, hp.timestamp_seconds - PRE_PEAK_WINDOW)
            end = min(vod_duration, hp.timestamp_seconds + POST_PEAK_WINDOW)

            segment_path = os.path.join(triage_dir, f"seg_{idx:03d}.mp3")
            if _extract_audio_segment(audio_path, start, end, segment_path):
                transcript, speech_rate = _transcribe_segment(segment_path)
                if os.path.isfile(segment_path):
                    os.remove(segment_path)
                return idx, transcript, speech_rate
            return idx, "", 0.0

        with ThreadPoolExecutor(max_workers=MAX_TRIAGE_WORKERS) as executor:
            futures = {
                executor.submit(_extract_and_transcribe, i, hp): i
                for i, hp in enumerate(candidates)
            }

            done = 0
            for future in as_completed(futures):
                done += 1
                try:
                    idx, transcript, speech_rate = future.result()
                    transcripts[idx] = (transcript, speech_rate)
                    if done % 10 == 0 or done == len(candidates):
                        update_job(
                            job_id,
                            progress=f"Pre-analyse : {done}/{len(candidates)} transcriptions...",
                        )
                except Exception as e:
                    idx = futures[future]
                    logger.error(f"Triage transcription failed for candidate {idx}: {e}")
                    transcripts[idx] = ("", 0.0)

        logger.info(f"Triage: {len(transcripts)} transcriptions done, running LLM scoring")
        update_job(
            job_id,
            progress=f"Pre-analyse : evaluation LLM de {len(candidates)} candidats...",
        )

        # ── Step 2: Build candidate data for LLM ──
        candidate_data = []
        for i, hp in enumerate(candidates):
            transcript, _ = transcripts.get(i, ("", 0.0))

            clip_start = max(0, hp.timestamp_seconds - PRE_PEAK_WINDOW)
            clip_end = hp.timestamp_seconds + POST_PEAK_WINDOW
            chat_context = _extract_chat_for_clip(chat_messages, clip_start, clip_end)

            candidate_data.append({
                "idx": i,
                "timestamp_display": hp.timestamp_display,
                "score": hp.score,
                "signals": hp.signals,
                "transcript": transcript,
                "chat_context": chat_context,
                "chat_mood": hp.chat_mood,
            })

        # ── Step 3: LLM triage in batches ──
        triage_scores: dict[int, float] = {}

        for batch_start in range(0, len(candidate_data), TRIAGE_BATCH_SIZE):
            batch = candidate_data[batch_start:batch_start + TRIAGE_BATCH_SIZE]
            results = _triage_batch(batch, vod_meta)
            for r in results:
                triage_scores[r["idx"]] = float(r.get("interest", 0.5))

        # ── Step 4: Blend scores and select top K ──
        scored = []
        for i, hp in enumerate(candidates):
            interest = triage_scores.get(i, 0.5)
            blended = HEURISTIC_TRIAGE_W * hp.score + LLM_TRIAGE_W * interest
            scored.append((blended, interest, i, hp))

        scored.sort(key=lambda x: x[0], reverse=True)

        for blended, interest, i, hp in scored[:keep_n]:
            transcript, _ = transcripts.get(i, ("", 0.0))
            preview = (transcript[:60] + "...") if len(transcript) > 60 else transcript
            logger.info(
                f"  KEEP #{i}: {hp.timestamp_display} | "
                f"heuristic={hp.score:.0%} interest={interest:.0%} "
                f"-> triage={blended:.0%} | {preview}"
            )
        for blended, interest, i, hp in scored[keep_n:]:
            logger.info(
                f"  SKIP #{i}: {hp.timestamp_display} | "
                f"heuristic={hp.score:.0%} interest={interest:.0%} "
                f"-> triage={blended:.0%}"
            )

        # Build outputs
        kept = scored[:keep_n]
        filtered_hps = [hp for _, _, _, hp in kept]

        filtered_transcripts: dict[int, tuple[str, float]] = {}
        for new_idx, (_, _, orig_idx, _) in enumerate(kept):
            if orig_idx in transcripts:
                filtered_transcripts[new_idx] = transcripts[orig_idx]

        logger.info(f"Triage complete: kept {len(filtered_hps)}/{len(candidates)} candidates")

        save_hot_points(job_id, filtered_hps)
        return filtered_hps, filtered_transcripts

    finally:
        if os.path.exists(triage_dir):
            shutil.rmtree(triage_dir, ignore_errors=True)
