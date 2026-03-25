"""Whisper transcription + GPT analysis of hot point clips."""

import json
import logging
import os
import subprocess

from openai import OpenAI

from app.models.schemas import HotPoint, LlmAnalysis
from app.services.db import save_hot_points, update_hot_point_llm

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"


def _get_client() -> OpenAI:
    return OpenAI()


def _extract_audio_segment(clip_path: str, output_path: str) -> bool:
    """Extract audio from clip as mp3 for Whisper (much smaller than video)."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", clip_path,
                "-vn",  # no video
                "-c:a", "libmp3lame", "-b:a", "64k",
                output_path,
            ],
            check=True,
            timeout=30,
            capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return False


def transcribe_clip(clip_path: str) -> tuple[str, float]:
    """Transcribe a clip using Whisper API.

    Returns (transcript_text, speech_rate_words_per_sec).
    """
    client = _get_client()

    # Extract audio as mp3 (Whisper has 25MB limit, mp3 is much smaller)
    audio_path = clip_path.replace(".mp4", "_audio.mp3")
    if not _extract_audio_segment(clip_path, audio_path):
        return "", 0.0

    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        text = result.text or ""
        words = text.split()
        word_count = len(words)

        # Compute speech rate from segment timestamps
        duration = 0.0
        if hasattr(result, "segments") and result.segments:
            duration = max(s.end for s in result.segments)

        speech_rate = word_count / duration if duration > 0 else 0.0

        return text, speech_rate

    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return "", 0.0
    finally:
        if os.path.isfile(audio_path):
            os.remove(audio_path)


def analyze_with_llm(
    transcript: str,
    speech_rate: float,
    score: float,
    timestamp_display: str,
    vod_title: str,
) -> LlmAnalysis:
    """Send transcript to GPT for viral potential analysis."""
    client = _get_client()

    prompt = f"""Tu es un expert en contenu viral pour Twitch/YouTube. Analyse cet extrait d'un stream Twitch.

**Stream:** {vod_title}
**Timestamp:** {timestamp_display}
**Score heuristique audio:** {score:.0%}
**Debit de parole:** {speech_rate:.1f} mots/seconde
**Transcription:**
{transcript if transcript else "(pas de parole détectée)"}

Analyse cet extrait et retourne un JSON avec exactement ces champs:
- "category": une catégorie parmi: "fun", "rage", "clutch", "skill", "fail", "emotional", "reaction", "storytelling", "awkward", "hype" (choisis la plus pertinente)
- "virality_score": un score de 0 à 1 estimant le potentiel viral (0 = pas intéressant, 1 = clip gold)
- "summary": une description courte (1-2 phrases) de ce qui se passe dans cet extrait, en français
- "is_clipable": true si l'extrait peut fonctionner seul comme clip, false s'il nécessite du contexte

Retourne UNIQUEMENT le JSON, sans markdown ni explication."""

    try:
        response = client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=300,
        )

        content = response.choices[0].message.content.strip()
        # Clean potential markdown wrapping
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        data = json.loads(content)

        return LlmAnalysis(
            transcript=transcript,
            speech_rate=round(speech_rate, 2),
            category=data.get("category", ""),
            virality_score=float(data.get("virality_score", 0)),
            summary=data.get("summary", ""),
            is_clipable=bool(data.get("is_clipable", True)),
        )

    except Exception as e:
        logger.error(f"LLM analysis failed: {e}")
        return LlmAnalysis(
            transcript=transcript,
            speech_rate=round(speech_rate, 2),
        )


HEURISTIC_WEIGHT = 0.3
LLM_WEIGHT = 0.7


def analyze_hot_points(
    job_id: str,
    hot_points: list[HotPoint],
    vod_title: str,
    max_analyze: int = 20,
) -> None:
    """Run Whisper + LLM analysis on hot points that have clips, then re-rank by final score."""
    for i, hp in enumerate(hot_points):
        if not hp.clip_filename:
            continue

        rank = i + 1
        clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)
        if not os.path.isfile(clip_path):
            continue

        logger.info(f"Analyzing clip {rank}/{len(hot_points)}: {hp.timestamp_display}")

        # Step 1: Whisper transcription
        transcript, speech_rate = transcribe_clip(clip_path)

        # Step 2: LLM analysis
        llm = analyze_with_llm(
            transcript=transcript,
            speech_rate=speech_rate,
            score=hp.score,
            timestamp_display=hp.timestamp_display,
            vod_title=vod_title,
        )

        hp.llm = llm

        # Step 3: Compute final score (heuristic + LLM blend)
        hp.final_score = round(
            HEURISTIC_WEIGHT * hp.score + LLM_WEIGHT * llm.virality_score, 3
        )

        logger.info(
            f"Clip {rank}: category={llm.category}, "
            f"virality={llm.virality_score:.0%}, final={hp.final_score:.0%}"
        )

    # Re-sort all hot points by final_score (LLM-analyzed first, then heuristic-only)
    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )

    # Persist re-ranked hot points (updates ranks in DB)
    save_hot_points(job_id, hot_points)
    logger.info("Hot points re-ranked by final score")
