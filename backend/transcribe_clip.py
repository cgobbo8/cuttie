"""
Lazy transcription helper — called by AdonisJS when no cached words exist.

Usage:
    uv run python transcribe_clip.py <clip_path> <words_path>

Outputs the words JSON array on stdout.
"""
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from app.services.subtitle_generator import transcribe_with_words

clip_path = sys.argv[1]
words_path = sys.argv[2]

_, _, words = transcribe_with_words(clip_path)

if words:
    with open(words_path, "w", encoding="utf-8") as f:
        json.dump(words, f, ensure_ascii=False)

print(json.dumps(words, ensure_ascii=False))
