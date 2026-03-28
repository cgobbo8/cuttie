"""Shared OpenAI client and model configuration.

Centralizes OpenAI client creation and model name constants
so they can be overridden via environment variables.
"""

import os

from openai import OpenAI

_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    """Return a shared OpenAI client instance (lazy singleton)."""
    global _client
    if _client is None:
        _client = OpenAI()
    return _client


# Model names — override via env vars
GPT_MODEL = os.getenv("GPT_MODEL", "gpt-5.4")
GPT_MINI_MODEL = os.getenv("GPT_MINI_MODEL", "gpt-4o-mini")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-1")
