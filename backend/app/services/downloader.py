import logging
import os

import yt_dlp

logger = logging.getLogger(__name__)

# Well-known public Twitch GQL Client-ID kept as the default so existing
# deployments continue to work without explicit configuration.
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")


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

    # Fetch game ID + box art from Twitch GQL using VOD ID
    vod_id = info.get("id", "")
    game_id, game_thumbnail = _fetch_game_info(vod_id)

    # Fetch streamer profile picture
    streamer_login = info.get("uploader", "")
    streamer_thumbnail = _fetch_streamer_thumbnail(streamer_login)

    metadata = {
        "title": info.get("title", "Unknown"),
        "duration": info.get("duration", 0),
        "id": vod_id,
        "game": game,
        "game_id": game_id,
        "game_thumbnail": game_thumbnail,
        "streamer": streamer_login,
        "streamer_thumbnail": streamer_thumbnail,
        "view_count": info.get("view_count", 0),
        "stream_date": stream_date,
    }
    return audio_path, metadata


def _fetch_game_info(vod_id: str) -> tuple[str, str]:
    """Fetch game ID and box art URL from Twitch GQL for a given VOD."""
    import requests

    if not vod_id:
        return "", ""

    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}

    query = """query {
        video(id: "%s") {
            game {
                id
                displayName
                boxArtURL(width: 285, height: 380)
            }
        }
    }""" % vod_id

    try:
        resp = requests.post(gql_url, json={"query": query}, headers=headers, timeout=10)
        data = resp.json()
        game_data = data.get("data", {}).get("video", {}).get("game") or {}
        game_id = game_data.get("id", "")
        box_art = game_data.get("boxArtURL", "")
        logger.info(f"Twitch GQL game info: id={game_id}, boxArt={'yes' if box_art else 'no'}")
        return game_id, box_art
    except Exception as e:
        logger.warning(f"Failed to fetch game info from Twitch GQL: {e}")
        return "", ""


def _fetch_streamer_thumbnail(login: str) -> str:
    """Fetch streamer profile picture URL from Twitch GQL."""
    import requests

    if not login:
        return ""

    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}

    query = """query {
        user(login: "%s") {
            profileImageURL(width: 150)
        }
    }""" % login.lower()

    try:
        resp = requests.post(gql_url, json={"query": query}, headers=headers, timeout=10)
        data = resp.json()
        user_data = data.get("data", {}).get("user") or {}
        profile_url = user_data.get("profileImageURL", "")
        logger.info(f"Twitch GQL streamer info: login={login}, avatar={'yes' if profile_url else 'no'}")
        return profile_url
    except Exception as e:
        logger.warning(f"Failed to fetch streamer thumbnail from Twitch GQL: {e}")
        return ""


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
    headers = {"Client-ID": TWITCH_CLIENT_ID}

    # First, get VOD duration to know when to stop
    duration_query = """query { video(id: "%s") { lengthSeconds } }""" % video_id
    vod_duration = 0
    try:
        dr = requests.post(gql_url, json={"query": duration_query}, headers=headers, timeout=10)
        vod_duration = dr.json().get("data", {}).get("video", {}).get("lengthSeconds", 0) or 0
    except Exception as e:
        logger.warning("Failed to fetch VOD duration for %s: %s", video_id, e)
        vod_duration = 36000  # fallback 10h

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
    content_offset = 0
    empty_streak = 0  # consecutive empty responses
    seen_ts: set[tuple[float, str]] = set()  # dedup (offset pagination overlaps)
    max_requests = 2000  # safety limit

    try:
        for _ in range(max_requests):
            payload = {
                "operationName": "VideoCommentsByOffsetOrCursor",
                "query": query,
                "variables": {"videoID": video_id, "contentOffsetSeconds": content_offset},
            }
            resp = requests.post(gql_url, json=payload, headers=headers, timeout=15)
            data = resp.json()

            video = data.get("data", {}).get("video")
            if not video:
                break

            comments = video.get("comments")
            edges = (comments or {}).get("edges") or []

            if not edges:
                # No messages at this offset — jump forward and try again
                empty_streak += 1
                # Exponential jump: 60s, 120s, 240s, capped at 600s
                jump = min(60 * (2 ** (empty_streak - 1)), 600)
                content_offset += jump
                if content_offset >= vod_duration:
                    break
                continue

            empty_streak = 0
            last_ts = content_offset
            for edge in edges:
                node = edge.get("node", {})
                ts = node.get("contentOffsetSeconds")
                if ts is None:
                    continue
                author = (node.get("commenter") or {}).get("displayName", "")
                key = (float(ts), author)
                if key in seen_ts:
                    continue
                seen_ts.add(key)
                text = "".join(f.get("text", "") for f in node.get("message", {}).get("fragments", []))
                messages.append({"timestamp": float(ts), "text": text, "author": author})
                last_ts = max(last_ts, ts)

            # Always offset-based (cursor pagination fails with integrity check)
            content_offset = last_ts + 1

    except Exception as e:
        logger.warning("Chat download interrupted after %d messages: %s", len(messages), e)

    logger.info(f"Chat download: {len(messages)} messages over {vod_duration}s VOD")
    return messages
