"""Whisper transcription + Vision analysis + GPT synthesis of hot point clips.

Pipeline per clip:
1. Whisper transcription (get text + segment timestamps)
2. Frame extraction (at segment timestamps + regular intervals)
3. Vision analysis (GPT-5.4 with frames → key moments with precise timestamps)
4. Synthesis (GPT-5.4: transcript + vision → category, virality, summary, narrative)
"""

import json
import logging
import os
import subprocess

from openai import OpenAI

from app.models.schemas import HotPoint, KeyMoment, LlmAnalysis
from app.services.db import save_hot_points, update_job
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


def _extract_chat_for_clip(
    chat_messages: list[dict],
    clip_start: float,
    clip_end: float,
    max_messages: int = 80,
) -> str:
    """Extract chat messages within a clip's time window, formatted for LLM context."""
    relevant = [
        m for m in chat_messages
        if clip_start <= m["timestamp"] <= clip_end
    ]
    if not relevant:
        return ""

    # If too many messages, sample evenly
    if len(relevant) > max_messages:
        step = len(relevant) / max_messages
        relevant = [relevant[int(i * step)] for i in range(max_messages)]

    lines = []
    for m in relevant:
        offset = m["timestamp"] - clip_start
        lines.append(f"[{offset:.0f}s] {m['author']}: {m['text']}")

    return "\n".join(lines)


