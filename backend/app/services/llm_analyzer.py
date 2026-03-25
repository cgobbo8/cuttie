"""Whisper transcription + Vision analysis + GPT synthesis of hot point clips.

Pipeline per clip:
1. Whisper transcription (get text + segment timestamps)
2. Frame extraction (at segment timestamps + regular intervals)
3. Vision analysis (GPT-4.1 with frames → key moments)
4. Synthesis (GPT-4.1: transcript + vision → category, virality, narrative)
"""

import json
import logging
import os
import subprocess

from openai import OpenAI

from app.models.schemas import HotPoint, KeyMoment, LlmAnalysis
from app.services.db import save_hot_points
from app.services.frame_extractor import extract_frames
from app.services.vision_analyzer import analyze_clip_frames

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"
HEURISTIC_WEIGHT = 0.3
LLM_WEIGHT = 0.7


def _get_client() -> OpenAI:
    return OpenAI()


def _extract_audio_segment(clip_path: str, output_path: str) -> bool:
    """Extract audio from clip as mp3 for Whisper (much smaller than video)."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", clip_path,
                "-vn",
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


def transcribe_clip(clip_path: str) -> tuple[str, float, list[float]]:
    """Transcribe a clip using Whisper API.

    Returns (transcript_text, speech_rate, segment_start_timestamps).
    """
    client = _get_client()

    audio_path = clip_path.replace(".mp4", "_audio.mp3")
    if not _extract_audio_segment(clip_path, audio_path):
        return "", 0.0, []

    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        text = result.text or ""
        word_count = len(text.split())

        segment_times: list[float] = []
        duration = 0.0
        if hasattr(result, "segments") and result.segments:
            segment_times = [s.start for s in result.segments]
            duration = max(s.end for s in result.segments)

        speech_rate = word_count / duration if duration > 0 else 0.0
        return text, speech_rate, segment_times

    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return "", 0.0, []
    finally:
        if os.path.isfile(audio_path):
            os.remove(audio_path)


def synthesize_analysis(
    transcript: str,
    speech_rate: float,
    key_moments: list[dict],
    score: float,
    timestamp_display: str,
    vod_title: str,
) -> LlmAnalysis:
    """Final synthesis: combine transcript + vision moments into full analysis.

    Uses GPT-4.1 for best intelligence on categorization and narrative.
    """
    client = _get_client()

    moments_text = ""
    if key_moments:
        moments_text = "\n**Moments clés visuels identifiés :**\n"
        for m in key_moments:
            moments_text += f"- [{m['time']:.0f}s] {m['label']}: {m.get('description', '')}\n"

    prompt = f"""Tu es un expert en contenu viral pour Twitch/YouTube. Analyse cet extrait d'un stream Twitch en combinant la transcription audio ET l'analyse visuelle.

**Stream:** {vod_title}
**Timestamp dans le VOD:** {timestamp_display}
**Score heuristique audio:** {score:.0%}
**Debit de parole:** {speech_rate:.1f} mots/seconde

**Transcription:**
{transcript if transcript else "(pas de parole détectée)"}
{moments_text}

Retourne un JSON avec ces champs:
- "category": parmi "fun", "rage", "clutch", "skill", "fail", "emotional", "reaction", "storytelling", "awkward", "hype"
- "virality_score": 0 à 1 (potentiel viral réel, sois exigeant: 0.8+ = moment gold, 0.5+ = bon clip, <0.3 = pas intéressant)
- "summary": description courte (1-2 phrases) de ce qui se passe, en français
- "is_clipable": true si ça marche seul comme clip
- "narrative": un récit fluide de ce qui se passe dans le clip, seconde par seconde, en combinant ce qui est dit ET ce qui est vu. 3-5 phrases vivantes, en français. C'est le "film" du clip.

Retourne UNIQUEMENT le JSON, sans markdown."""

    try:
        response = client.chat.completions.create(
            model="gpt-5.4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_completion_tokens=600,
        )

        content = response.choices[0].message.content.strip()
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
            narrative=data.get("narrative", ""),
            key_moments=[
                KeyMoment(**m) for m in key_moments
            ] if key_moments else [],
        )

    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        return LlmAnalysis(
            transcript=transcript,
            speech_rate=round(speech_rate, 2),
            key_moments=[
                KeyMoment(**m) for m in key_moments
            ] if key_moments else [],
        )


def analyze_single_clip(
    job_id: str,
    clip_index: int,
    hp: HotPoint,
    vod_title: str,
) -> None:
    """Full analysis pipeline for a single clip: Whisper → Frames → Vision → Synthesis."""
    clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)

    # Step 1: Whisper transcription
    logger.info(f"  [1/4] Whisper transcription...")
    transcript, speech_rate, segment_times = transcribe_clip(clip_path)

    # Step 2: Extract frames
    logger.info(f"  [2/4] Frame extraction...")
    frames = extract_frames(clip_path, job_id, clip_index, segment_times)

    # Step 3: Vision analysis (key moments from frames)
    key_moments: list[dict] = []
    if frames:
        logger.info(f"  [3/4] Vision analysis ({len(frames)} frames)...")
        key_moments = analyze_clip_frames(frames, transcript, vod_title)
    else:
        logger.info(f"  [3/4] Vision analysis skipped (no frames)")

    # Step 4: Final synthesis
    logger.info(f"  [4/4] Synthesis...")
    llm = synthesize_analysis(
        transcript=transcript,
        speech_rate=speech_rate,
        key_moments=key_moments,
        score=hp.score,
        timestamp_display=hp.timestamp_display,
        vod_title=vod_title,
    )

    hp.llm = llm
    hp.final_score = round(
        HEURISTIC_WEIGHT * hp.score + LLM_WEIGHT * llm.virality_score, 3
    )

    logger.info(
        f"  → category={llm.category}, virality={llm.virality_score:.0%}, "
        f"final={hp.final_score:.0%}, moments={len(llm.key_moments)}"
    )


def analyze_hot_points(
    job_id: str,
    hot_points: list[HotPoint],
    vod_title: str,
    max_analyze: int = 20,
) -> None:
    """Run full analysis (Whisper + Vision + LLM) on hot points with clips, then re-rank."""
    analyzed = 0

    for i, hp in enumerate(hot_points):
        if not hp.clip_filename:
            continue

        clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)
        if not os.path.isfile(clip_path):
            continue

        if analyzed >= max_analyze:
            break

        analyzed += 1
        logger.info(f"Analyzing clip {analyzed}/{min(max_analyze, len(hot_points))}: {hp.timestamp_display}")

        try:
            analyze_single_clip(job_id, i + 1, hp, vod_title)
        except Exception as e:
            logger.error(f"Analysis failed for clip at {hp.timestamp_display}: {e}")
            # Continue with next clip instead of failing everything

    # Re-sort by final_score
    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )

    # Persist re-ranked hot points
    save_hot_points(job_id, hot_points)
    logger.info(f"Analysis complete: {analyzed} clips analyzed, hot points re-ranked")
