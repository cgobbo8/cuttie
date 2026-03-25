"""Vision analysis of clip frames using GPT-4o vision.

Sends extracted frames to GPT for scene description and key moment identification.
Produces a timestamped narrative of what happens in the clip.
"""

import base64
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from openai import OpenAI

logger = logging.getLogger(__name__)

# Max frames to send per vision API call (token budget)
MAX_FRAMES_PER_CALL = 12
# Max frames to analyze per clip (cost control)
MAX_FRAMES_PER_CLIP = 15


def _get_client() -> OpenAI:
    return OpenAI()


def _encode_frame(path: str) -> str | None:
    """Encode a frame as base64 data URL for the API."""
    try:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        return f"data:image/jpeg;base64,{data}"
    except OSError:
        return None


def analyze_clip_frames(
    frames: list[dict],
    transcript: str,
    vod_title: str,
) -> list[dict]:
    """Analyze frames from a single clip with GPT-4o vision.

    Args:
        frames: List of {"time": float, "path": str} dicts.
        transcript: Whisper transcript for context.
        vod_title: VOD title for context.

    Returns:
        List of key moments: [{"time": float, "label": str, "description": str}, ...]
    """
    if not frames:
        return []

    # Subsample frames if too many
    selected = _subsample_frames(frames, MAX_FRAMES_PER_CLIP)

    # If we have more than MAX_FRAMES_PER_CALL, split into batches
    if len(selected) > MAX_FRAMES_PER_CALL:
        return _analyze_in_batches(selected, transcript, vod_title)

    return _analyze_batch(selected, transcript, vod_title)


def _subsample_frames(frames: list[dict], max_count: int) -> list[dict]:
    """Evenly subsample frames if there are too many."""
    if len(frames) <= max_count:
        return frames
    step = len(frames) / max_count
    indices = [int(i * step) for i in range(max_count)]
    # Always include first and last
    if indices[-1] != len(frames) - 1:
        indices[-1] = len(frames) - 1
    return [frames[i] for i in indices]


def _analyze_batch(
    frames: list[dict],
    transcript: str,
    vod_title: str,
) -> list[dict]:
    """Send a batch of frames to GPT-4o vision for analysis."""
    client = _get_client()

    # Build the image content parts
    content_parts = []
    frame_descriptions = []

    for frame in frames:
        data_url = _encode_frame(frame["path"])
        if not data_url:
            continue

        frame_descriptions.append(f"- Image à {frame['time']:.1f}s")
        content_parts.append({
            "type": "text",
            "text": f"[{frame['time']:.1f}s]",
        })
        content_parts.append({
            "type": "image_url",
            "image_url": {"url": data_url, "detail": "low"},
        })

    if not content_parts:
        return []

    prompt = f"""Tu analyses un clip de stream Twitch "{vod_title}".

Les images sont des captures du clip, chacune labelisée avec son timestamp (en secondes dans le clip).

**Transcription du clip :**
{transcript if transcript else "(pas de parole)"}

En combinant ce que tu VOIS dans les images et ce que tu LIS dans la transcription, identifie les **moments clés** du clip.

Pour chaque moment clé, indique :
- "time": le timestamp en secondes (un des timestamps des images fournies)
- "label": un titre court (5-8 mots max) décrivant l'action
- "description": ce qui se passe visuellement ET contextuellement (1-2 phrases)

Retourne un JSON array. Identifie entre 3 et 6 moments clés. Privilégie les changements visuels importants, les moments d'émotion, les actions marquantes.

Retourne UNIQUEMENT le JSON array, sans markdown ni explication."""

    content_parts.insert(0, {"type": "text", "text": prompt})

    try:
        response = client.chat.completions.create(
            model="gpt-5.4",
            messages=[{"role": "user", "content": content_parts}],
            temperature=0.3,
            max_completion_tokens=800,
        )

        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        moments = json.loads(content)
        if not isinstance(moments, list):
            moments = [moments]

        # Validate and clean
        clean_moments = []
        for m in moments:
            if isinstance(m, dict) and "time" in m and "label" in m:
                clean_moments.append({
                    "time": float(m["time"]),
                    "label": str(m["label"]),
                    "description": str(m.get("description", "")),
                })

        logger.info(f"Vision analysis found {len(clean_moments)} key moments")
        return clean_moments

    except Exception as e:
        logger.error(f"Vision analysis failed: {e}")
        return []


def _analyze_in_batches(
    frames: list[dict],
    transcript: str,
    vod_title: str,
) -> list[dict]:
    """Split frames into batches and merge results."""
    mid = len(frames) // 2
    batch1 = frames[:mid]
    batch2 = frames[mid:]

    all_moments = []
    for batch in [batch1, batch2]:
        moments = _analyze_batch(batch, transcript, vod_title)
        all_moments.extend(moments)

    # Deduplicate moments that are too close in time
    all_moments.sort(key=lambda m: m["time"])
    deduped: list[dict] = []
    for m in all_moments:
        if not deduped or abs(m["time"] - deduped[-1]["time"]) >= 2.0:
            deduped.append(m)

    return deduped


def analyze_clips_parallel(
    clips_data: list[dict],
    max_workers: int = 3,
) -> dict[int, list[dict]]:
    """Analyze multiple clips' frames in parallel.

    Args:
        clips_data: List of {"clip_index": int, "frames": [...], "transcript": str, "vod_title": str}
        max_workers: Number of parallel API calls.

    Returns:
        Dict mapping clip_index -> list of key moments.
    """
    results: dict[int, list[dict]] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for cd in clips_data:
            future = executor.submit(
                analyze_clip_frames,
                cd["frames"],
                cd["transcript"],
                cd["vod_title"],
            )
            futures[future] = cd["clip_index"]

        for future in as_completed(futures):
            clip_idx = futures[future]
            try:
                moments = future.result()
                results[clip_idx] = moments
            except Exception as e:
                logger.error(f"Vision analysis failed for clip {clip_idx}: {e}")
                results[clip_idx] = []

    return results
