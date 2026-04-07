"""Unified LLM analysis of hot point candidates.

Two modes:
- analyze_candidates(): PRE-CLIPPING — extracts frames from VOD URL + audio segments
  from WAV, runs unified LLM, re-ranks and keeps top N. No video download needed.
- analyze_single_clip(): POST-CLIPPING — re-analyzes a single clip from local file
  (used for resume/retry).

Pipeline per candidate (pre-clipping):
1. Extract audio segment from WAV → Whisper transcription
2. Extract 6 frames from VOD URL via ffmpeg seek
3. Unified LLM call (frames + transcript + chat → score + analysis)
"""

import base64
import json
import logging
import os
import re
import shutil
import subprocess
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint, KeyMoment, LlmAnalysis, VodContext
from app.services.clipper import CLIP_HALF_DURATION
from app.services.db import save_hot_points, update_job
from app.services.frame_extractor import (
    NUM_FRAMES,
    extract_frames,
    extract_frames_from_url,
    get_vod_direct_url,
)
from app.services.openai_client import get_groq_client, get_openrouter_client, LLM_MODEL, WHISPER_MODEL

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"
HEURISTIC_WEIGHT = 0.2
LLM_WEIGHT = 0.8
MAX_LLM_WORKERS = 5  # Parallel LLM calls (API-bound)
MAX_WHISPER_WORKERS = 5  # Parallel Whisper calls
KEEP_TOP_N = 20  # How many candidates to keep after LLM scoring
KEEP_NORMAL_FOR_LLM = 50  # Top N non-clip candidates that get full LLM analysis (from 100 scored)

# Keywords that indicate the streamer wants a clip
CLIP_KEYWORDS = [
    "clip", "clips", "clipped",
    "clippe", "clippez", "clipper", "clippé", "clippée", "clippable",
]


# ─── Audio extraction & transcription ────────────────────────────────────────

def _extract_audio_from_wav(
    wav_path: str, start: float, end: float, output_path: str,
) -> bool:
    """Extract an audio segment from the full WAV as mp3 for Whisper."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", wav_path,
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
        logger.warning("Failed to extract audio segment %s: %s", output_path, e)
        return False


def _extract_audio_from_clip(clip_path: str, output_path: str) -> bool:
    """Extract audio from a local clip file as mp3 for Whisper."""
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
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning("Failed to extract audio from %s: %s", clip_path, e)
        return False


def _transcribe_audio(
    audio_path: str,
) -> tuple[str, float, list[tuple[float, float, str]], list[dict]]:
    """Transcribe an audio file using Whisper API via Groq.

    Returns (transcript_text, speech_rate, segments, words) where:
    - segments: list of (start, end, text) tuples
    - words: list of {"word": str, "start": float, "end": float}
    """
    client = get_groq_client()
    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
            )

        text = result.text or ""
        word_count = len(text.split())

        segments: list[tuple[float, float, str]] = []
        duration = 0.0
        if hasattr(result, "segments") and result.segments:
            duration = max(s.end for s in result.segments)
            segments = [(s.start, s.end, s.text) for s in result.segments]

        words: list[dict] = []
        if hasattr(result, "words") and result.words:
            for w in result.words:
                words.append({"word": w.word, "start": w.start, "end": w.end})
            if not duration and words:
                duration = words[-1]["end"]

        speech_rate = word_count / duration if duration > 0 else 0.0
        return text, speech_rate, segments, words

    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return "", 0.0, [], []


def _transcribe_candidates(
    wav_path: str,
    candidates: list[tuple[int, HotPoint]],
    vod_duration: float,
    job_id: str,
) -> dict[int, tuple[str, float, float, list[tuple[float, float, str]], list[dict]]]:
    """Transcribe audio segments for all candidates in parallel.

    Extracts clip audio from the full WAV and transcribes via Whisper.

    Returns dict: candidate_index -> (transcript_text, speech_rate,
                                       clip_start_abs, raw_segments, words).
    clip_start_abs is the absolute VOD timestamp where the clip begins.
    raw_segments are Whisper (start, end, text) tuples relative to clip_start_abs.
    words are word-level timestamps for subtitle generation.
    """
    triage_dir = os.path.join("triage_audio", job_id)
    os.makedirs(triage_dir, exist_ok=True)

    total = len(candidates)
    logger.info(f"Transcribing {total} candidates with {MAX_WHISPER_WORKERS} workers...")
    t0 = _time.time()

    transcripts: dict[int, tuple[str, float, float, list[tuple[float, float, str]], list[dict]]] = {}

    def _do_one(idx: int, hp: HotPoint) -> tuple[int, str, float, float, list, list[dict]]:
        # Use pre-computed RMS bounds if available, else ±30s fallback
        if hp.clip_start is not None and hp.clip_end is not None:
            clip_start, clip_end = hp.clip_start, hp.clip_end
        else:
            clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
            clip_end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)

        seg_path = os.path.join(triage_dir, f"seg_{idx:03d}.mp3")

        if _extract_audio_from_wav(wav_path, clip_start, clip_end, seg_path):
            text, speech_rate, segments, words = _transcribe_audio(seg_path)
            # Keep MP3 for LLM audio analysis — cleaned up after analyze_candidates
            return idx, text, speech_rate, clip_start, segments, words
        return idx, "", 0.0, 0.0, [], []

    with ThreadPoolExecutor(max_workers=MAX_WHISPER_WORKERS) as executor:
        futures = {
            executor.submit(_do_one, idx, hp): idx
            for idx, hp in candidates
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                idx, text, speech_rate, clip_start, segments, words = future.result()
                transcripts[idx] = (text, speech_rate, clip_start, segments, words)
                if done % 10 == 0 or done == total:
                    logger.info(f"Whisper progress: {done}/{total}")
                    update_job(job_id, progress=f"Transcription : {done} sur {total} segments...")
            except Exception as e:
                idx = futures[future]
                logger.error(f"Whisper failed for candidate {idx}: {e}")
                transcripts[idx] = ("", 0.0, 0.0, [], [])

    elapsed = _time.time() - t0
    non_empty = sum(1 for t in transcripts.values() if t[0])
    logger.info(f"Transcription complete: {non_empty}/{total} with speech in {elapsed:.1f}s")

    # MP3 files kept in triage_dir for LLM audio analysis — caller cleans up
    return transcripts


# ─── Frame encoding ──────────────────────────────────────────────────────────


def _encode_frame(path: str) -> str | None:
    """Encode a frame as base64 data URL for the API."""
    try:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        return f"data:image/jpeg;base64,{data}"
    except OSError as e:
        logger.debug("Failed to encode frame %s: %s", path, e)
        return None


# ─── Chat extraction ─────────────────────────────────────────────────────────

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

    if len(relevant) > max_messages:
        step = len(relevant) / max_messages
        relevant = [relevant[int(i * step)] for i in range(max_messages)]

    lines = []
    for m in relevant:
        offset = m["timestamp"] - clip_start
        lines.append(f"[{offset:.0f}s] {m['author']}: {m['text']}")

    return "\n".join(lines)


# ─── Unified prompt ──────────────────────────────────────────────────────────

def _build_unified_prompt(
    transcript: str,
    speech_rate: float,
    score: float,
    timestamp_display: str,
    vod_meta: dict,
    chat_context: str = "",
    chat_mood: str = "",
    signals: "SignalBreakdown | None" = None,
    vod_context: "VodContext | None" = None,
) -> str:
    """Build the unified analysis prompt (English, vision + synthesis in one)."""
    vod_title = vod_meta.get("title", "")
    vod_game = vod_meta.get("game", "")
    streamer = vod_meta.get("streamer", "")
    view_count = vod_meta.get("view_count", 0)
    stream_date = vod_meta.get("stream_date", "")
    vod_duration = vod_meta.get("duration", 0)

    duration_h = int(vod_duration // 3600)
    duration_m = int((vod_duration % 3600) // 60)

    # Stream identity card
    identity_lines = [f"**Stream:** {vod_title}"]
    if streamer:
        identity_lines.append(f"**Streamer:** {streamer}")
    if vod_game:
        identity_lines.append(f"**Game:** {vod_game}")
    if stream_date:
        identity_lines.append(f"**Date:** {stream_date}")
    if vod_duration:
        identity_lines.append(f"**Stream duration:** {duration_h}h{duration_m:02d}")
    if view_count:
        identity_lines.append(f"**Views:** {view_count}")

    mood_labels = {
        "hype": "Hype/Skill (PogChamp, GG...)",
        "fun": "Humor/Fail (KEKW, LUL...)",
        "rip": "Death/Sadness (F, RIP...)",
    }
    if chat_mood and chat_mood in mood_labels:
        identity_lines.append(f"**Chat mood:** {mood_labels[chat_mood]}")

    identity_card = "\n".join(identity_lines)

    # Audio signals section
    signals_text = ""
    if signals:
        signals_lines = [
            f"volume={signals.rms:.0%}",
            f"chat_activity={signals.chat_speed:.0%}",
            f"spectral_flux={signals.spectral_flux:.0%}",
            f"pitch_variance={signals.pitch_variance:.0%}",
        ]
        signals_text = "\n**Audio signals:** " + ", ".join(signals_lines)

        # Vocal analysis from PANNs (laughter, screaming, etc.)
        if signals.vocal_excitement > 0.01:
            excitement_level = (
                "very high (screaming, laughter detected)"
                if signals.vocal_excitement > 0.3
                else "moderate (some excitement detected)"
                if signals.vocal_excitement > 0.1
                else "low (mostly calm)"
            )
            signals_text += f"\n**Vocal excitement:** {excitement_level} ({signals.vocal_excitement:.0%})"
        else:
            signals_text += "\n**Vocal excitement:** none detected (calm speech or silence)"

        if signals.speech_presence > 0.01:
            signals_text += f"\n**Speech presence:** {signals.speech_presence:.0%}"

    chat_section = ""
    if chat_context:
        chat_section = f"""

