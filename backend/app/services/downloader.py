import os

import yt_dlp
from chat_downloader import ChatDownloader


def download_audio(url: str, output_dir: str) -> tuple[str, dict]:
    """Download audio from a Twitch VOD as WAV, downsampled to 11025Hz mono."""
    os.makedirs(output_dir, exist_ok=True)

    opts = {
        "format": "bestaudio/best",
        "outtmpl": f"{output_dir}/audio.%(ext)s",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        "postprocessor_args": {"FFmpegExtractAudio": ["-ar", "11025", "-ac", "1"]},
        "quiet": True,
        "no_warnings": True,
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    audio_path = os.path.join(output_dir, "audio.wav")
    # Extract game name from chapters (Twitch puts game changes as chapters)
    game = ""
    chapters = info.get("chapters") or []
    if chapters:
        # Use the most common chapter title (= the main game)
        from collections import Counter
        game_counts = Counter(c.get("title", "") for c in chapters if c.get("title"))
        if game_counts:
            game = game_counts.most_common(1)[0][0]

    metadata = {
        "title": info.get("title", "Unknown"),
        "duration": info.get("duration", 0),
        "id": info.get("id", ""),
        "game": game,
    }
    return audio_path, metadata


def download_chat(url: str) -> list[dict]:
    """Download chat messages from a Twitch VOD with timestamps."""
    try:
        downloader = ChatDownloader()
        chat = downloader.get_chat(url)
        messages = []
        for msg in chat:
            ts = msg.get("time_in_seconds")
            if ts is None:
                continue
            messages.append(
                {
                    "timestamp": ts,
                    "text": msg.get("message", ""),
                    "author": msg.get("author", {}).get("name", ""),
                }
            )
        return messages
    except Exception:
        # Chat may be unavailable — return empty list, scorer handles it gracefully
        return []
