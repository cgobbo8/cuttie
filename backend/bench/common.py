"""Shared plumbing for the clip-picking benchmark.

Everything lands in <repo>/.data/bench (git-ignored), never in the app's own
data: each run gets its own CUTTIE_DATA_DIR and sends no events to the API.

`setup()` must run before anything imports `app`: the worker reads its data
directory and keys at import time.
"""

import json
import os
import sys
import threading
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BENCH = REPO / ".data" / "bench"
MAIN_SETTINGS = REPO / ".data" / "settings.json"
CURRENT_CODE = REPO / "backend"

# The benchmark VODs: Falkarst lives with viewer clips (the only outside truth we have)
VODS = {
    "2886567499": "Maurice comme un lundi (28/09)",
    "2891960089": "Maurice reprend du service (04/10)",
    "2888279040": "Maurice comme mercredi (30/09)",
    "2876768393": "Maurice à la guerre ? (17/09)",
    "2891094810": "Maurice qui va regarder le GP (03/10)",
    "2889137616": "Maurice à la cérémonie du SAMC (01/10)",
    "2879569550": "Maurice avec du temps libre (20/09)",
    "2868019248": "Maurice va reprendre son service ! (07/09)",
}


def run_dir(version: str, vod: str, label: str = "run1") -> Path:
    return BENCH / "runs" / version / label / vod


def setup(data_dir: Path, code_dir: Path = CURRENT_CODE) -> None:
    """Point the worker code at an isolated data dir and the user's API keys."""
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ["CUTTIE_DATA_DIR"] = str(data_dir)
    os.environ.pop("CUTTIE_API_URL", None)  # no status events to the running app
    try:
        settings = json.loads(MAIN_SETTINGS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        settings = {}
    for key, env in (("groq_api_key", "GROQ_API_KEY"), ("openrouter_api_key", "OPENROUTER_API_KEY")):
        if settings.get(key):
            os.environ[env] = settings[key]
    if not os.environ.get("OPENROUTER_API_KEY"):
        try:
            from dotenv import load_dotenv

            load_dotenv(CURRENT_CODE / ".env")
        except ImportError:
            pass
    sys.path.insert(0, str(code_dir))


class Usage:
    """Cost and tokens of every OpenRouter call, per thread (to pin them on a candidate) and in total."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._local = threading.local()
        self.total_cost = 0.0
        self.calls = 0
        self.events: list[dict] = []

    def add(self, event: dict) -> None:
        with self._lock:
            self.total_cost += event.get("cost") or 0.0
            self.calls += 1
            self.events.append(event)
        self._local.last = event

    def last(self) -> dict | None:
        return getattr(self._local, "last", None)

    def reset_thread(self) -> None:
        self._local.last = None


class _Completions:
    def __init__(self, inner, usage: Usage) -> None:
        self._inner = inner
        self._usage = usage

    def create(self, **kwargs):
        body = dict(kwargs.pop("extra_body", None) or {})
        body["usage"] = {"include": True}
        t0 = time.time()
        resp = self._inner.create(extra_body=body, **kwargs)
        u = getattr(resp, "usage", None)
        extra = getattr(u, "model_extra", None) or {}
        self._usage.add({
            "model": kwargs.get("model"),
            "seconds": round(time.time() - t0, 2),
            "prompt_tokens": getattr(u, "prompt_tokens", None),
            "completion_tokens": getattr(u, "completion_tokens", None),
            "cost": extra.get("cost") if extra.get("cost") is not None else getattr(u, "cost", None),
            "finish": resp.choices[0].finish_reason if resp.choices else None,
        })
        return resp


class _Chat:
    def __init__(self, inner, usage: Usage) -> None:
        self.completions = _Completions(inner.completions, usage)


class MeteredClient:
    """OpenRouter client that asks for usage accounting and records it."""

    def __init__(self, client, usage: Usage) -> None:
        self._client = client
        self.base_url = client.base_url
        self.chat = _Chat(client.chat, usage)
        self.audio = client.audio


def meter_openrouter(llm_analyzer, usage: Usage) -> None:
    """Make the worker's LLM calls go through MeteredClient."""
    real = llm_analyzer.get_openrouter_client
    llm_analyzer.get_openrouter_client = lambda: MeteredClient(real(), usage)


def _gql(query: str, variables: dict) -> dict:
    req = urllib.request.Request(
        "https://gql.twitch.tv/gql",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def viewer_clips(vod: str) -> list[dict]:
    """Clips viewers made on a VOD: start offset, length, views (cached)."""
    cache = BENCH / "viewer_clips" / f"{vod}.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    r = _gql(
        "query($id: ID!) { video(id: $id) { clips(first: 100) { edges { node { id title viewCount durationSeconds videoOffsetSeconds curator { login } } } } } }",
        {"id": vod},
    )
    nodes = [e["node"] for e in ((r.get("data") or {}).get("video") or {}).get("clips", {}).get("edges", [])]
    clips = [
        {"start": n["videoOffsetSeconds"], "end": n["videoOffsetSeconds"] + n["durationSeconds"], "views": n["viewCount"], "title": n["title"], "by": (n.get("curator") or {}).get("login")}
        for n in nodes
        if n.get("videoOffsetSeconds") is not None
    ]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(clips, ensure_ascii=False, indent=1), encoding="utf-8")
    return clips
