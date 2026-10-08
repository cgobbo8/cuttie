"""AI client configuration — multi-provider (OpenRouter, Groq, OpenAI, Gemini).

All providers use OpenAI-compatible endpoints via the openai SDK,
so no additional dependencies are needed. API keys come from the Settings
page (settings.json) with env var fallbacks; clients are rebuilt when a key
changes.
"""

import os
import threading

from openai import OpenAI

from app.services import settings

_clients: dict[str, tuple[str, OpenAI]] = {}
_lock = threading.Lock()


def _client(name: str, api_key: str, base_url: str | None = None) -> OpenAI:
    with _lock:
        cached = _clients.get(name)
        if cached and cached[0] == api_key:
            return cached[1]
        client = OpenAI(api_key=api_key or "missing", base_url=base_url)
        _clients[name] = (api_key, client)
        return client


def get_openai_client() -> OpenAI:
    """OpenAI client — fallback, kept for backward compatibility."""
    return _client("openai", settings.get("openai_api_key", "OPENAI_API_KEY"))


def get_openrouter_client() -> OpenAI:
    """OpenRouter client — for LLM analysis (Gemini via OpenRouter)."""
    return _client(
        "openrouter",
        settings.get("openrouter_api_key", "OPENROUTER_API_KEY"),
        "https://openrouter.ai/api/v1",
    )


def get_groq_client() -> OpenAI:
    """Groq client — for Whisper transcription."""
    return _client(
        "groq",
        settings.get("groq_api_key", "GROQ_API_KEY"),
        "https://api.groq.com/openai/v1",
    )


def get_gemini_client() -> OpenAI:
    """Gemini client — kept for backward compatibility."""
    return _client(
        "gemini",
        settings.get("gemini_api_key", "GEMINI_API_KEY"),
        "https://generativelanguage.googleapis.com/v1beta/openai/",
    )


# ── Model names (override via env vars) ──

# Whisper transcription via Groq
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3-turbo")

# Vision + audio + narrative synthesis via OpenRouter (Gemini 3 Flash Preview)
LLM_MODEL = os.getenv("LLM_MODEL", "google/gemini-3-flash-preview")