**Twitch chat (viewer messages during the clip):**
{chat_context}"""

    game_narrative = f", referencing {vod_game} gameplay" if vod_game else ""

    # VOD context section (from context gathering step)
    vod_context_section = ""
    if vod_context and vod_context.summary:
        ctx_lines = [f"\n## VOD Context (full stream overview)\n{vod_context.summary}"]
        # Find the current phase for this timestamp
        if vod_context.phases:
            ctx_lines.append(f"\n**Stream phases:**")
            for phase in vod_context.phases:
                ctx_lines.append(f"- {phase.start} → {phase.end}: {phase.description}")
        if vod_context.protagonists:
            ctx_lines.append(f"\n**Known characters:**")
            for p in vod_context.protagonists:
                ctx_lines.append(f"- **{p.name}**: {p.role}")
        if vod_context.recurring_themes:
            ctx_lines.append(f"\n**Recurring themes:** {', '.join(vod_context.recurring_themes)}")
        if vod_context.mood_arc:
            ctx_lines.append(f"**Mood arc:** {vod_context.mood_arc}")
        ctx_lines.append("\nUse this context to understand WHERE this clip falls in the overall stream narrative. Clips that are part of an escalating arc or reference earlier events are MORE viral.")
        vod_context_section = "\n".join(ctx_lines)

    return f"""You are an expert at identifying viral Twitch/YouTube clip moments. Your job is to evaluate whether this clip would make a compelling standalone short video.

{identity_card}
**Timestamp:** {timestamp_display}
**Heuristic score:** {score:.0%}{signals_text}
**Speech rate:** {speech_rate:.1f} words/s

**Transcript (speaker-labeled when multiple speakers detected):**
{transcript if transcript else "(silence / no speech)"}
{chat_section}
{vod_context_section}

## Audio analysis

