"""Generate styled ASS subtitles from Whisper word-level timestamps.

Produces karaoke-style subtitles: current word highlighted, rest dimmed.
Output is an ASS file that FFmpeg can burn into video.
"""

import logging
import os
import subprocess

import cv2
import numpy as np
from app.services.openai_client import get_openrouter_client, get_groq_client, LLM_MODEL, WHISPER_MODEL

logger = logging.getLogger(__name__)

# Font
FONT_NAME = "Luckiest Guy"
FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts")

# Style constants
OUTLINE_COLOR = "&H00000000"  # black outline
BACK_COLOR = "&H80000000"     # semi-transparent black shadow


def _fix_timestamps_with_vad(words: list[dict], audio_path: str) -> list[dict]:
    """Correct word start timestamps using voice activity detection.

    Whisper sometimes places word.start in silence before the word is spoken
    (the classic "JE flotte 4 secondes" bug). We use librosa to detect voiced
    regions and snap any word whose start falls in silence to the next speech onset.
    """
    try:
        import librosa
        y, sr = librosa.load(audio_path, sr=16000, mono=True)
        # Non-silent intervals: list of [start_frame, end_frame]
        intervals = librosa.effects.split(y, top_db=32)
    except Exception as e:
        logger.warning(f"VAD timestamp correction failed, skipping: {e}")
        return words

    if len(intervals) == 0:
        return words

    # Convert frame indices to seconds
    voiced = [(int(s) / sr, int(e) / sr) for s, e in intervals]

    def in_speech(t: float) -> bool:
        return any(s - 0.05 <= t <= e + 0.05 for s, e in voiced)

    def next_speech_start(after: float) -> float | None:
        candidates = [s for s, _ in voiced if s > after]
        return min(candidates) if candidates else None

    result = []
    for w in words:
        corrected_start = w["start"]
        if not in_speech(w["start"]):
            nxt = next_speech_start(w["start"])
            if nxt is not None:
                gap = nxt - w["start"]
                # Correct only if the gap is meaningful (>150ms) and not absurd (>6s)
                if 0.15 < gap < 6.0:
                    corrected_start = nxt
        result.append({**w, "start": corrected_start})

    return result


def transcribe_with_words(clip_path: str) -> tuple[str, float, list[dict]]:
    """Transcribe clip and get word-level timestamps.

    Returns (full_text, speech_rate, words) where words is a list of
    {"word": str, "start": float, "end": float}.
    """
    client = get_groq_client()

    # Extract audio as mp3
    audio_path = clip_path.replace(".mp4", "_sub_audio.mp3")
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", clip_path,
                "-vn",
                "-c:a", "libmp3lame", "-b:a", "64k",
                audio_path,
            ],
            check=True, timeout=30, capture_output=True,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        logger.warning("Failed to extract audio for subtitles from %s: %s", clip_path, e)
        return "", 0.0, []

    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=f,
                response_format="verbose_json",
                timestamp_granularities=["word"],
            )

        text = result.text or ""
        words = []
        if hasattr(result, "words") and result.words:
            for w in result.words:
                words.append({
                    "word": w.word,
                    "start": w.start,
                    "end": w.end,
                })

        if words:
            # 1. Snap timestamps that fall in silence to next speech onset
            words = _fix_timestamps_with_vad(words, audio_path)
            # 2. Fix French accents, apostrophes, word boundaries
            words = _rewrite_words_with_llm(words)
            text = " ".join(w["word"] for w in words)

        duration = words[-1]["end"] if words else 0.0
        word_count = len(text.split())
        speech_rate = word_count / duration if duration > 0 else 0.0

        return text, speech_rate, words

    except Exception as e:
        logger.error(f"Word-level transcription failed: {e}")
        return "", 0.0, []
    finally:
        if os.path.isfile(audio_path):
            os.remove(audio_path)


def extract_dominant_color(clip_path: str) -> tuple[int, int, int]:
    """Extract the dominant color from a clip using k-means on sampled frames.
    Returns (R, G, B).
    """
    cap = cv2.VideoCapture(clip_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    pixels = []
    for pos in [0.2, 0.5, 0.8]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * pos))
        ret, frame = cap.read()
        if ret:
            small = cv2.resize(frame, (64, 36))
            pixels.append(small.reshape(-1, 3))
    cap.release()

    if not pixels:
        return (100, 100, 200)  # fallback blue

    all_pixels = np.vstack(pixels).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, labels, centers = cv2.kmeans(all_pixels, 5, None, criteria, 3, cv2.KMEANS_PP_CENTERS)

    # Pick the largest cluster
    counts = np.bincount(labels.flatten())
    dominant_idx = np.argmax(counts)
    bgr = centers[dominant_idx]
    r, g, b = int(bgr[2]), int(bgr[1]), int(bgr[0])

    # Ensure the color is reasonably saturated (not too dark/gray)
    brightness = (r + g + b) / 3
    if brightness < 40:
        r, g, b = max(r, 60), max(g, 60), max(b, 100)

    logger.info(f"Dominant color: RGB({r},{g},{b})")
    return r, g, b


def _rgb_to_ass_color(r: int, g: int, b: int) -> str:
    """Convert RGB to ASS color format (&HBBGGRR with alpha 00)."""
    return f"&H00{b:02X}{g:02X}{r:02X}"


def _tint_white(r: int, g: int, b: int, strength: float = 0.15) -> tuple[int, int, int]:
    """Tint white slightly toward the given color."""
    return (
        int(255 * (1 - strength) + r * strength),
        int(255 * (1 - strength) + g * strength),
        int(255 * (1 - strength) + b * strength),
    )


