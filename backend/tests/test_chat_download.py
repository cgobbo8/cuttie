"""Reading the Twitch chat of a VOD (GQL faked)."""

import requests

from app.services import downloader


def _comment(ts, author, fragments):
    return {
        "node": {
            "contentOffsetSeconds": ts,
            "commenter": {"displayName": author},
            "message": {"fragments": [{"text": t, "emote": {"emoteID": e} if e else None} for t, e in fragments]},
        }
    }


def test_chat_keeps_the_emote_names(monkeypatch):
    pages = [
        [
            _comment(10, "johnnyyt19", [("<3", "555555584"), (" ", None), ("PansexualPride", "307827370")]),
            _comment(11, "EvaAinsworth", [("OMG j'adore ", None), ("falkarCry", "emotesv2_1836")]),
            _comment(12, "Ellyia", [("Bebou il est trop chou", None)]),
        ],
        [],
    ]

    class Response:
        def __init__(self, edges):
            self.edges = edges

        def json(self):
            return {"data": {"video": {"comments": {"edges": self.edges}}}}

    def post(url, json, headers, timeout):
        assert "emote { emoteID }" in json["query"]
        return Response(pages.pop(0) if pages else [])

    monkeypatch.setattr(requests, "post", post)

    messages = downloader._download_chat_chunk("123", 0, 60, 0)

    assert messages == [
        {"timestamp": 10.0, "text": "<3 PansexualPride", "author": "johnnyyt19", "emotes": ["<3", "PansexualPride"]},
        {"timestamp": 11.0, "text": "OMG j'adore falkarCry", "author": "EvaAinsworth", "emotes": ["falkarCry"]},
        {"timestamp": 12.0, "text": "Bebou il est trop chou", "author": "Ellyia"},
    ]
