import os

import yt_dlp


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

    # Format upload date
    upload_date_raw = info.get("upload_date", "")
    stream_date = ""
    if upload_date_raw and len(upload_date_raw) == 8:
        stream_date = f"{upload_date_raw[:4]}-{upload_date_raw[4:6]}-{upload_date_raw[6:]}"

    metadata = {
        "title": info.get("title", "Unknown"),
        "duration": info.get("duration", 0),
        "id": info.get("id", ""),
        "game": game,
        "streamer": info.get("uploader", ""),
        "view_count": info.get("view_count", 0),
        "stream_date": stream_date,
    }
    return audio_path, metadata


def download_chat(url: str) -> list[dict]:
    """Download chat messages from a Twitch VOD using the GQL API directly.

    chat-downloader lib has a broken persisted query hash, so we hit the
    Twitch GQL endpoint ourselves with a raw query.
    """
    import re
    import requests

    match = re.search(r"videos/(\d+)", url)
    if not match:
        return []

    video_id = match.group(1)
    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}

    query = """query VideoCommentsByOffsetOrCursor($videoID: ID!, $cursor: Cursor, $contentOffsetSeconds: Int) {
        video(id: $videoID) {
            comments(after: $cursor, contentOffsetSeconds: $contentOffsetSeconds, first: 100) {
                edges {
                    cursor
                    node {
                        contentOffsetSeconds
                        commenter { displayName }
                        message { fragments { text } }
                    }
                }
            }
        }
    }"""

    messages: list[dict] = []
    cursor: str | None = None
    content_offset = 0
    max_offset_jumps = 500  # Safety limit for pagination

    try:
        for _ in range(max_offset_jumps):
            variables: dict = {"videoID": video_id}
            if cursor:
                variables["cursor"] = cursor
            else:
                variables["contentOffsetSeconds"] = content_offset

            payload = {
                "operationName": "VideoCommentsByOffsetOrCursor",
                "query": query,
                "variables": variables,
            }
            resp = requests.post(gql_url, json=payload, headers=headers, timeout=15)
            data = resp.json()

            video = data.get("data", {}).get("video")
            if not video:
                break

            edges = video.get("comments", {}).get("edges", [])
            if not edges:
                break

            last_ts = 0
            for edge in edges:
                node = edge.get("node", {})
                ts = node.get("contentOffsetSeconds")
                if ts is None:
                    continue
                text = "".join(f.get("text", "") for f in node.get("message", {}).get("fragments", []))
                author = node.get("commenter", {}).get("displayName", "")
                messages.append({"timestamp": float(ts), "text": text, "author": author})
                last_ts = ts

            # Pagination: use cursor if available, otherwise jump by offset
            last_cursor = edges[-1].get("cursor", "")
            if last_cursor:
                cursor = last_cursor
            else:
                # No cursor — jump forward by the last seen timestamp + 1
                cursor = None
                content_offset = last_ts + 1

            # If we got fewer than 100 results and no valid cursor, we might be done
            if len(edges) < 100 and not last_cursor:
                # Jump forward more aggressively
                content_offset = last_ts + 30

    except Exception:
        pass  # Return whatever we got so far

    return messages