def _rewrite_words_with_llm(words: list[dict]) -> list[dict]:
    """Fix Whisper transcription issues using a fast LLM.

    Whisper often drops accents, apostrophes, and splits words incorrectly
    in French (e.g. "Bon jour l ami" instead of "Bonjour l'ami").

    Sends raw text to LLM, gets corrected text, then re-aligns word timestamps
    using character-position mapping.
    """
    if not words:
        return words

    raw_text = " ".join(w["word"].strip() for w in words)
    if not raw_text.strip():
        return words

    client = get_openrouter_client()
    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Tu es un correcteur de sous-titres français. "
                        "Corrige l'orthographe, les accents, les apostrophes et les mots mal découpés. "
                        "Ne change PAS le sens ni n'ajoute/supprime de mots. "
                        "Retourne UNIQUEMENT le texte corrigé, rien d'autre."
                    ),
                },
                {"role": "user", "content": raw_text},
            ],
        )
        corrected = response.choices[0].message.content.strip()
    except Exception as e:
        logger.warning(f"LLM subtitle rewriting failed, using raw: {e}")
        return words

    # Re-align corrected words to original timestamps via character-position mapping
    corrected_words = corrected.split()
    if not corrected_words:
        return words

    # Build character→word index mapping for original text
    orig_chars = []  # for each char position in raw_text, which word index
    for i, w in enumerate(words):
        word = w["word"].strip()
        for _ in word:
            orig_chars.append(i)
        if i < len(words) - 1:
            orig_chars.append(i)  # space

    # Build character ranges for corrected words
    result = []
    char_pos = 0
    for cw in corrected_words:
        # Find this word's character range in the original text
        # Use proportional mapping based on character position
        start_ratio = char_pos / max(len(corrected), 1)
        end_ratio = (char_pos + len(cw)) / max(len(corrected), 1)

        orig_start_idx = int(start_ratio * len(orig_chars))
        orig_end_idx = int(end_ratio * len(orig_chars)) - 1

        orig_start_idx = max(0, min(orig_start_idx, len(orig_chars) - 1))
        orig_end_idx = max(0, min(orig_end_idx, len(orig_chars) - 1))

        first_word_idx = orig_chars[orig_start_idx]
        last_word_idx = orig_chars[orig_end_idx]

        result.append({
            "word": cw,
            "start": words[first_word_idx]["start"],
            "end": words[last_word_idx]["end"],
        })

        char_pos += len(cw) + 1  # +1 for space

    logger.info(f"Subtitle rewrite: {len(words)} words -> {len(result)} words")
    return result


def _format_ass_time(seconds: float) -> str:
    """Format seconds to ASS time: H:MM:SS.cc"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds % 1) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _chunk_words(words: list[dict], max_words: int = 4, max_duration: float = 3.0) -> list[list[dict]]:
    """Group words into display chunks (subtitle lines).

    Each chunk has at most max_words words and lasts at most max_duration seconds.
    """
    chunks = []
    current: list[dict] = []

    for w in words:
        if current:
            duration = w["end"] - current[0]["start"]
            if len(current) >= max_words or duration > max_duration:
                chunks.append(current)
                current = []
        current.append(w)

    if current:
        chunks.append(current)

    return chunks


def generate_ass(
    words: list[dict],
    output_path: str,
    video_width: int = 1080,
    video_height: int = 1920,
    dominant_color: tuple[int, int, int] = (100, 100, 200),
) -> str:
    """Generate ASS subtitle file with word-by-word highlighting.

    Words appear in chunks. The active word is highlighted (white tinted toward
    dominant color), unfilled text uses the dominant color. Positioned near bottom.
    """
    font_size = max(16, video_width // 14)

    # Colors: highlight = tinted white, base = dominant color
    dr, dg, db = dominant_color
    tr, tg, tb = _tint_white(dr, dg, db, 0.15)
    highlight_color = _rgb_to_ass_color(tr, tg, tb)
    base_color = _rgb_to_ass_color(dr, dg, db)

    margin_v = 80

    header = f"""[Script Info]
Title: Cuttie Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{FONT_NAME},{font_size},{highlight_color},{base_color},{OUTLINE_COLOR},{BACK_COLOR},-1,0,0,0,100,100,0,0,1,4,2,2,40,40,{margin_v},1
Style: Highlight,{FONT_NAME},{font_size},{highlight_color},{base_color},{OUTLINE_COLOR},{BACK_COLOR},-1,0,0,0,100,100,0,0,1,4,2,2,40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    chunks = _chunk_words(words)

    for chunk in chunks:
        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]
        start_ts = _format_ass_time(chunk_start)
        end_ts = _format_ass_time(chunk_end)

        # Build text with word-by-word karaoke timing
        # Using ASS \kf (smooth fill) tags for karaoke effect
        parts = []
        for w in chunk:
            # Duration in centiseconds for this word (clamp to 0)
            word_dur_cs = max(0, int((w["end"] - w["start"]) * 100))
            parts.append(f"{{\\kf{word_dur_cs}}}{w['word'].upper()}")

        text = " ".join(parts)
        events.append(
            f"Dialogue: 0,{start_ts},{end_ts},Highlight,,0,0,0,,{text}"
        )

    content = header + "\n".join(events) + "\n"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"ASS subtitles: {len(events)} lines, {len(words)} words -> {output_path}")
    return output_path
