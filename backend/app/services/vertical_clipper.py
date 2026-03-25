"""Generate vertical (9:16) clips from raw horizontal clips.

Layout: game footage on top (cropped to center), facecam on bottom.
Subtitles burned in via ASS.

Single FFmpeg pass:
1. Crop game zone (center of frame, excluding facecam)
2. Crop facecam region
3. Scale both to fit 1080x1920 canvas
4. Overlay: game on top, facecam on bottom
5. Burn ASS subtitles
"""

import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.models.schemas import HotPoint
from app.services.db import update_job
from app.services.facecam_detector import detect_facecam
from app.services.subtitle_generator import generate_ass, transcribe_with_words

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
MAX_VERTICAL_WORKERS = 2

# Layout: game takes top portion, facecam takes bottom
# Ratio: ~65% game, ~35% facecam
GAME_RATIO = 0.65
FACECAM_RATIO = 0.35


def _build_filtergraph(
    facecam: dict,
    ass_path: str | None,
    input_w: int,
    input_h: int,
) -> str:
    """Build FFmpeg filtergraph for vertical reframing.

    Layout (1080x1920):
    ┌──────────────┐
    │              │
    │   Game crop  │  ~65% = 1248px
    │   (center)   │
    │              │
    ├──────────────┤
    │   Facecam    │  ~35% = 672px
    │   (scaled)   │
    └──────────────┘
    """
    game_h = int(OUTPUT_HEIGHT * GAME_RATIO)
    cam_h = OUTPUT_HEIGHT - game_h

    # Game crop: take center strip of the frame, excluding facecam area
    # Crop a 16:9-ish region from center, then scale to output width × game_h
    # Target aspect ratio for game section
    game_aspect = OUTPUT_WIDTH / game_h
    crop_h = input_h
    crop_w = int(crop_h * game_aspect)
    if crop_w > input_w:
        crop_w = input_w
        crop_h = int(crop_w / game_aspect)

    # Center the crop
    crop_x = (input_w - crop_w) // 2
    crop_y = (input_h - crop_h) // 2

    # Facecam crop coords
    cx, cy, cw, ch = facecam["x"], facecam["y"], facecam["w"], facecam["h"]

    filters = [
        # Split input into two streams
        f"[0:v]split=2[game_in][cam_in]",
        # Game: crop center, scale to top section
        f"[game_in]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={OUTPUT_WIDTH}:{game_h}[game]",
        # Facecam: crop, scale to bottom section (maintain aspect, pad if needed)
        f"[cam_in]crop={cw}:{ch}:{cx}:{cy},scale={OUTPUT_WIDTH}:{cam_h}:force_original_aspect_ratio=decrease,pad={OUTPUT_WIDTH}:{cam_h}:(ow-iw)/2:(oh-ih)/2:black[cam]",
        # Stack vertically
        f"[game][cam]vstack=inputs=2[stacked]",
    ]

    if ass_path:
        # Burn subtitles (escape path for FFmpeg)
        escaped_path = ass_path.replace("\\", "/").replace(":", "\\:")
        filters.append(f"[stacked]ass='{escaped_path}'[out]")
        output_label = "[out]"
    else:
        output_label = "[stacked]"
        # Rename for output mapping
        filters[-1] = filters[-1].replace("[stacked]", "[out]")
        output_label = "[out]"

    return ";".join(filters), output_label


