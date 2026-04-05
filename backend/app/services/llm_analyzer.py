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
import subprocess
import time as _time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint, KeyMoment, LlmAnalysis
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


def _transcribe_audio(audio_path: str) -> tuple[str, float, list[tuple[float, float, str]]]:
    """Transcribe an audio file using Whisper API via Groq.

    Returns (transcript_text, speech_rate, segments) where segments is
    a list of (start_seconds, end_seconds, text) tuples from Whisper.
    """
    client = get_groq_client()
    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=f,
                response_format="verbose_json",
            )

        text = result.text or ""
        word_count = len(text.split())

        segments: list[tuple[float, float, str]] = []
        duration = 0.0
        if hasattr(result, "segments") and result.segments:
            duration = max(s.end for s in result.segments)
            segments = [(s.start, s.end, s.text) for s in result.segments]

        speech_rate = word_count / duration if duration > 0 else 0.0
        return text, speech_rate, segments

    except Exception as e:
        logger.error(f"Whisper transcription failed: {e}")
        return "", 0.0, []


def _transcribe_candidates(
    wav_path: str,
    candidates: list[tuple[int, HotPoint]],
    vod_duration: float,
    job_id: str,
) -> dict[int, tuple[str, float, float, list[tuple[float, float, str]]]]:
    """Transcribe audio segments for all candidates in parallel.

    Extracts clip audio from the full WAV and transcribes via Whisper.

    Returns dict: candidate_index -> (transcript_text, speech_rate,
                                       clip_start_abs, raw_segments).
    clip_start_abs is the absolute VOD timestamp where the clip begins.
    raw_segments are Whisper (start, end, text) tuples relative to clip_start_abs.
    """
    import shutil

    triage_dir = os.path.join("triage_audio", job_id)
    os.makedirs(triage_dir, exist_ok=True)

    total = len(candidates)
    logger.info(f"Transcribing {total} candidates with {MAX_WHISPER_WORKERS} workers...")
    t0 = _time.time()

    transcripts: dict[int, tuple[str, float, float, list[tuple[float, float, str]]]] = {}

    def _do_one(idx: int, hp: HotPoint) -> tuple[int, str, float, float, list]:
        clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
        clip_end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)

        seg_path = os.path.join(triage_dir, f"seg_{idx:03d}.mp3")

        if _extract_audio_from_wav(wav_path, clip_start, clip_end, seg_path):
            text, speech_rate, segments = _transcribe_audio(seg_path)
            if os.path.isfile(seg_path):
                os.remove(seg_path)
            return idx, text, speech_rate, clip_start, segments
        return idx, "", 0.0, 0.0, []

    with ThreadPoolExecutor(max_workers=MAX_WHISPER_WORKERS) as executor:
        futures = {
            executor.submit(_do_one, idx, hp): idx
            for idx, hp in candidates
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                idx, text, speech_rate, clip_start, segments = future.result()
                transcripts[idx] = (text, speech_rate, clip_start, segments)
                if done % 10 == 0 or done == total:
                    logger.info(f"Whisper progress: {done}/{total}")
                    update_job(job_id, progress=f"Transcription : {done} sur {total} segments...")
            except Exception as e:
                idx = futures[future]
                logger.error(f"Whisper failed for candidate {idx}: {e}")
                transcripts[idx] = ("", 0.0, 0.0, [])

    elapsed = _time.time() - t0
    non_empty = sum(1 for t in transcripts.values() if t[0])
    logger.info(f"Transcription complete: {non_empty}/{total} with speech in {elapsed:.1f}s")

    # Cleanup temp dir
    if os.path.exists(triage_dir):
        shutil.rmtree(triage_dir, ignore_errors=True)

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

    return f"""You are an expert at identifying viral Twitch/YouTube clip moments. Your job is to evaluate whether this clip would make a compelling standalone short video.

{identity_card}
**Timestamp:** {timestamp_display}
**Heuristic score:** {score:.0%}{signals_text}
**Speech rate:** {speech_rate:.1f} words/s

**Transcript:**
{transcript if transcript else "(silence / no speech)"}
{chat_section}

## Important context

**Multiple speakers:** The transcript is generated by Whisper and does NOT distinguish between speakers. On Twitch streams, multiple people are often talking simultaneously — the streamer plus friends on Discord, IRL guests, etc. You cannot assume everything said is from the streamer. Look for conversational patterns (questions/answers, topic switches) that indicate multiple speakers.

**Off-topic conversations:** Streamers frequently talk about completely unrelated topics while playing — daily life logistics, planning, personal stories, messages to friends. If the transcript content has NO connection to what's happening on screen, it's likely idle conversation, NOT a memorable gaming moment. However, off-topic talk CAN be viral if it's genuinely funny, shocking, or entertaining (jokes, roasts, embarrassing stories, heated arguments). Mundane chatter about errands, printing, scheduling = NOT viral regardless of audio volume.

**Visual-audio alignment:** If the game screen shows a menu, inventory, or idle moment while people are chatting about unrelated topics, this is a strong signal of a LOW-value clip. High-value clips usually show a clear connection between what happens on screen and the emotional reaction.

## How to use the visual frames

The frames are provided for CONTEXT only — they help you understand the gameplay situation (combat, menu, exploration, cutscene, etc.). Do NOT over-interpret specific visual details or base your scoring primarily on what you see. The frames tell you WHERE the streamer is and WHAT they're doing in the game, but virality comes from the AUDIO: the transcript, the vocal reactions, the emotional intensity.

Use frames to determine:
- Is the streamer in active combat, in a menu, exploring, in a cutscene?
- Is there a HUD showing low health, kill feeds, damage numbers, defeat/victory screens?
- Does the visual context match what the streamer is reacting to in the transcript?
- Is there a streamer facecam visible showing facial expressions?

Do NOT:
- Describe frame-by-frame visual details in the narrative as if narrating a slideshow
- Score based on how "exciting" the game visuals look — a mundane-looking screen with an insane vocal reaction is MORE viral than epic visuals with calm commentary
- Assume what's happening based on a single frozen frame — the transcript is the ground truth

## Scoring guidelines

Your scoring should be driven primarily by the TRANSCRIPT and AUDIO SIGNALS (~70%), with visual context as a secondary factor (~30%). A crazy vocal reaction with a boring-looking screen is still viral. An epic-looking screen with calm commentary is usually not.

Be very demanding. Most clips are NOT viral. Use the full scale:
- **0.8-1.0** = Exceptional moment (epic clutch, hilarious fail, intense rage, shocking reaction)
- **0.5-0.8** = Solid clip (strong reaction, entertaining gameplay, funny moment)
- **0.2-0.5** = Mediocre (mildly interesting but not worth clipping)
- **0.05-0.2** = Boring (routine gameplay, calm discussion, nothing notable)
- **< 0.05** = Skip (menu navigation, idle chat about daily life, dead air)

The vocal excitement signal is the strongest indicator: if the audio analysis detected laughter, screaming, or shouting, this is a very strong positive signal. If it detected only calm speech with no excitement, be skeptical about virality even if volume is high.

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
- "narrative": fluid story of the clip (3-5 sentences), driven by what is SAID and HEARD (transcript + reactions), using visuals only for gameplay context{game_narrative}. In French.

JSON only, no markdown."""


def _call_unified_llm(
    frames: list[dict],
    prompt: str,
) -> tuple[LlmAnalysis, str]:
    """Call the LLM with frames + prompt and parse the response.

    Returns (LlmAnalysis, clip_name).
    """
    # Build multimodal content: prompt text + frames
    content_parts: list[dict] = [{"type": "text", "text": prompt}]

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
) -> tuple[list[HotPoint], list[HotPoint]]:
    """Analyze all candidates with Whisper, detect "clip" keywords, then LLM-rank the rest.

    Returns (normal_hot_points, detected_hot_points):
    - normal: top keep_n after full LLM analysis
    - detected: candidates where Whisper found "clip" keyword (clip_source="detected")
    """
    total = len(hot_points)
    logger.info(f"═══ Analyzing {total} candidates (keeping top {keep_n}) ═══")
    pipeline_t0 = _time.time()

    # ── Step 1: Get direct VOD URL for frame extraction ──
    logger.info(f"[1/5] Getting direct VOD URL...")
    update_job(job_id, progress=f"Récupération URL vidéo...")
    direct_url = get_vod_direct_url(vod_url)

    # ── Step 2: Whisper transcription for ALL candidates (parallel) ──
    logger.info(f"[2/5] Transcribing {total} candidates...")
    update_job(job_id, progress=f"Transcription de {total} segments audio...")
    candidates = [(i, hp) for i, hp in enumerate(hot_points)]
    transcripts = _transcribe_candidates(audio_path, candidates, vod_duration, job_id)

    # ── Step 3: Detect "clip" keyword in transcripts ──
    logger.info(f"[3/5] Scanning transcripts for 'clip' keywords...")
    detected_indices: list[int] = []
    normal_indices: list[int] = []

    for idx, hp in candidates:
        transcript, speech_rate, clip_start_abs, segments = transcripts.get(
            idx, ("", 0.0, 0.0, [])
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

    # ── Step 3b: Keep only top KEEP_NORMAL_FOR_LLM normal candidates by heuristic score ──
    normal_candidates_sorted = sorted(normal_indices, key=lambda i: hot_points[i].score, reverse=True)
    normal_for_llm = normal_candidates_sorted[:KEEP_NORMAL_FOR_LLM]
    dropped_early = normal_candidates_sorted[KEEP_NORMAL_FOR_LLM:]

    if dropped_early:
        logger.info(f"Dropping {len(dropped_early)} lowest-scoring normal candidates before LLM")

    llm_total = len(normal_for_llm)

    # ── Step 4: Extract frames from VOD URL for normal candidates (parallel) ──
    logger.info(f"[4/5] Extracting {NUM_FRAMES} frames for {llm_total} candidates from VOD...")
    update_job(job_id, progress=f"Extraction de {llm_total * NUM_FRAMES} frames depuis la VOD...")

    frames_t0 = _time.time()
    all_frames: dict[int, list[dict]] = {}

    def _extract_frames_one(idx: int, hp: HotPoint) -> tuple[int, list[dict]]:
        start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
        end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)
        frames = extract_frames_from_url(
            direct_url, job_id, idx, [start, end], NUM_FRAMES,
        )
        return idx, frames

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

            if done % 10 == 0 or done == llm_total:
                update_job(job_id, progress=f"Extraction frames : {done} sur {llm_total}...")

    frames_elapsed = _time.time() - frames_t0
    total_frames = sum(len(f) for f in all_frames.values())
    logger.info(f"Frame extraction complete: {total_frames} frames in {frames_elapsed:.1f}s")

    # ── Step 5: Unified LLM analysis for normal candidates (parallel) ──
    logger.info(f"[5/5] Running unified LLM analysis on {llm_total} candidates...")
    update_job(job_id, progress=f"Analyse IA de {llm_total} candidats...")

    llm_t0 = _time.time()

    def _analyze_one(idx: int, hp: HotPoint) -> None:
        t0 = _time.time()
        transcript, speech_rate, _, _ = transcripts.get(idx, ("", 0.0, 0.0, []))
        frames = all_frames.get(idx, [])

        # Chat context
        chat_context = ""
        if chat_messages:
            clip_start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
            clip_end = hp.timestamp_seconds + CLIP_HALF_DURATION
            chat_context = _extract_chat_for_clip(chat_messages, clip_start, clip_end)

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
            llm, clip_name = _call_unified_llm(frames, prompt)
            llm.transcript = transcript
            llm.speech_rate = round(speech_rate, 2)

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
                f"{elapsed:.1f}s"
            )

        except Exception as e:
            logger.error(f"LLM analysis failed for candidate {idx} ({hp.timestamp_display}): {e}")
            hp.llm = LlmAnalysis(transcript=clip_transcript, speech_rate=round(speech_rate, 2))
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

    logger.info(f"═══ Re-ranking results ═══")
    for i, hp in enumerate(kept):
        cat = hp.llm.category if hp.llm else "?"
        viral = hp.llm.virality_score if hp.llm else 0
        logger.info(
            f"  KEEP #{i+1}: {hp.timestamp_display} | "
            f"heuristic={hp.score:.0%} viral={viral:.0%} "
            f"final={hp.final_score:.0%} | {cat} | {hp.clip_name}"
        )
    for hp in dropped:
        viral = hp.llm.virality_score if hp.llm else 0
        logger.info(
            f"  DROP: {hp.timestamp_display} | "
            f"heuristic={hp.score:.0%} viral={viral:.0%} "
            f"final={hp.final_score:.0%}"
        )
    if detected_hps:
        logger.info(f"═══ Detected clips ═══")
        for hp in detected_hps:
            logger.info(f"  🎬 {hp.timestamp_display} | \"{hp.llm.summary[:60]}...\"")

    pipeline_elapsed = _time.time() - pipeline_t0
    logger.info(
        f"═══ Analysis complete: {len(kept)} normal + {len(detected_hps)} detected "
        f"in {pipeline_elapsed:.1f}s ═══"
    )

    save_hot_points(job_id, kept)
    return kept, detected_hps


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
        if os.path.isfile(audio_path):
            os.remove(audio_path)
    else:
        transcript, speech_rate = "", 0.0

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
    logger.info(f"  [3/3] Unified LLM analysis ({len(frames)} frames)...")

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
        llm, clip_name = _call_unified_llm(frames, prompt)
        llm.transcript = transcript
        llm.speech_rate = round(speech_rate, 2)
    except Exception as e:
        logger.error(f"Unified analysis failed: {e}")
        llm = LlmAnalysis(transcript=transcript, speech_rate=round(speech_rate, 2))
        clip_name = ""

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
