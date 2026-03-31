"""
Lazy facecam detection helper — called by AdonisJS when no cached facecam.json exists.

Usage:
    uv run python detect_facecam_cli.py <facecam_json_path> <clip_url_1> [clip_url_2] ...

Accepts presigned S3 URLs or local file paths.
Outputs the facecam JSON object on stdout (or "null" if not detected).
"""
import json
import sys

from app.services.facecam_detector import detect_facecam

facecam_path = sys.argv[1]
clip_urls = sys.argv[2:]

if not clip_urls:
    print("null")
    sys.exit(0)

raw = detect_facecam(clip_urls[0], extra_clips=clip_urls[1:] or None)

result = None
if raw:
    result = {k: int(v) for k, v in raw.items()}
    with open(facecam_path, "w", encoding="utf-8") as f:
        json.dump(result, f)

print(json.dumps(result))
