"""Videos the streamer imports into their media library (<data dir>/media, kept by the API).

The worker only listens to them: what is said in one, word by word, so that a passage made of it
gets subtitles and can be cut on its words like a passage of a live.
"""

import logging
import os
import subprocess

logger = logging.getLogger(__name__)


def words(path: str) -> list[dict]:
    """The words said in an imported video, timed in its own seconds: [{"word", "start", "end"}].
    An empty list when nobody speaks in it. Raises when it could not be listened to (the caller
    then knows nothing was heard, which is not the same as nothing being said)."""
    audio = f"{os.path.splitext(path)[0]}_sub_audio.mp3"
    subprocess.run(["ffmpeg", "-y", "-i", path, "-vn", "-c:a", "libmp3lame", "-b:a", "64k", audio], check=True, timeout=120, capture_output=True)
    try:
        # Same engine choice, retries and fallback as the analysis
        from app.services.llm_analyzer import _transcribe_audio
        from app.services.subtitle_generator import _fix_timestamps_with_vad

        _text, _rate, _segments, found = _transcribe_audio(audio)
        if not found:
            return []
        # Times that fall in a silence are moved to where the voice starts
        return _fix_timestamps_with_vad(found, audio)
    finally:
        if os.path.isfile(audio):
            os.remove(audio)