def generate_vertical_clip(
    clip_path: str,
    output_path: str,
    facecam: dict,
    ass_path: str | None = None,
) -> bool:
    """Render a single vertical clip using FFmpeg.

    Returns True on success.
    """
    # Get input dimensions
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", clip_path],
        capture_output=True, text=True, timeout=10,
    )
    import json
    streams = json.loads(probe.stdout)["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    input_w = int(video["width"])
    input_h = int(video["height"])

    filtergraph, output_label = _build_filtergraph(facecam, ass_path, input_w, input_h)

    cmd = [
        "ffmpeg", "-y",
        "-i", clip_path,
        "-filter_complex", filtergraph,
        "-map", output_label,
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast",
        "-b:v", "2M", "-maxrate", "3M", "-bufsize", "4M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            logger.error(f"FFmpeg vertical render failed: {result.stderr[-500:]}")
            return False

        if os.path.isfile(output_path):
            size_mb = os.path.getsize(output_path) / (1024 * 1024)
            logger.info(f"Vertical clip: {output_path} ({size_mb:.1f}MB)")
            return True
        return False

    except subprocess.TimeoutExpired:
        logger.error(f"FFmpeg vertical render timed out: {output_path}")
        return False


def generate_vertical_clips(
    job_id: str,
    hot_points: list[HotPoint],
) -> None:
    """Generate vertical clips for all hot points that have raw clips.

    Detects facecam once from first clip, reuses for all.
    Transcribes each clip for subtitles.
    """
    clip_dir = os.path.join(CLIPS_DIR, job_id)

    # Find first valid clip to detect facecam
    first_clip = None
    for hp in hot_points:
        if hp.clip_filename:
            path = os.path.join(clip_dir, hp.clip_filename)
            if os.path.isfile(path):
                first_clip = path
                break

    if not first_clip:
        logger.warning("No clips found for vertical generation")
        return

    # Detect facecam once (static overlay)
    logger.info("Detecting facecam position...")
    update_job(job_id, progress="Generation verticale : detection facecam...")
    facecam = detect_facecam(first_clip)

    if not facecam:
        logger.warning("No facecam detected, using fallback (bottom-right 25%)")
        # Fallback: assume bottom-right corner, 25% of frame
        import json
        probe = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", first_clip],
            capture_output=True, text=True, timeout=10,
        )
        streams = json.loads(probe.stdout)["streams"]
        video = next(s for s in streams if s["codec_type"] == "video")
        fw, fh = int(video["width"]), int(video["height"])
        cam_size = min(fw, fh) // 2
        facecam = {"x": fw - cam_size, "y": fh - cam_size, "w": cam_size, "h": cam_size}

    # Process each clip
    to_process = []
    for hp in hot_points:
        if not hp.clip_filename:
            continue
        clip_path = os.path.join(clip_dir, hp.clip_filename)
        if not os.path.isfile(clip_path):
            continue
        vertical_name = hp.clip_filename.replace("clip_", "vertical_")
        vertical_path = os.path.join(clip_dir, vertical_name)
        to_process.append((hp, clip_path, vertical_path, vertical_name))

    total = len(to_process)
    logger.info(f"Generating {total} vertical clips...")

    def _process_one(item: tuple) -> tuple[HotPoint, str | None]:
        hp, clip_path, vertical_path, vertical_name = item

        # Transcribe for subtitles
        _, _, words = transcribe_with_words(clip_path)

        ass_path = None
        if words:
            ass_path = vertical_path.replace(".mp4", ".ass")
            generate_ass(words, ass_path, OUTPUT_WIDTH, OUTPUT_HEIGHT)

        ok = generate_vertical_clip(clip_path, vertical_path, facecam, ass_path)

        # Cleanup ASS file
        if ass_path and os.path.isfile(ass_path):
            os.remove(ass_path)

        return hp, vertical_name if ok else None

    with ThreadPoolExecutor(max_workers=MAX_VERTICAL_WORKERS) as executor:
        futures = {executor.submit(_process_one, item): item for item in to_process}

        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                hp, vertical_name = future.result()
                if vertical_name:
                    hp.vertical_filename = vertical_name
                    logger.info(f"Vertical {done}/{total}: {vertical_name}")
                else:
                    logger.warning(f"Vertical {done}/{total}: failed")
                update_job(
                    job_id,
                    progress=f"Generation verticale : {done}/{total} clips...",
                )
            except Exception as e:
                logger.error(f"Vertical clip generation error: {e}")

    success = sum(1 for hp in hot_points if getattr(hp, "vertical_filename", None))
    logger.info(f"Vertical generation complete: {success}/{total}")