def synthesize_analysis(
    transcript: str,
    speech_rate: float,
    key_moments: list[dict],
    score: float,
    timestamp_display: str,
    vod_meta: dict,
    chat_context: str = "",
    chat_mood: str = "",
) -> LlmAnalysis:
    """Final synthesis: combine transcript + vision moments into full analysis."""
    client = _get_client()

    vod_title = vod_meta.get("title", "")
    vod_game = vod_meta.get("game", "")
    streamer = vod_meta.get("streamer", "")
    view_count = vod_meta.get("view_count", 0)
    stream_date = vod_meta.get("stream_date", "")
    vod_duration = vod_meta.get("duration", 0)

    moments_text = ""
    if key_moments:
        moments_text = "\n**Moments clés identifiés par analyse visuelle :**\n"
        for m in key_moments:
            moments_text += f"- [{m['time']:.1f}s] {m['label']}: {m.get('description', '')}\n"

    # Build VOD identity card
    duration_h = int(vod_duration // 3600)
    duration_m = int((vod_duration % 3600) // 60)
    identity_lines = [f"**Stream:** {vod_title}"]
    if streamer:
        identity_lines.append(f"**Streamer:** {streamer}")
    if vod_game:
        identity_lines.append(f"**Jeu:** {vod_game}")
    if stream_date:
        identity_lines.append(f"**Date:** {stream_date}")
    if vod_duration:
        identity_lines.append(f"**Durée du stream:** {duration_h}h{duration_m:02d}")
    if view_count:
        identity_lines.append(f"**Vues:** {view_count}")

    # Add chat mood pre-tag if available
    mood_labels = {"hype": "Hype/Skill (PogChamp, GG...)", "fun": "Humour/Fail (KEKW, LUL...)", "rip": "Mort/Sadness (F, RIP...)"}
    if chat_mood and chat_mood in mood_labels:
        identity_lines.append(f"**Mood chat détecté:** {mood_labels[chat_mood]}")

    identity_card = "\n".join(identity_lines)

    chat_section = ""
    if chat_context:
        chat_section = f"""

**Chat Twitch (messages des viewers pendant le clip) :**
{chat_context}

Note sur le chat : ce streamer a une petite communauté. Le chat mélange des viewers classiques et des amis proches du streamer qui font parfois des private jokes. Utilise le chat comme indicateur de réaction (emotes, exclamations, questions) mais ne te fie pas aveuglément aux messages — distingue les réactions spontanées des conversations entre potes."""

    prompt = f"""Tu es un expert en contenu viral pour Twitch/YouTube. Analyse cet extrait de stream.

{identity_card}
**Timestamp:** {timestamp_display}
**Score audio:** {score:.0%}
**Debit:** {speech_rate:.1f} mots/s

**Transcription :**
{transcript if transcript else "(silence / pas de parole)"}
{moments_text}{chat_section}

Hiérarchie des sources : en cas de contradiction entre les sources, la transcription (ce que dit le streamer) prime sur les visuels pour déterminer l'émotion et la catégorie. Les visuels servent à comprendre le contexte gameplay.

Retourne un JSON:
- "category": parmi "fun", "rage", "clutch", "skill", "fail", "emotional", "reaction", "storytelling", "awkward", "hype"
- "virality_score": 0 à 1 (sois exigeant : 0.8+ = gold, 0.5+ = bon, <0.3 = bof). Les réactions intenses du streamer sont virales, qu'elles soient positives ou négatives.
- "summary": UNE SEULE phrase punch de 10-15 mots max, style titre de clip YouTube/TikTok. Doit donner envie de cliquer. En français.
- "is_clipable": true si compréhensible seul
- "narrative": récit fluide du clip (3-5 phrases), ce qui se passe seconde par seconde en combinant audio + visuels + réactions chat{", en mentionnant le gameplay de " + vod_game if vod_game else ""}. En français.

JSON uniquement, pas de markdown."""

    try:
        response = client.chat.completions.create(
            model="gpt-5.4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
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
            key_moments=[KeyMoment(**m) for m in key_moments] if key_moments else [],
        )

    except Exception as e:
        logger.error(f"Synthesis failed: {e}")
        return LlmAnalysis(
            transcript=transcript,
            speech_rate=round(speech_rate, 2),
            key_moments=[KeyMoment(**m) for m in key_moments] if key_moments else [],
        )


def analyze_single_clip(
    job_id: str,
    clip_index: int,
    hp: HotPoint,
    vod_meta: dict,
    chat_messages: list[dict] | None = None,
    pre_transcript: tuple[str, float] | None = None,
) -> None:
    """Full analysis pipeline for a single clip.

    If pre_transcript is provided (from triage), skips Whisper transcription.
    """
    clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)
    vod_title = vod_meta.get("title", "")
    vod_game = vod_meta.get("game", "")

    # Step 1: Whisper transcription (skip if pre-computed from triage)
    segment_times: list[float] = []
    if pre_transcript:
        transcript, speech_rate = pre_transcript
        logger.info(f"  [1/4] Whisper skipped (reusing triage transcript)")
    else:
        logger.info(f"  [1/4] Whisper transcription...")
        transcript, speech_rate, segment_times = transcribe_clip(clip_path)

    # Step 2: Extract frames (denser for better timestamp precision)
    logger.info(f"  [2/4] Frame extraction...")
    frames = extract_frames(clip_path, job_id, clip_index, segment_times)

    # Step 3: Vision analysis
    key_moments: list[dict] = []
    if frames:
        logger.info(f"  [3/4] Vision analysis ({len(frames)} frames)...")
        key_moments = analyze_clip_frames(frames, transcript, vod_title, vod_game)
    else:
        logger.info(f"  [3/4] Vision skipped (no frames)")

    # Extract chat messages for this clip's time window
    chat_context = ""
    if chat_messages:
        from app.services.clipper import CLIP_HALF_DURATION
        clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
        clip_end = hp.timestamp_seconds + CLIP_HALF_DURATION
        chat_context = _extract_chat_for_clip(chat_messages, clip_start, clip_end)
        if chat_context:
            logger.info(f"  Chat context: {chat_context.count(chr(10)) + 1} messages")

    # Step 4: Final synthesis
    logger.info(f"  [4/4] Synthesis...")
    llm = synthesize_analysis(
        transcript=transcript,
        speech_rate=speech_rate,
        key_moments=key_moments,
        score=hp.score,
        timestamp_display=hp.timestamp_display,
        vod_meta=vod_meta,
        chat_context=chat_context,
        chat_mood=hp.chat_mood,
    )

    hp.llm = llm
    hp.final_score = round(
        HEURISTIC_WEIGHT * hp.score + LLM_WEIGHT * llm.virality_score, 3
    )

    logger.info(
        f"  → {llm.category} | viral={llm.virality_score:.0%} | "
        f"final={hp.final_score:.0%} | {len(llm.key_moments)} moments"
    )


MAX_LLM_WORKERS = 3  # Parallel clip analyses (API-bound, not CPU-bound)


def analyze_hot_points(
    job_id: str,
    hot_points: list[HotPoint],
    vod_meta: dict,
    max_analyze: int = 20,
    chat_messages: list[dict] | None = None,
    transcripts: dict[int, tuple[str, float]] | None = None,
) -> None:
    """Run full analysis on hot points with clips in parallel, then re-rank.

    If transcripts dict is provided (from triage), reuses them to skip Whisper.
    Keys are hot_point indices matching to_analyze ordering.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    # Collect clips to analyze
    to_analyze: list[tuple[int, HotPoint]] = []
    for i, hp in enumerate(hot_points):
        if not hp.clip_filename:
            continue
        clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)
        if not os.path.isfile(clip_path):
            continue
        to_analyze.append((i, hp))
        if len(to_analyze) >= max_analyze:
            break

    total = len(to_analyze)
    logger.info(f"Analyzing {total} clips with {MAX_LLM_WORKERS} parallel workers")
    if transcripts:
        logger.info(f"  ({len(transcripts)} pre-computed transcripts from triage)")

    def _analyze_one(item: tuple[int, HotPoint]) -> None:
        idx, hp = item
        pre_transcript = transcripts.get(idx) if transcripts else None
        analyze_single_clip(
            job_id, idx + 1, hp, vod_meta,
            chat_messages=chat_messages,
            pre_transcript=pre_transcript,
        )

    with ThreadPoolExecutor(max_workers=MAX_LLM_WORKERS) as executor:
        futures = {}
        for item in to_analyze:
            future = executor.submit(_analyze_one, item)
            futures[future] = item

        done = 0
        for future in as_completed(futures):
            idx, hp = futures[future]
            done += 1
            try:
                future.result()
                logger.info(f"Clip {done}/{total} done: {hp.timestamp_display}")
                update_job(job_id, progress=f"Analyse IA : {done}/{total} clips ({hp.timestamp_display})")
            except Exception as e:
                logger.error(f"Analysis failed for clip at {hp.timestamp_display}: {e}")

    # Re-sort by final_score
    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )

    # Persist re-ranked hot points
    save_hot_points(job_id, hot_points)
    logger.info(f"Analysis complete: {total} clips analyzed, re-ranked")
