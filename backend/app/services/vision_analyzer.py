"""Vision analysis of clip frames using GPT-4o vision.

Sends extracted frames to GPT for scene description and key moment identification.
Produces a timestamped narrative of what happens in the clip.
"""

import base64
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.services.openai_client import get_openai_client, LLM_MODEL

logger = logging.getLogger(__name__)

# Max frames to send per vision API call (token budget)
MAX_FRAMES_PER_CALL = 12
# Max frames to analyze per clip (cost control)
MAX_FRAMES_PER_CLIP = 15


def _encode_frame(path: str) -> str | None:
    """Encode a frame as base64 data URL for the API."""
    try:
        with open(path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        return f"data:image/jpeg;base64,{data}"
    except OSError as e:
        logger.debug("Failed to encode frame %s: %s", path, e)
        return None


def analyze_clip_frames(
    frames: list[dict],
    transcript: str,
    vod_title: str,
    vod_game: str = "",
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
        return _analyze_in_batches(selected, transcript, vod_title, vod_game)

    return _analyze_batch(selected, transcript, vod_title, vod_game)


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
    vod_game: str = "",
) -> list[dict]:
    """Send a batch of frames to GPT-4o vision for analysis."""
    client = get_openai_client()

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

    game_ctx = f' (jeu: {vod_game})' if vod_game else ''

    hud_instruction = ""
    if vod_game:
        hud_instruction = f"""

**Analyse du HUD / interface de jeu :**
Porte une attention particulière aux éléments du HUD et de l'interface de {vod_game} visibles à l'écran :
- Barres de vie (streamer et ennemis) : vie basse = moment de tension
- Kill streaks, combos, compteurs de dégâts importants
- Nombre d'ennemis à l'écran, encerclement
- Notifications de victoire, défaite, achievement, loot rare
- Score, classement, timer critique
- Tout indicateur visuel de moment intense (écran rouge, effets spéciaux, etc.)
Ces éléments de HUD sont des signaux forts pour identifier les moments clippables."""

    prompt = f"""Analyse ce clip de stream Twitch "{vod_title}"{game_ctx}.

Chaque image est une capture du clip avec son timestamp exact en secondes. Les images sont espacées de ~2s.

**Transcription :**
{transcript if transcript else "(silence)"}
{hud_instruction}

Identifie 3-6 **moments clés** où il se passe quelque chose de visuellement distinct (changement de scène, action, réaction du streamer, événement in-game, changement notable dans le HUD).

IMPORTANT pour "time": utilise EXACTEMENT un des timestamps affichés sur les images. Ne pas inventer de timestamp intermédiaire.

Pour chaque moment:
- "time": float, un timestamp EXACT d'une des images fournies
- "label": titre court (5-8 mots), en français{", référençant le gameplay de " + vod_game if vod_game else ""}
- "description": 1 phrase, ce qui se passe visuellement (inclure les infos du HUD si pertinentes : vie basse, gros dégâts, kill, loot, etc.)

JSON object : {{"moments": [...]}}"""

    content_parts.insert(0, {"type": "text", "text": prompt})

    try:
        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": content_parts}],
            temperature=0.3,
            max_completion_tokens=1500,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content or ""
        finish = response.choices[0].finish_reason
        content = content.strip()
        logger.debug(f"Vision raw ({finish}, {len(content)} chars): {content[:200]}")

        parsed = json.loads(content)
        # json_object mode returns an object — extract the array
        if isinstance(parsed, dict):
            moments = parsed.get("moments") or next((v for v in parsed.values() if isinstance(v, list)), [])
        elif isinstance(parsed, list):
            moments = parsed
        else:
            moments = [parsed]

        # Validate, clean, and snap timestamps to nearest actual frame
        frame_times = [f["time"] for f in frames]
        clean_moments = []
        for m in moments:
            if isinstance(m, dict) and "time" in m and "label" in m:
                t = float(m["time"])
                # Snap to nearest actual frame timestamp
                if frame_times:
                    t = min(frame_times, key=lambda ft: abs(ft - t))
                clean_moments.append({
                    "time": t,
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
    vod_game: str = "",
) -> list[dict]:
    """Split frames into batches and merge results."""
    mid = len(frames) // 2
    batch1 = frames[:mid]
    batch2 = frames[mid:]

    all_moments = []
    for batch in [batch1, batch2]:
        moments = _analyze_batch(batch, transcript, vod_title, vod_game)
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
