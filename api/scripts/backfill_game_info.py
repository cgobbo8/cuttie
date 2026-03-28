#!/usr/bin/env python3
"""Backfill vod_game_id and vod_game_thumbnail for existing jobs.

Extracts VOD IDs from job URLs, fetches game info from Twitch GQL,
and updates the AdonisJS SQLite database.

Usage:
    python api/scripts/backfill_game_info.py
"""

import re
import sqlite3
import time

import requests

DB_PATH = "api/database/db.sqlite3"
GQL_URL = "https://gql.twitch.tv/gql"
GQL_HEADERS = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}


def extract_vod_id(url: str) -> str:
    match = re.search(r"/videos/(\d+)", url)
    return match.group(1) if match else ""


def fetch_game_info(vod_id: str) -> tuple[str, str]:
    query = """query {
        video(id: "%s") {
            game {
                id
                displayName
                boxArtURL(width: 285, height: 380)
            }
        }
    }""" % vod_id

    resp = requests.post(GQL_URL, json={"query": query}, headers=GQL_HEADERS, timeout=10)
    data = resp.json()
    game_data = data.get("data", {}).get("video", {}).get("game") or {}
    return game_data.get("id", ""), game_data.get("boxArtURL", "")


def main():
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT id, url, vod_game FROM jobs "
        "WHERE vod_game IS NOT NULL AND vod_game <> '' "
        "AND (vod_game_id IS NULL OR vod_game_id = '')"
    ).fetchall()

    print(f"Found {len(rows)} jobs to backfill")

    # Dedupe by VOD ID to avoid redundant API calls
    vod_cache: dict[str, tuple[str, str]] = {}
    updated = 0

    for job_id, url, vod_game in rows:
        vod_id = extract_vod_id(url)
        if not vod_id:
            print(f"  [{job_id[:8]}] skip — no VOD ID in URL: {url}")
            continue

        if vod_id not in vod_cache:
            try:
                game_id, thumbnail = fetch_game_info(vod_id)
                vod_cache[vod_id] = (game_id, thumbnail)
                time.sleep(0.2)  # gentle rate limit
            except Exception as e:
                print(f"  [{job_id[:8]}] error fetching VOD {vod_id}: {e}")
                continue

        game_id, thumbnail = vod_cache[vod_id]
        if not game_id:
            print(f"  [{job_id[:8]}] skip — no game data for VOD {vod_id}")
            continue

        conn.execute(
            "UPDATE jobs SET vod_game_id = ?, vod_game_thumbnail = ? WHERE id = ?",
            (game_id, thumbnail, job_id),
        )
        updated += 1
        print(f"  [{job_id[:8]}] {vod_game} -> game_id={game_id}, thumbnail={'yes' if thumbnail else 'no'}")

    conn.commit()
    conn.close()
    print(f"\nDone: {updated}/{len(rows)} jobs updated")


if __name__ == "__main__":
    main()
