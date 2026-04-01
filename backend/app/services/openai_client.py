"""AI client configuration — multi-provider (OpenRouter, Groq, OpenAI, Gemini).

All providers use OpenAI-compatible endpoints via the openai SDK,
so no additional dependencies are needed.
"""

import os

from openai import OpenAI

# ── Clients (lazy singletons) ──

_openai_client: OpenAI | None = None
_openrouter_client: OpenAI | None = None
_groq_client: OpenAI | None = None
_gemini_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    """OpenAI client — fallback, kept for backward compatibility."""
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI()
    return _openai_client


def get_openrouter_client() -> OpenAI:
    """OpenRouter client — for LLM analysis (Kimi K2.5, etc.)."""
    global _openrouter_client
    if _openrouter_client is None:
        _openrouter_client = OpenAI(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            base_url="https://openrouter.ai/api/v1",
        )
    return _openrouter_client


def get_groq_client() -> OpenAI:
    """Groq client — for Whisper transcription."""
    global _groq_client
    if _groq_client is None:
        _groq_client = OpenAI(
            api_key=os.getenv("GROQ_API_KEY"),
            base_url="https://api.groq.com/openai/v1",
        )
    return _groq_client


def get_gemini_client() -> OpenAI:
    """Gemini client — kept for backward compatibility."""
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

# Vision + narrative synthesis via OpenRouter (Mistral Small 4)
LLM_MODEL = os.getenv("LLM_MODEL", "mistralai/mistral-small-2603")
