import logging
import os

import yt_dlp

logger = logging.getLogger(__name__)

# Well-known public Twitch GQL Client-ID kept as the default so existing
# deployments continue to work without explicit configuration.
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "kimne78kx3ncx6brgo4mv6wki5h1ko")


def extract_metadata(url: str) -> dict:
    """Extract VOD metadata without downloading (fast, ~2s)."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    # Extract game name from chapters
    game = ""
    chapters = info.get("chapters") or []
    if chapters:
        from collections import Counter
        game_counts = Counter(c.get("title", "") for c in chapters if c.get("title"))
        if game_counts:
            game = game_counts.most_common(1)[0][0]

    # Format upload date
    upload_date_raw = info.get("upload_date", "")
    stream_date = ""
    if upload_date_raw and len(upload_date_raw) == 8:
        stream_date = f"{upload_date_raw[:4]}-{upload_date_raw[4:6]}-{upload_date_raw[6:]}"

    vod_id = info.get("id", "")
    game_id, game_thumbnail = _fetch_game_info(vod_id, game)
    streamer_login = info.get("uploader", "")
    streamer_thumbnail = _fetch_streamer_thumbnail(streamer_login)

    return {
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


def download_audio(url: str, output_dir: str) -> str:
    """Download audio from a Twitch VOD as WAV, downsampled to 11025Hz mono."""
    import glob
    import threading
    import time

    os.makedirs(output_dir, exist_ok=True)

    # Monitor file size in a background thread (yt-dlp progress hooks don't work with FFmpeg HLS)
    stop_monitor = threading.Event()
    part_pattern = os.path.join(output_dir, "audio.*")

    def _monitor():
        last_size = 0
        while not stop_monitor.is_set():
            stop_monitor.wait(15)
            files = glob.glob(part_pattern)
            if not files:
                continue
            total = sum(os.path.getsize(f) for f in files if os.path.isfile(f))
            if total != last_size:
                logger.info(f"Audio download: {total / (1024 * 1024):.0f} MB downloaded...")
                last_size = total

    monitor = threading.Thread(target=_monitor, daemon=True)
    monitor.start()

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
        "concurrent_fragment_downloads": 5,  # parallel HLS segment downloads — helps with slow CDNs
    }

    logger.info("yt-dlp: starting audio download for %s...", url)
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info(url, download=True)
    except Exception as e:
        logger.error("yt-dlp audio download failed: %s", e)
        raise
    finally:
        stop_monitor.set()

    wav_path = os.path.join(output_dir, "audio.wav")
    if not os.path.isfile(wav_path):
        raise FileNotFoundError(f"WAV not found after download: {wav_path}")

    size_mb = os.path.getsize(wav_path) / (1024 * 1024)
    logger.info("Audio WAV ready: %.0f MB", size_mb)
    return wav_path


def _fetch_game_info(vod_id: str, game_name: str = "") -> tuple[str, str]:
    """Fetch game ID and box art URL from Twitch GQL for a given VOD.
    Falls back to searching by game name if VOD lookup fails."""
    import requests

    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}

    # Try by VOD ID first
    if vod_id:
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
            if game_id:
                logger.info(f"Twitch GQL game info (via VOD): id={game_id}, boxArt={'yes' if box_art else 'no'}")
                return game_id, box_art
        except Exception as e:
            logger.warning(f"Failed to fetch game info from Twitch GQL (via VOD): {e}")

    # Fallback: search by game name
    if not game_name:
        return "", ""

    query = """query {
        game(name: "%s") {
            id
            displayName
            boxArtURL(width: 285, height: 380)
        }
    }""" % game_name.replace('"', '\\"')

    try:
        resp = requests.post(gql_url, json={"query": query}, headers=headers, timeout=10)
        data = resp.json()
        game_data = data.get("data", {}).get("game") or {}
        game_id = game_data.get("id", "")
        box_art = game_data.get("boxArtURL", "")
        logger.info(f"Twitch GQL game info (via name '{game_name}'): id={game_id}, boxArt={'yes' if box_art else 'no'}")
        return game_id, box_art
    except Exception as e:
        logger.warning(f"Failed to fetch game info from Twitch GQL (via name): {e}")
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


CHAT_WORKERS = 8  # parallel GQL workers for chat download
CHAT_CHUNK_SECONDS = 1800  # 30-minute chunks


def _download_chat_chunk(
    video_id: str,
    start_offset: int,
    end_offset: int,
    chunk_idx: int,
) -> list[dict]:
    """Download chat messages for a single time chunk of the VOD."""
    import requests

    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": TWITCH_CLIENT_ID}

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
    content_offset = start_offset
    empty_streak = 0
    max_requests = 500  # safety limit per chunk

    for _ in range(max_requests):
        if content_offset >= end_offset:
            break

        payload = {
            "operationName": "VideoCommentsByOffsetOrCursor",
            "query": query,
            "variables": {"videoID": video_id, "contentOffsetSeconds": content_offset},
        }
        try:
            resp = requests.post(gql_url, json=payload, headers=headers, timeout=15)
            data = resp.json()
        except Exception as e:
            logger.warning("Chat chunk %d request failed at offset %ds: %s", chunk_idx, content_offset, e)
            break

        video = data.get("data", {}).get("video")
        if not video:
            break

        edges = (video.get("comments") or {}).get("edges") or []

        if not edges:
            empty_streak += 1
            jump = min(60 * (2 ** (empty_streak - 1)), 600)
            content_offset += jump
            continue

        empty_streak = 0
        last_ts = content_offset
        for edge in edges:
            node = edge.get("node", {})
            ts = node.get("contentOffsetSeconds")
            if ts is None:
                continue
            # Stop collecting if we've passed our chunk boundary
            if ts >= end_offset:
                break
            author = (node.get("commenter") or {}).get("displayName", "")
            text = "".join(f.get("text", "") for f in node.get("message", {}).get("fragments", []))
            messages.append({"timestamp": float(ts), "text": text, "author": author})
            last_ts = max(last_ts, ts)

        content_offset = last_ts + 1

    return messages


def download_chat(url: str) -> list[dict]:
    """Download chat messages from a Twitch VOD using the GQL API directly.

    Splits the VOD into time chunks and downloads them in parallel for speed.
    """
    import re
    import requests
    from concurrent.futures import ThreadPoolExecutor, as_completed

    match = re.search(r"videos/(\d+)", url)
    if not match:
        return []

    video_id = match.group(1)
    gql_url = "https://gql.twitch.tv/gql"
    headers = {"Client-ID": TWITCH_CLIENT_ID}

    # Get VOD duration
    duration_query = """query { video(id: "%s") { lengthSeconds } }""" % video_id
    vod_duration = 0
    try:
        dr = requests.post(gql_url, json={"query": duration_query}, headers=headers, timeout=10)
        vod_duration = dr.json().get("data", {}).get("video", {}).get("lengthSeconds", 0) or 0
    except Exception as e:
        logger.warning("Failed to fetch VOD duration for %s: %s", video_id, e)
        vod_duration = 36000  # fallback 10h

    # Split VOD into chunks
    chunks: list[tuple[int, int]] = []
    offset = 0
    while offset < vod_duration:
        chunk_end = min(offset + CHAT_CHUNK_SECONDS, vod_duration)
        chunks.append((offset, chunk_end))
        offset = chunk_end

    logger.info(
        "Chat download: starting for VOD %s (%ds) — %d chunks, %d workers",
        video_id, vod_duration, len(chunks), CHAT_WORKERS,
    )

    # Download all chunks in parallel
    all_messages: list[dict] = []
    with ThreadPoolExecutor(max_workers=CHAT_WORKERS) as pool:
        futures = {
            pool.submit(_download_chat_chunk, video_id, start, end, i): i
            for i, (start, end) in enumerate(chunks)
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            chunk_idx = futures[future]
            try:
                chunk_msgs = future.result()
                all_messages.extend(chunk_msgs)
            except Exception as e:
                logger.error("Chat chunk %d failed: %s", chunk_idx, e)

            if done % 4 == 0 or done == len(chunks):
                logger.info("Chat download: %d/%d chunks done (%d messages)", done, len(chunks), len(all_messages))

    # Sort and deduplicate (chunk boundaries may overlap)
    all_messages.sort(key=lambda m: m["timestamp"])
    seen: set[tuple[float, str]] = set()
    messages: list[dict] = []
    for m in all_messages:
        key = (m["timestamp"], m["author"])
        if key not in seen:
            seen.add(key)
            messages.append(m)

    logger.info(f"Chat download: {len(messages)} messages over {vod_duration}s VOD")
    return messages