You have the RAW AUDIO attached to this message. LISTEN to it carefully. This is your most powerful input — you can hear:
- Voice tone, emotion, excitement, laughter, rage, sarcasm, irony
- Multiple speakers and their interactions (who's talking to whom, reactions)
- Sound effects, game audio, music, alerts
- Volume dynamics, sudden spikes, silences
- Whether people are genuinely excited or just talking loudly

The transcript above may include speaker labels (e.g. "[0.0s] Falkarst: ...", "[2.1s] SPEAKER_01: ..."). The streamer is labeled by name, other speakers are SPEAKER_XX. Use these labels to understand WHO says WHAT — this is critical for analyzing conversation dynamics (who roasts whom, who reacts, who initiates). Speaker attribution may contain errors; use the actual audio as ground truth.

## Speaker dynamics

Listen carefully to the voices in the audio and identify the conversation dynamics:

**Solo streamer:** One person talking — commentating gameplay, reacting to events, reading chat, telling a story. Virality depends entirely on the intensity and authenticity of their solo performance (genuine rage, uncontrollable laughter, shocked reaction).

**Group conversation (Discord, IRL, co-stream):** Multiple distinct voices interacting. Pay close attention to:
- **Roasts & banter:** Someone getting clowned on by friends — the victim's reaction matters as much as the joke. Collective laughter = strong viral signal.
- **Shared reactions:** Everyone screaming or laughing at the same event = amplified virality. A group losing their minds together is more viral than one person reacting alone.
- **Debates & arguments:** Heated disagreements, friendly or not — the tension and back-and-forth make great clips.
- **Storytelling with audience:** Someone telling a story while others react (gasps, "nooo", laughter) — the listeners' reactions validate the story's impact.
- **Awkward moments:** Uncomfortable silences, someone saying something they shouldn't have, others trying not to laugh.
- **Hype building:** Friends hyping each other up before or during a clutch play.

The NUMBER of people reacting matters: 3 people laughing uncontrollably > 1 person chuckling. A group collectively losing composure is almost always viral.

## Important context

**Off-topic conversations:** Streamers frequently talk about completely unrelated topics while playing. If the conversation has NO connection to what's happening on screen, it's likely idle chat, NOT a memorable moment. However, off-topic talk CAN be viral if it's genuinely funny, shocking, or entertaining. Mundane chatter = NOT viral regardless of volume.

**Visual-audio alignment:** If the game screen shows a menu or idle moment while people chat about unrelated topics, this is a strong signal of a LOW-value clip — UNLESS the conversation itself is the content (funny story, roast, argument).

## How to use the visual frames

Frames show the gameplay context (combat, menu, exploration, cutscene). They tell you WHERE the streamer is and WHAT they're doing. Use them to determine:
- Active combat vs menu/idle, HUD info (health, kills, damage)
- Whether the visual context matches the audio reaction
- Facecam presence and facial expressions

Do NOT over-interpret visuals or narrate frames like a slideshow. Virality comes from the AUDIO.

## Scoring guidelines

Your scoring should be driven primarily by what you HEAR in the audio (~70%), with visual context secondary (~30%).

Be very demanding. Most clips are NOT viral. Use the full scale:
- **0.8-1.0** = Exceptional moment (epic clutch, hilarious fail, intense rage, shocking reaction)
- **0.5-0.8** = Solid clip (strong reaction, entertaining gameplay, funny moment)
- **0.2-0.5** = Mediocre (mildly interesting but not worth clipping)
- **0.05-0.2** = Boring (routine gameplay, calm discussion, nothing notable)
- **< 0.05** = Skip (menu navigation, idle chat about daily life, dead air)

## Output

Return a single JSON object:
- "clip_name": SHORT clip name (2-4 words max), readable file-name style. No special punctuation, just words. Examples: "Rage Quit Epique", "Triple Kill Clutch", "Fou Rire Fail". In French.
- "category": one of "fun", "rage", "clutch", "skill", "fail", "emotional", "reaction", "storytelling", "awkward", "hype"
- "virality_score": 0 to 1 — follow the scoring guidelines above strictly.
- "summary": ONE single punch line of 10-15 words max, YouTube/TikTok clip title style. Must make people want to click. In French.
- "is_clipable": true if the clip is understandable on its own without extra context
- "key_moments": array of 3-6 key moments, each with:
  - "time": float, MUST be one of the exact frame timestamps shown on the images
  - "label": short title (5-8 words), in French{game_narrative}
  - "description": 1 sentence describing what happens visually (include HUD info if relevant)
- "narrative": fluid story of the clip (3-5 sentences), driven by what you HEAR in the audio, using visuals only for gameplay context{game_narrative}. In French.

JSON only, no markdown."""


def _encode_audio_b64(path: str) -> str | None:
    """Read an MP3 file and return its base64-encoded content."""
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")
    except OSError as e:
        logger.debug("Failed to encode audio %s: %s", path, e)
        return None


def _call_unified_llm(
    frames: list[dict],
    prompt: str,
    audio_path: str | None = None,
) -> tuple[LlmAnalysis, str]:
    """Call the LLM with audio + frames + prompt and parse the response.

    Returns (LlmAnalysis, clip_name).
    """
    # Build multimodal content: prompt text + audio + frames
    content_parts: list[dict] = [{"type": "text", "text": prompt}]

    # Audio segment (raw MP3 for Gemini native audio understanding)
    if audio_path:
        audio_b64 = _encode_audio_b64(audio_path)
        if audio_b64:
            content_parts.append({
                "type": "input_audio",
                "input_audio": {"data": audio_b64, "format": "mp3"},
            })

    for frame in frames:
        data_url = _encode_frame(frame["path"])
        if not data_url:
            continue
        content_parts.append({
            "type": "text",
            "text": f"[{frame['time']:.1f}s]",
        })
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": data_url, "detail": "low"},
        })

    client = get_openrouter_client()

    # OpenRouter models: skip response_format (unreliable on some providers)
    is_openrouter = "openrouter" in (client.base_url.host or "")

    kwargs: dict = dict(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": content_parts}],
        temperature=0.4,
        max_completion_tokens=2000,
    )
    if not is_openrouter:
        kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**kwargs)

    content = response.choices[0].message.content or ""
    finish = response.choices[0].finish_reason
    content = content.strip()
    # Strip markdown code fences if present (some models wrap JSON in ```json...```)
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    logger.debug(f"LLM raw ({finish}, {len(content)} chars): {content[:200]}")

    data = json.loads(content)
    clip_name = data.get("clip_name", "")

    # Parse key moments
    raw_moments = data.get("key_moments", [])
    frame_times = [f["time"] for f in frames]
    key_moments = []
    for m in raw_moments:
        if isinstance(m, dict) and "time" in m and "label" in m:
            t = float(m["time"])
            if frame_times:
                t = min(frame_times, key=lambda ft: abs(ft - t))
            key_moments.append(KeyMoment(
                time=t,
                label=str(m["label"]),
                description=str(m.get("description", "")),
            ))

    llm = LlmAnalysis(
        transcript="",  # filled by caller
        speech_rate=0.0,
        category=data.get("category", ""),
        virality_score=float(data.get("virality_score", 0)),
        summary=data.get("summary", ""),
        is_clipable=bool(data.get("is_clipable", True)),
        narrative=data.get("narrative", ""),
        key_moments=key_moments,
    )

    return llm, clip_name


# ─── Clip keyword detection in transcripts ────────────────────────────────────

def _has_clip_keyword(transcript: str) -> bool:
    """Check if a Whisper transcript contains a clip-related keyword."""
    if not transcript:
        return False
    text_lower = transcript.lower()
    for kw in CLIP_KEYWORDS:
        # Word boundary match to avoid false positives (e.g. "eclipse" matching "clip")
        if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
            return True
    return False


def _find_clip_keyword_timestamp(
    segments: list[tuple[float, float, str]],
    clip_start_abs: float,
) -> float | None:
    """Find the absolute VOD timestamp where a clip keyword is said.

    Searches for the LAST occurrence (streamers typically say "clip" after the
    interesting moment).

    Returns absolute timestamp in seconds, or None if not found.
    """
    best_time: float | None = None
    for seg_start, seg_end, text in segments:
        text_lower = text.lower()
        for kw in CLIP_KEYWORDS:
            if re.search(r'\b' + re.escape(kw) + r'\b', text_lower):
                midpoint = (seg_start + seg_end) / 2
                best_time = clip_start_abs + midpoint  # Keep last match
    return best_time



def _build_detected_clip(
    hp: HotPoint, clip_transcript: str, speech_rate: float,
    clip_keyword_timestamp: float | None = None,
) -> HotPoint:
    """Enrich a detected "clip" hot point with minimal metadata (no LLM call).

    If clip_keyword_timestamp is provided, override the hot point timestamp
    so clip boundaries (-2min/+5s) are relative to where "clip" was actually said.
    """
    # Override timestamp to where "clip" was actually said
    if clip_keyword_timestamp is not None:
        hp.timestamp_seconds = clip_keyword_timestamp
        h = int(clip_keyword_timestamp // 3600)
        m = int((clip_keyword_timestamp % 3600) // 60)
        s = int(clip_keyword_timestamp % 60)
        hp.timestamp_display = f"{h}:{m:02d}:{s:02d}"

    summary = clip_transcript[:200] if clip_transcript else ""

    hp.clip_source = "detected"
    hp.llm = LlmAnalysis(
        category="clip_moment",
        summary=summary,
        transcript=clip_transcript,
        speech_rate=round(speech_rate, 2),
    )
    hp.clip_name = f"[CLIP] {hp.timestamp_display}"
    hp.final_score = None  # No LLM scoring — detected by keyword
    return hp


# ─── VOD context gathering + heat map ────────────────────────────────────────


def _build_context_prompt(
    transcripts: dict[int, tuple[str, float, float, list, list[dict]]],
    hot_points: list[HotPoint],
    vod_meta: dict,
) -> str:
    """Build the prompt for VOD context gathering + segment content scoring."""
    vod_title = vod_meta.get("title", "")
    vod_game = vod_meta.get("game", "")
    streamer = vod_meta.get("streamer", "")
    stream_date = vod_meta.get("stream_date", "")
    duration = vod_meta.get("duration", 0)

    duration_h = int(duration // 3600)
    duration_m = int((duration % 3600) // 60)

    # Build chronological transcript list
    segments_text = []
    sorted_indices = sorted(transcripts.keys(), key=lambda i: hot_points[i].timestamp_seconds)
    for idx in sorted_indices:
        hp = hot_points[idx]
        transcript, speech_rate, _, _, _ = transcripts[idx]
        if not transcript.strip():
            segments_text.append(
                f"[Segment {idx} @ {hp.timestamp_display}] (silence / no speech)"
            )
        else:
            segments_text.append(
                f"[Segment {idx} @ {hp.timestamp_display}] {transcript.strip()}"
            )

    all_segments = "\n\n".join(segments_text)

    return f"""You are analyzing a full Twitch VOD to understand its narrative arc and identify the most interesting moments.

**Stream:** {vod_title}
**Streamer:** {streamer}
**Game:** {vod_game}
**Date:** {stream_date}
**Duration:** {duration_h}h{duration_m:02d}

Below are {len(transcripts)} audio transcriptions from highlighted moments throughout the stream, in chronological order. Each segment is ~30-60 seconds of audio transcribed by Whisper (may contain errors, especially on proper nouns and gaming jargon).

{all_segments}

## Your task

Analyze ALL segments to produce:

### 1. VOD Context
Build a comprehensive understanding of this stream:
- **summary**: 2-4 sentences describing what this stream is about, what happens, the overall vibe
- **phases**: divide the stream into distinct phases/chapters (game changes, mood shifts, major events). Each phase has start/end timestamps and a description.
- **protagonists**: identify recurring people (the streamer, duo partners, Discord friends, opponents). For each, give their name (as heard in audio) and their role.
- **recurring_themes**: running jokes, repeated references, ongoing situations
- **language**: primary language of the stream (fr, en, es, etc.)
- **mood_arc**: one-line description of the emotional journey (e.g. "Chill → Hype → Tilt → Rage → Reset")

### 2. Content Scoring
For EACH segment, rate how interesting/viral the CONTENT sounds based purely on the transcript:
- 0.0-0.2: Boring (routine commentary, idle chat, nothing notable)
- 0.2-0.4: Mildly interesting (some activity but not remarkable)
- 0.4-0.6: Interesting (clear reaction, funny moment, notable event)
- 0.6-0.8: Very interesting (strong reaction, hilarious moment, clutch play narration)
- 0.8-1.0: Exceptional (explosive reaction, legendary moment, uncontrollable laughter/rage)

Consider: emotional intensity in the words, humor, storytelling, group dynamics, references to gameplay events, build-up and payoff. Silence segments = 0.0.

Segments that reference earlier events in the stream (callbacks) or are part of an escalating arc (progressive tilt, running joke payoff) should get a BONUS because they have narrative momentum.

## Output format

Return a single JSON object:
```json
{{
  "vod_context": {{
    "summary": "...",
    "phases": [{{"start": "H:MM:SS", "end": "H:MM:SS", "description": "..."}}],
    "protagonists": [{{"name": "...", "role": "..."}}],
    "recurring_themes": ["..."],
    "language": "fr",
    "mood_arc": "..."
  }},
  "segment_scores": [
    {{"index": 0, "content_score": 0.3}},
    {{"index": 1, "content_score": 0.1}},
    ...
  ]
}}
```

IMPORTANT: segment_scores MUST contain an entry for EVERY segment index listed above. JSON only, no markdown."""


def gather_vod_context(
    job_id: str,
    transcripts: dict[int, tuple[str, float, float, list, list[dict]]],
    hot_points: list[HotPoint],
    vod_meta: dict,
) -> tuple[VodContext, dict[int, float]]:
    """Call LLM to gather VOD-wide context and per-segment content scores.

    Returns (vod_context, content_scores) where content_scores maps
    candidate index to a 0-1 content interest score.
    """
    t0 = _time.time()
    prompt = _build_context_prompt(transcripts, hot_points, vod_meta)

    client = get_openrouter_client()
    is_openrouter = "openrouter" in (client.base_url.host or "")

    kwargs: dict = dict(
        model=LLM_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_completion_tokens=4000,
    )
    if not is_openrouter:
        kwargs["response_format"] = {"type": "json_object"}

    response = client.chat.completions.create(**kwargs)

    content = response.choices[0].message.content or ""
    content = content.strip()
    if content.startswith("```"):
        content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    data = json.loads(content)

    # Parse VOD context
    raw_ctx = data.get("vod_context", {})
    vod_context = VodContext(
        summary=raw_ctx.get("summary", ""),
        phases=[
            {"start": p.get("start", ""), "end": p.get("end", ""), "description": p.get("description", "")}
            for p in raw_ctx.get("phases", [])
        ],
        protagonists=[
            {"name": p.get("name", ""), "role": p.get("role", "")}
            for p in raw_ctx.get("protagonists", [])
        ],
        recurring_themes=raw_ctx.get("recurring_themes", []),
        language=raw_ctx.get("language", ""),
        mood_arc=raw_ctx.get("mood_arc", ""),
    )

    # Parse content scores
    content_scores: dict[int, float] = {}
    for entry in data.get("segment_scores", []):
        idx = int(entry.get("index", -1))
        score = float(entry.get("content_score", 0.0))
        content_scores[idx] = max(0.0, min(1.0, score))

    elapsed = _time.time() - t0
    logger.info(
        f"[{job_id[:8]}] VOD context gathered in {elapsed:.1f}s: "
        f"{len(vod_context.phases)} phases, {len(vod_context.protagonists)} protagonists, "
        f"{len(content_scores)} segment scores"
    )

    return vod_context, content_scores


# ─── Pre-clipping candidate analysis ─────────────────────────────────────────

def analyze_candidates(
    job_id: str,
    hot_points: list[HotPoint],
    audio_path: str,
    vod_url: str,
    vod_duration: float,
    vod_meta: dict,
    chat_messages: list[dict] | None = None,
    keep_n: int = KEEP_TOP_N,
) -> tuple[list[HotPoint], list[HotPoint], dict[int, list[dict]], VodContext | None]:
    """Analyze all candidates with Whisper, gather VOD context, then LLM-rank.

    Returns (normal_hot_points, detected_hot_points, candidate_words, vod_context):
    - normal: top keep_n after full LLM analysis
    - detected: candidates where Whisper found "clip" keyword (clip_source="detected")
    - candidate_words: {candidate_idx -> word-level timestamps} for subtitle generation
    - vod_context: VOD-wide narrative context (or None if gathering failed)
    """
    total = len(hot_points)
    logger.info(f"═══ Analyzing {total} candidates (keeping top {keep_n}) ═══")
    pipeline_t0 = _time.time()

    # Triage audio directory — shared with _transcribe_candidates for MP3 segments
    triage_dir = os.path.join("triage_audio", job_id)

    # ── Step 1: Get direct VOD URL for frame extraction ──
    logger.info(f"[1/7] Getting direct VOD URL...")
    update_job(job_id, progress=f"Récupération URL vidéo...")
    direct_url = get_vod_direct_url(vod_url)

    # ── Step 2: Whisper transcription for ALL candidates (parallel) ──
    logger.info(f"[2/7] Transcribing {total} candidates...")
    update_job(job_id, progress=f"Transcription de {total} segments audio...")
    candidates = [(i, hp) for i, hp in enumerate(hot_points)]
    transcripts = _transcribe_candidates(audio_path, candidates, vod_duration, job_id)

    # ── Step 3: Detect "clip" keyword in transcripts ──
    logger.info(f"[3/7] Scanning transcripts for 'clip' keywords...")
    detected_indices: list[int] = []
    normal_indices: list[int] = []

    for idx, hp in candidates:
        transcript, speech_rate, clip_start_abs, segments, _words = transcripts.get(
            idx, ("", 0.0, 0.0, [], [])
        )
        if _has_clip_keyword(transcript):
            detected_indices.append(idx)
            clip_ts = _find_clip_keyword_timestamp(segments, clip_start_abs)
            hot_points[idx] = _build_detected_clip(hp, transcript, speech_rate, clip_keyword_timestamp=clip_ts)
            logger.info(f"  CLIP DETECTED at {hot_points[idx].timestamp_display}: \"{transcript[:80]}\"")
        else:
            normal_indices.append(idx)

    detected_hps = [hot_points[i] for i in detected_indices]
    logger.info(
        f"Keyword scan: {len(detected_hps)} clip(s) detected, "
        f"{len(normal_indices)} normal candidates"
    )

    # ── Step 3b: VOD context gathering + content scoring ──
    vod_context: VodContext | None = None
    content_scores: dict[int, float] = {}
    normal_transcripts = {i: transcripts[i] for i in normal_indices if i in transcripts}
    if normal_transcripts:
        logger.info(f"[3b/7] Gathering VOD context from {len(normal_transcripts)} transcripts...")
        update_job(job_id, progress=f"Analyse du contexte de la VOD ({len(normal_transcripts)} segments)...")
        try:
            vod_context, content_scores = gather_vod_context(
                job_id, normal_transcripts, hot_points, vod_meta,
            )
            # Save vod_context to DB immediately
            update_job(job_id, vod_context=vod_context)
        except Exception as e:
            logger.error(f"[{job_id[:8]}] VOD context gathering failed: {e}")

    # ── Step 3c: Blended re-ranking (heuristic + content score) → top KEEP_NORMAL_FOR_LLM ──
    CONTENT_WEIGHT = 0.5
    HEURISTIC_FILTER_WEIGHT = 0.5

    def _blended_pre_score(idx: int) -> float:
        heuristic = hot_points[idx].score
        content = content_scores.get(idx, 0.0)
        blended = HEURISTIC_FILTER_WEIGHT * heuristic + CONTENT_WEIGHT * content
        # Bonus: rescue content gems (high content, low heuristic)
        if content > 0.8 and heuristic < 0.3:
            blended += 0.15
        # Malus: demote false positives (high heuristic, very low content)
        elif content < 0.1 and heuristic > 0.5:
            blended -= 0.1
        return blended

    normal_candidates_sorted = sorted(normal_indices, key=_blended_pre_score, reverse=True)
    normal_for_llm = normal_candidates_sorted[:KEEP_NORMAL_FOR_LLM]
    dropped_early = normal_candidates_sorted[KEEP_NORMAL_FOR_LLM:]

    if dropped_early:
        logger.info(f"Dropping {len(dropped_early)} lowest-scoring normal candidates before LLM")

    # Log the blended re-ranking for debugging
    if content_scores:
        rescued = sum(
            1 for i in normal_for_llm
            if hot_points[i].score < 0.3 and content_scores.get(i, 0) > 0.6
        )
        demoted = sum(
            1 for i in dropped_early
            if hot_points[i].score > 0.5 and content_scores.get(i, 0) < 0.1
        )
        if rescued or demoted:
            logger.info(
                f"[{job_id[:8]}] Blended re-ranking: {rescued} content gems rescued, "
                f"{demoted} false positives demoted"
            )

    llm_total = len(normal_for_llm)

    # ── Step 4: Extract frames + diarize in parallel ──
    # Frames use network I/O, diarization uses local GPU — truly parallel.
    logger.info(f"[4/7] Extracting frames + diarizing {llm_total} candidates...")
    update_job(job_id, progress=f"Extraction frames + diarization ({llm_total} candidats)...")

    step4_t0 = _time.time()
    all_frames: dict[int, list[dict]] = {}
    speaker_transcripts: dict[int, str] = {}
    speaker_labeled_words: dict[int, list[dict]] = {}

    def _extract_frames_one(idx: int, hp: HotPoint) -> tuple[int, list[dict]]:
        if hp.clip_start is not None and hp.clip_end is not None:
            start, end = hp.clip_start, hp.clip_end
        else:
            start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
            end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)
        frames = extract_frames_from_url(
            direct_url, job_id, idx, [start, end], NUM_FRAMES,
        )
        return idx, frames

    def _run_frames():
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {
                executor.submit(_extract_frames_one, idx, hot_points[idx]): idx
                for idx in normal_for_llm
            }
            done = 0
            for future in as_completed(futures):
                done += 1
                try:
                    idx, frames = future.result()
                    all_frames[idx] = frames
                except Exception as e:
                    idx = futures[future]
                    logger.error(f"Frame extraction failed for candidate {idx}: {e}")
                    all_frames[idx] = []

    def _run_diarization():
        from app.services.speaker_diarizer import extract_voiceprint, diarize_candidates
        import numpy as np

        # Extract streamer voiceprint from VOD start (one-time)
        voiceprint = extract_voiceprint(audio_path)
        streamer_name = vod_meta.get("streamer", "Streamer")

        # Persist voiceprint for lazy re-transcription in transcribe_clip.py
        if voiceprint is not None:
            vp_dir = os.path.join(CLIPS_DIR, job_id)
            os.makedirs(vp_dir, exist_ok=True)
            np.save(os.path.join(vp_dir, "_voiceprint.npy"), voiceprint)

        # Collect Whisper words for the top 50 candidates
        whisper_words_for_diarize: dict[int, list[dict]] = {}
        for idx in normal_for_llm:
            _, _, _, _, words = transcripts.get(idx, ("", 0.0, 0.0, [], []))
            if words:
                whisper_words_for_diarize[idx] = words

        # Diarize all candidates
        llm_candidates = [(idx, hot_points[idx]) for idx in normal_for_llm]
        nonlocal speaker_transcripts, speaker_labeled_words
        speaker_transcripts, speaker_labeled_words = diarize_candidates(
            wav_path=audio_path,
            candidates=llm_candidates,
            voiceprint=voiceprint,
            streamer_name=streamer_name,
            vod_duration=vod_duration,
            job_id=job_id,
            whisper_words=whisper_words_for_diarize,
        )

    # Run both in parallel using threads
    with ThreadPoolExecutor(max_workers=2) as pool:
        frame_future = pool.submit(_run_frames)
        diarize_future = pool.submit(_run_diarization)

        # Wait for both, log progress
        frame_future.result()
        total_frames = sum(len(f) for f in all_frames.values())

        diarize_future.result()
        diarized_count = sum(1 for t in speaker_transcripts.values() if "\n" in t)

    step4_elapsed = _time.time() - step4_t0
    logger.info(
        f"Step 4 complete in {step4_elapsed:.1f}s: {total_frames} frames, "
        f"{diarized_count}/{llm_total} multi-speaker transcripts"
    )

    # ── Step 5: Unified LLM analysis for normal candidates (parallel) ──
    logger.info(f"[5/7] Running unified LLM analysis on {llm_total} candidates...")
    update_job(job_id, progress=f"Analyse IA de {llm_total} candidats...")

    llm_t0 = _time.time()
    candidate_words: dict[int, list[dict]] = {}  # idx -> word-level timestamps for subtitles

    def _analyze_one(idx: int, hp: HotPoint) -> None:
        t0 = _time.time()
        transcript, speech_rate, _, _, whisper_words = transcripts.get(idx, ("", 0.0, 0.0, [], []))
        frames = all_frames.get(idx, [])

        # Use speaker-labeled transcript if available, fall back to plain
        speaker_transcript = speaker_transcripts.get(idx, "")
        if speaker_transcript:
            display_transcript = speaker_transcript
        else:
            display_transcript = transcript

        # Audio segment path (kept from Whisper step)
        audio_path = os.path.join(triage_dir, f"seg_{idx:03d}.mp3")
        if not os.path.isfile(audio_path):
            audio_path = None

        # Chat context — use pre-computed clip bounds
        chat_context = ""
        if chat_messages:
            if hp.clip_start is not None and hp.clip_end is not None:
                clip_start, clip_end = hp.clip_start, hp.clip_end
            else:
                clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
                clip_end = hp.timestamp_seconds + CLIP_HALF_DURATION
            chat_context = _extract_chat_for_clip(chat_messages, clip_start, clip_end)

        prompt = _build_unified_prompt(
            transcript=display_transcript,
            speech_rate=speech_rate,
            score=hp.score,
            timestamp_display=hp.timestamp_display,
            vod_meta=vod_meta,
            chat_context=chat_context,
            chat_mood=hp.chat_mood,
            signals=hp.signals,
            vod_context=vod_context,
        )

        try:
            llm, clip_name = _call_unified_llm(frames, prompt, audio_path)
            llm.transcript = transcript
            llm.speech_rate = round(speech_rate, 2)

            # Use speaker-labeled words if available, fall back to plain Whisper
            if idx in speaker_labeled_words:
                candidate_words[idx] = speaker_labeled_words[idx]
            elif whisper_words:
                candidate_words[idx] = whisper_words

            hp.llm = llm
            if clip_name:
                hp.clip_name = clip_name
            hp.final_score = round(
                HEURISTIC_WEIGHT * hp.score + LLM_WEIGHT * llm.virality_score, 3
            )

            elapsed = _time.time() - t0
            logger.info(
                f"  Candidate {idx} ({hp.timestamp_display}): "
                f"{llm.category} | viral={llm.virality_score:.0%} | "
                f"final={hp.final_score:.0%} | {len(frames)} frames | "
                f"audio={'yes' if audio_path else 'no'} | "
                f"{elapsed:.1f}s"
            )

        except Exception as e:
            logger.error(f"LLM analysis failed for candidate {idx} ({hp.timestamp_display}): {e}")
            hp.llm = LlmAnalysis(transcript=transcript, speech_rate=round(speech_rate, 2))
            hp.final_score = round(HEURISTIC_WEIGHT * hp.score, 3)

    with ThreadPoolExecutor(max_workers=MAX_LLM_WORKERS) as executor:
        futures = {
            executor.submit(_analyze_one, idx, hot_points[idx]): idx
            for idx in normal_for_llm
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            idx = futures[future]
            try:
                future.result()
            except Exception as e:
                logger.error(f"Unexpected error for candidate {idx}: {e}")

            if done % 5 == 0 or done == llm_total:
                update_job(
                    job_id,
                    progress=f"Analyse IA : {done} sur {llm_total} candidats...",
                )

    llm_elapsed = _time.time() - llm_t0
    logger.info(f"LLM analysis complete: {llm_total} candidates in {llm_elapsed:.1f}s")

    # ── Re-rank normal candidates and keep top N ──
    normal_hps = [hot_points[i] for i in normal_for_llm]
    normal_hps.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )

    kept = normal_hps[:keep_n]
    dropped = normal_hps[keep_n:]

    # Remap candidate_words from original indices to kept-list indices
    # so _save_words_for_clips matches words to the correct clip.
    hp_to_words: dict[int, list[dict]] = {}
    for orig_idx in normal_for_llm:
        if orig_idx in candidate_words:
            hp_to_words[id(hot_points[orig_idx])] = candidate_words[orig_idx]

    kept_words: dict[int, list[dict]] = {}
    for new_idx, hp in enumerate(kept):
        words = hp_to_words.get(id(hp))
        if words:
            kept_words[new_idx] = words

    logger.info(f"═══ Re-ranking results ═══")
    for i, hp in enumerate(kept):
        cat = hp.llm.category if hp.llm else "?"
        viral = hp.llm.virality_score if hp.llm else 0
        final = hp.final_score if hp.final_score is not None else 0
        logger.info(
            f"  KEEP #{i+1}: {hp.timestamp_display} | "
            f"heuristic={hp.score:.0%} viral={viral:.0%} "
            f"final={final:.0%} | {cat} | {hp.clip_name}"
        )
    for hp in dropped:
        viral = hp.llm.virality_score if hp.llm else 0
        final = hp.final_score if hp.final_score is not None else 0
        logger.info(
            f"  DROP: {hp.timestamp_display} | "
            f"heuristic={hp.score:.0%} viral={viral:.0%} "
            f"final={final:.0%}"
        )
    if detected_hps:
        logger.info(f"═══ Detected clips ═══")
        for hp in detected_hps:
            logger.info(f"  🎬 {hp.timestamp_display} | \"{hp.llm.summary[:60]}...\"")

    # Cleanup triage audio directory (kept for LLM audio analysis)
    if os.path.exists(triage_dir):
        shutil.rmtree(triage_dir, ignore_errors=True)

    pipeline_elapsed = _time.time() - pipeline_t0
    logger.info(
        f"═══ Analysis complete: {len(kept)} normal + {len(detected_hps)} detected "
        f"in {pipeline_elapsed:.1f}s ═══"
    )

    save_hot_points(job_id, kept)
    return kept, detected_hps, kept_words, vod_context


# ─── Post-clipping single clip analysis (for resume/retry) ───────────────────

def analyze_single_clip(
    job_id: str,
    clip_index: int,
    hp: HotPoint,
    vod_meta: dict,
    chat_messages: list[dict] | None = None,
) -> None:
    """Full analysis pipeline for a single local clip: Whisper + frames + unified LLM.

    Used when resuming from CLIPPING or LLM_ANALYSIS checkpoint.
    """
    from app.services.db import (
        publish_clip_ready,
        rename_clip_files,
        slugify_clip_name,
        update_hot_point_clip,
    )

    clip_path = os.path.join(CLIPS_DIR, job_id, hp.clip_filename)

    # Step 1: Whisper transcription
    logger.info(f"  [1/3] Whisper transcription...")
    audio_path = clip_path.replace(".mp4", "_audio.mp3")
    if _extract_audio_from_clip(clip_path, audio_path):
        transcript, speech_rate, _ = _transcribe_audio(audio_path)
    else:
        transcript, speech_rate = "", 0.0
        audio_path = None

    # Step 2: Extract frames from local clip
    logger.info(f"  [2/3] Frame extraction...")
    frames = extract_frames(clip_path, job_id, clip_index)

    # Chat context
    chat_context = ""
    if chat_messages:
        clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
        clip_end = hp.timestamp_seconds + CLIP_HALF_DURATION
        chat_context = _extract_chat_for_clip(chat_messages, clip_start, clip_end)
        if chat_context:
            logger.info(f"  Chat context: {chat_context.count(chr(10)) + 1} messages")

    # Step 3: Unified LLM analysis
    logger.info(f"  [3/3] Unified LLM analysis ({len(frames)} frames, audio={'yes' if audio_path else 'no'})...")

    prompt = _build_unified_prompt(
        transcript=transcript,
        speech_rate=speech_rate,
        score=hp.score,
        timestamp_display=hp.timestamp_display,
        vod_meta=vod_meta,
        chat_context=chat_context,
        chat_mood=hp.chat_mood,
        signals=hp.signals,
    )

    try:
        llm, clip_name = _call_unified_llm(frames, prompt, audio_path)
        llm.transcript = transcript
        llm.speech_rate = round(speech_rate, 2)
    except Exception as e:
        logger.error(f"Unified analysis failed: {e}")
        llm = LlmAnalysis(transcript=transcript, speech_rate=round(speech_rate, 2))
        clip_name = ""
    finally:
        if audio_path and os.path.isfile(audio_path):
            os.remove(audio_path)

    hp.llm = llm
    if clip_name:
        hp.clip_name = clip_name
    hp.final_score = round(
        HEURISTIC_WEIGHT * hp.score + LLM_WEIGHT * llm.virality_score, 3
    )

    # Rename clip file
    if clip_name and hp.clip_filename:
        new_filename = slugify_clip_name(clip_name)
        old_filename = hp.clip_filename
        try:
            from app.services.s3_storage import rename_object
            rename_object(f"clips/{job_id}/{old_filename}", f"clips/{job_id}/{new_filename}")
            rename_clip_files(job_id, old_filename, new_filename)
            update_hot_point_clip(job_id, clip_index, new_filename)
            hp.clip_filename = new_filename
            logger.info(f"  Renamed {old_filename} → {new_filename}")
        except Exception as e:
            logger.warning(f"  Clip rename failed ({old_filename} → {new_filename}): {e}")

    logger.info(
        f"  → {llm.category} | viral={llm.virality_score:.0%} | "
        f"final={hp.final_score:.0%} | {len(llm.key_moments)} moments"
    )

    publish_clip_ready(job_id, clip_index, hp)


def analyze_hot_points(
    job_id: str,
    hot_points: list[HotPoint],
    vod_meta: dict,
    max_analyze: int = 25,
    chat_messages: list[dict] | None = None,
) -> None:
    """Run full analysis on already-clipped hot points (resume path)."""
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
    logger.info(f"Analyzing {total} clipped files with {MAX_LLM_WORKERS} parallel workers")

    def _analyze_one(item: tuple[int, HotPoint]) -> None:
        idx, hp = item
        analyze_single_clip(
            job_id, idx + 1, hp, vod_meta,
            chat_messages=chat_messages,
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
                update_job(job_id, progress=f"Analyse IA : {done} sur {total} clips ({hp.timestamp_display})")
            except Exception as e:
                logger.error(f"Analysis failed for clip at {hp.timestamp_display}: {e}")

    hot_points.sort(
        key=lambda hp: hp.final_score if hp.final_score is not None else -1,
        reverse=True,
    )

    save_hot_points(job_id, hot_points)
    logger.info(f"Analysis complete: {total} clips analyzed, re-ranked")
