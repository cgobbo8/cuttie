"""AI client configuration — multi-provider (OpenAI, Groq, Gemini).

All providers use OpenAI-compatible endpoints via the openai SDK,
so no additional dependencies are needed.
"""

import os

from openai import OpenAI

# ── Clients (lazy singletons) ──

_openai_client: OpenAI | None = None
_groq_client: OpenAI | None = None
_gemini_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    """OpenAI client — kept for backward compatibility."""
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI()
    return _openai_client


def get_groq_client() -> OpenAI:
    """Groq client — for Whisper transcription (9x cheaper than OpenAI)."""
    global _groq_client
    if _groq_client is None:
        _groq_client = OpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1",
        )
    return _groq_client


def get_gemini_client() -> OpenAI:
    """Gemini client — for vision + LLM analysis (8x cheaper than GPT)."""
    global _gemini_client
    if _gemini_client is None:
        _gemini_client = OpenAI(
            api_key=os.getenv("GEMINI_API_KEY"),
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        )
    return _gemini_client


# ── Model names (override via env vars) ──

# Whisper transcription via Groq
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3-turbo")

# Vision + narrative synthesis + triage scoring via OpenAI
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-5.4-mini")
