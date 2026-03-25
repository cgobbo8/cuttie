"""Generate styled ASS subtitles from Whisper word-level timestamps.

Produces karaoke-style subtitles: current word highlighted, rest dimmed.
Output is an ASS file that FFmpeg can burn into video.
"""

import logging
import os
import subprocess

from openai import OpenAI

logger = logging.getLogger(__name__)

# Style constants
FONT_NAME = "Arial Black"
FONT_SIZE = 16  # will be scaled to vertical resolution
PRIMARY_COLOR = "&H00FFFFFF"   # white (active word)
OUTLINE_COLOR = "&H00000000"  # black outline
BACK_COLOR = "&H80000000"     # semi-transparent black shadow
HIGHLIGHT_COLOR = "&H0000FFFF"  # yellow (current word)


def _get_client() -> OpenAI:
    return OpenAI()


def transcribe_with_words(clip_path: str) -> tuple[str, float, list[dict]]:
    """Transcribe clip and get word-level timestamps.

    Returns (full_text, speech_rate, words) where words is a list of
    {"word": str, "start": float, "end": float}.
    """
    client = _get_client()

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
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return "", 0.0, []

    try:
        with open(audio_path, "rb") as f:
            result = client.audio.transcriptions.create(
                model="whisper-1",
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


def generate_ass(words: list[dict], output_path: str, video_width: int = 1080, video_height: int = 1920) -> str:
    """Generate ASS subtitle file with word-by-word highlighting.

    Words appear in chunks. The active word is highlighted in yellow,
    others in white. Positioned in lower third of the screen.
    """
    font_size = max(16, video_width // 20)

    header = f"""[Script Info]
Title: Cuttie Subtitles
ScriptType: v4.00+
PlayResX: {video_width}
PlayResY: {video_height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{FONT_NAME},{font_size},{PRIMARY_COLOR},&H000000FF,{OUTLINE_COLOR},{BACK_COLOR},-1,0,0,0,100,100,0,0,1,3,1,2,40,40,200,1
Style: Highlight,{FONT_NAME},{font_size},{HIGHLIGHT_COLOR},&H000000FF,{OUTLINE_COLOR},{BACK_COLOR},-1,0,0,0,100,100,0,0,1,3,1,2,40,40,200,1

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
            # Duration in centiseconds for this word
            word_dur_cs = int((w["end"] - w["start"]) * 100)
            parts.append(f"{{\\kf{word_dur_cs}}}{w['word']}")

        text = " ".join(parts)
        events.append(
            f"Dialogue: 0,{start_ts},{end_ts},Highlight,,0,0,0,,{text}"
        )

    content = header + "\n".join(events) + "\n"

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)

    logger.info(f"ASS subtitles: {len(events)} lines, {len(words)} words -> {output_path}")
    return output_path
