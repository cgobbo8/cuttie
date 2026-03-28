#!/usr/bin/env python3
"""Backfill streamer_thumbnail for existing jobs.

Fetches profile pictures from Twitch GQL and updates the AdonisJS SQLite database.

Usage:
    python api/scripts/backfill_streamer_thumbnails.py
"""

import sqlite3
import time

import requests

DB_PATH = "api/database/db.sqlite3"
GQL_URL = "https://gql.twitch.tv/gql"
GQL_HEADERS = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}


def fetch_streamer_thumbnail(login: str) -> str:
    query = """query {
        user(login: "%s") {
            profileImageURL(width: 150)
        }
    }""" % login.lower()

    resp = requests.post(GQL_URL, json={"query": query}, headers=GQL_HEADERS, timeout=10)
    data = resp.json()
    user_data = data.get("data", {}).get("user") or {}
    return user_data.get("profileImageURL", "")


def main():
    conn = sqlite3.connect(DB_PATH)

    # Get distinct streamers that need backfill
    streamers = conn.execute(
        "SELECT DISTINCT streamer FROM jobs "
        "WHERE streamer IS NOT NULL AND streamer <> '' "
        "AND (streamer_thumbnail IS NULL OR streamer_thumbnail = '')"
    ).fetchall()

    print(f"Found {len(streamers)} streamers to backfill")

    updated = 0
    for (streamer,) in streamers:
        try:
            thumbnail = fetch_streamer_thumbnail(streamer)
            time.sleep(0.2)
        except Exception as e:
            print(f"  [{streamer}] error: {e}")
            continue

        if not thumbnail:
            print(f"  [{streamer}] skip — no profile picture found")
            continue

        conn.execute(
            "UPDATE jobs SET streamer_thumbnail = ? WHERE streamer = ? AND (streamer_thumbnail IS NULL OR streamer_thumbnail = '')",
            (thumbnail, streamer),
        )
        count = conn.execute(
            "SELECT changes()"
        ).fetchone()[0]
        updated += count
        print(f"  [{streamer}] -> {count} jobs updated, thumbnail=yes")

    conn.commit()
    conn.close()
    print(f"\nDone: {updated} jobs updated across {len(streamers)} streamers")


if __name__ == "__main__":
    main()
