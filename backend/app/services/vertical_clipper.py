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
from app.services.subtitle_generator import (
    FONTS_DIR,
    extract_dominant_color,
    generate_ass,
    transcribe_with_words,
)

logger = logging.getLogger(__name__)

CLIPS_DIR = "clips"
OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
MAX_TRANSCRIBE_WORKERS = 5   # Whisper + LLM rewrite (API-bound)
MAX_RENDER_WORKERS = 3       # FFmpeg rendering (CPU-bound)

# Layout ratios
GAME_HEIGHT_RATIO = 0.70   # game footage = 70% of output height
GAME_MARGIN_BOTTOM = 60    # blurred band at bottom
CAM_SIZE = 560             # facecam size in output pixels (at 1080w)
CAM_MARGIN_TOP = 40        # facecam margin from top
CAM_BORDER_RADIUS = 20     # rounded corners on facecam
BLUR_SIGMA = 40            # background blur strength


def _build_filtergraph(
    facecam: dict,
    ass_path: str | None,
    input_w: int,
    input_h: int,
) -> str:
    """Build FFmpeg filtergraph for vertical reframing.

    Layout (1080x1920):
    ┌──────────────┐
    │  (blurred    │
    │   background)│
    │  ┌────────┐  │
    │  │ facecam │  │  floating, top center
    │  └────────┘  │
    │              │
    │ ┌──────────┐ │
    │ │          │ │
    │ │  game    │ │  ~60% height, centered bottom
    │ │  (sharp) │ │
    │ │          │ │
    │ └──────────┘ │
    └──────────────┘
    """
    ow, oh = OUTPUT_WIDTH, OUTPUT_HEIGHT
    game_h = int(oh * GAME_HEIGHT_RATIO)

    # Game crop: crop center of source to fit output width at game_h
    game_aspect = ow / game_h
    crop_h = input_h
    crop_w = int(crop_h * game_aspect)
    if crop_w > input_w:
        crop_w = input_w
        crop_h = int(crop_w / game_aspect)
    crop_x = (input_w - crop_w) // 2
    crop_y = (input_h - crop_h) // 2

    # Game position: centered, with margin at bottom for blurred band
    game_y = oh - game_h - GAME_MARGIN_BOTTOM

    # Facecam crop coords
    cx, cy, cw, ch = facecam["x"], facecam["y"], facecam["w"], facecam["h"]
    # Facecam position: top center
    cam_x = (ow - CAM_SIZE) // 2
    cam_y = CAM_MARGIN_TOP

    filters = [
        # Split input into 3 streams: background, game, facecam
        f"[0:v]split=3[bg_in][game_in][cam_in]",

        # Background: scale to fill 9:16 (crop center), heavy blur + darken
        f"[bg_in]scale={ow}:{oh}:force_original_aspect_ratio=increase,"
        f"crop={ow}:{oh},gblur=sigma={BLUR_SIGMA},eq=brightness=-0.1[bg]",

        # Game: crop center, scale to output width × game_h
        f"[game_in]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
        f"scale={ow}:{game_h}[game]",

        # Facecam: crop, scale, rounded corners via alpha mask
        f"[cam_in]crop={cw}:{ch}:{cx}:{cy},"
        f"scale={CAM_SIZE}:-1,"
        f"format=yuva420p,"
        f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
        f"a='if(gt(pow(max(0\\,{CAM_BORDER_RADIUS}-min(X\\,W-1-X))\\,2)"
        f"+pow(max(0\\,{CAM_BORDER_RADIUS}-min(Y\\,H-1-Y))\\,2)"
        f"\\,{CAM_BORDER_RADIUS}*{CAM_BORDER_RADIUS})\\,0\\,255)'"
        f"[cam]",

        # Overlay game on background
        f"[bg][game]overlay=0:{game_y}[with_game]",

        # Overlay facecam on top (centered horizontally)
        f"[with_game][cam]overlay={cam_x}:{cam_y}[composed]",
    ]

    if ass_path:
        escaped_path = ass_path.replace("\\", "/").replace(":", "\\:")
        fonts_dir = os.path.abspath(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
        filters.append(f"[composed]ass='{escaped_path}':fontsdir='{fonts_dir}'[out]")
    else:
        # Rename last output
        filters[-1] = filters[-1].replace("[composed]", "[out]")

    return ";".join(filters), "[out]"


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
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", "2M", "-maxrate", "3M", "-bufsize", "4M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        output_path,
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
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

    # Collect all valid clip paths
    all_clip_paths = []
    for hp in hot_points:
        if hp.clip_filename:
            path = os.path.join(clip_dir, hp.clip_filename)
            if os.path.isfile(path):
                all_clip_paths.append(path)

    if not all_clip_paths:
        logger.warning("No clips found for vertical generation")
        return

    # Detect facecam using multiple clips for robustness (overlay is static)
    logger.info("Detecting facecam position...")
    update_job(job_id, progress="Generation verticale : detection facecam...")
    facecam = detect_facecam(all_clip_paths[0], extra_clips=all_clip_paths[1:])

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
    logger.info(f"Generating {total} vertical clips (2 phases: transcribe then render)")

    # --- Phase 1: Transcribe + dominant color extraction (API-bound, 5 workers) ---
    update_job(job_id, progress=f"Generation verticale : transcription 0/{total}...")

    prepared: list[tuple[HotPoint, str, str, str, str | None]] = []

    def _transcribe_one(item: tuple) -> tuple:
        hp, clip_path, vertical_path, vertical_name = item
        dominant = extract_dominant_color(clip_path)
        _, _, words = transcribe_with_words(clip_path)
        ass_path = None
        if words:
            ass_path = vertical_path.replace(".mp4", ".ass")
            generate_ass(words, ass_path, OUTPUT_WIDTH, OUTPUT_HEIGHT, dominant)
            # Save word-level timestamps for the editor transcript panel
            import json
            words_path = vertical_path.replace(".mp4", "_words.json")
            with open(words_path, "w", encoding="utf-8") as f:
                json.dump(words, f, ensure_ascii=False)
        return hp, clip_path, vertical_path, vertical_name, ass_path

    with ThreadPoolExecutor(max_workers=MAX_TRANSCRIBE_WORKERS) as executor:
        futures = {executor.submit(_transcribe_one, item): item for item in to_process}
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                result = future.result()
                prepared.append(result)
                update_job(job_id, progress=f"Generation verticale : transcription {done}/{total}...")
            except Exception as e:
                logger.error(f"Transcription error: {e}")

    logger.info(f"Transcription done: {len(prepared)}/{total}")

    # --- Phase 2: FFmpeg rendering (CPU-bound, 3 workers) ---
    update_job(job_id, progress=f"Generation verticale : rendu 0/{total}...")

    def _render_one(item: tuple) -> tuple[HotPoint, str | None]:
        hp, clip_path, vertical_path, vertical_name, ass_path = item
        ok = generate_vertical_clip(clip_path, vertical_path, facecam, ass_path)
        if ass_path and os.path.isfile(ass_path):
            os.remove(ass_path)
        return hp, vertical_name if ok else None

    with ThreadPoolExecutor(max_workers=MAX_RENDER_WORKERS) as executor:
        futures = {executor.submit(_render_one, item): item for item in prepared}
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
                update_job(job_id, progress=f"Generation verticale : rendu {done}/{total}...")
            except Exception as e:
                logger.error(f"Vertical render error: {e}")

    success = sum(1 for hp in hot_points if getattr(hp, "vertical_filename", None))
    logger.info(f"Vertical generation complete: {success}/{total}")
