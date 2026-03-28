#!/usr/bin/env python3
"""Backfill creators table from existing jobs.

Creates creator records from distinct streamers, fetches Twitch IDs,
and links jobs to their creator via creator_id.

Usage:
    python api/scripts/backfill_creators.py
"""

import sqlite3
import time

import requests

DB_PATH = "api/database/db.sqlite3"
GQL_URL = "https://gql.twitch.tv/gql"
GQL_HEADERS = {"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko"}


def fetch_twitch_user(login: str) -> dict:
    query = """query {
        user(login: "%s") {
            id
            displayName
            profileImageURL(width: 150)
        }
    }""" % login.lower()

    resp = requests.post(GQL_URL, json={"query": query}, headers=GQL_HEADERS, timeout=10)
    data = resp.json()
    return data.get("data", {}).get("user") or {}


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Get distinct streamers with their user_id and best thumbnail
    rows = conn.execute(
        "SELECT streamer, user_id, MAX(streamer_thumbnail) as thumbnail "
        "FROM jobs "
        "WHERE streamer IS NOT NULL AND streamer <> '' AND user_id IS NOT NULL "
        "GROUP BY streamer, user_id"
    ).fetchall()

    print(f"Found {len(rows)} streamer/user pairs to create")

    creators_created = 0
    jobs_linked = 0

    for row in rows:
        streamer = row["streamer"]
        user_id = row["user_id"]
        existing_thumbnail = row["thumbnail"] or ""

        # Check if creator already exists
        existing = conn.execute(
            "SELECT id FROM creators WHERE login = ? AND user_id = ?",
            (streamer.lower(), user_id),
        ).fetchone()

        if existing:
            creator_id = existing["id"]
            print(f"  [{streamer}] already exists (id={creator_id})")
        else:
            # Fetch Twitch user info
            try:
                twitch_data = fetch_twitch_user(streamer)
                time.sleep(0.2)
            except Exception as e:
                print(f"  [{streamer}] error fetching Twitch data: {e}")
                twitch_data = {}

            twitch_id = twitch_data.get("id", "")
            display_name = twitch_data.get("displayName", streamer)
            thumbnail = twitch_data.get("profileImageURL", "") or existing_thumbnail

            now = "2026-03-28T00:00:00.000+00:00"
            conn.execute(
                "INSERT INTO creators (twitch_id, login, display_name, thumbnail, user_id, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (twitch_id or None, streamer.lower(), display_name, thumbnail or None, user_id, now, now),
            )
            creator_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            creators_created += 1
            print(f"  [{streamer}] created (id={creator_id}, twitch_id={twitch_id or 'N/A'}, thumbnail={'yes' if thumbnail else 'no'})")

        # Link all jobs from this streamer to the creator
        result = conn.execute(
            "UPDATE jobs SET creator_id = ? WHERE streamer = ? AND user_id = ? AND (creator_id IS NULL)",
            (creator_id, streamer, user_id),
        )
        linked = result.rowcount
        jobs_linked += linked
        if linked:
            print(f"    -> {linked} jobs linked")

    conn.commit()
    conn.close()
    print(f"\nDone: {creators_created} creators created, {jobs_linked} jobs linked")


if __name__ == "__main__":
    main()
