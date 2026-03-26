"""Render a video from the canvas editor layer configuration.

Composes frames with OpenCV/numpy, pipes to FFmpeg for encoding.
Uses h264_videotoolbox (macOS GPU) with libx264 fallback.
"""

import json
import logging
import os
import subprocess
import tempfile
from typing import Callable

import cv2
import numpy as np

logger = logging.getLogger(__name__)

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
TARGET_FPS = 30

FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts")
CLIPS_DIR = "clips"


# ── Helpers ──────────────────────────────────────────────────

def _probe_video(path: str) -> tuple[int, int, float, float]:
    """Return (width, height, duration, fps) of a video file."""
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path],
        capture_output=True, text=True, timeout=10,
    )
    data = json.loads(probe.stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    w = int(video["width"])
    h = int(video["height"])
    dur = float(data.get("format", {}).get("duration", video.get("duration", "0")))
    # Parse fps from r_frame_rate (e.g. "30/1" or "30000/1001")
    fps_str = video.get("r_frame_rate", "30/1")
    num, den = fps_str.split("/")
    fps = float(num) / float(den) if float(den) != 0 else 30.0
    return w, h, dur, fps


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) < 6:
        hex_color = hex_color.ljust(6, "0")
    return int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)


def _rgb_to_ass_color(r: int, g: int, b: int) -> str:
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def _tint_white(dr: int, dg: int, db: int, strength: float = 0.15) -> tuple[int, int, int]:
    return (
        int(255 * (1 - strength) + dr * strength),
        int(255 * (1 - strength) + dg * strength),
        int(255 * (1 - strength) + db * strength),
    )


def _format_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _chunk_words(words: list[dict], max_words: int = 4, max_duration: float = 3.0) -> list[list[dict]]:
    chunks: list[list[dict]] = []
    current: list[dict] = []
    for w in words:
        if current and (
            len(current) >= max_words
            or (w["start"] - current[0]["start"]) > max_duration
        ):
            chunks.append(current)
            current = []
        current.append(w)
    if current:
        chunks.append(current)
    return chunks


def _generate_ass_from_layer(subtitle_data: dict, transform: dict, output_path: str) -> str:
    words = subtitle_data.get("words", [])
    if not words:
        return ""

    font_family = subtitle_data.get("fontFamily", "Luckiest Guy")
    font_size = subtitle_data.get("fontSize", 75)
    uppercase = subtitle_data.get("uppercase", True)
    color_mode = subtitle_data.get("colorMode", "auto")
    custom_color = subtitle_data.get("customColor", "#6464C8")
    auto_color = subtitle_data.get("autoColor", "#6464C8")

    active_hex = auto_color if color_mode == "auto" else custom_color
    dr, dg, db = _hex_to_rgb(active_hex)

    tr, tg, tb = _tint_white(dr, dg, db, 0.15)
    highlight_color = _rgb_to_ass_color(tr, tg, tb)
    base_color = _rgb_to_ass_color(dr, dg, db)
    outline_color = "&H00000000&"
    back_color = "&H80000000&"

    margin_l = transform.get("x", 40)
    margin_r = OUTPUT_WIDTH - margin_l - transform.get("width", 1000)
    margin_r = max(0, margin_r)
    margin_v = transform.get("y", 1650)

    header = f"""[Script Info]
Title: Cuttie Editor Export
ScriptType: v4.00+
PlayResX: {OUTPUT_WIDTH}
PlayResY: {OUTPUT_HEIGHT}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_family},{font_size},{highlight_color},{base_color},{outline_color},{back_color},-1,0,0,0,100,100,0,0,1,4,2,8,{margin_l},{margin_r},{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    events = []
    chunks = _chunk_words(words)
    for chunk in chunks:
        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]
        start_ts = _format_ass_time(chunk_start)
        end_ts = _format_ass_time(chunk_end)
        parts = []
        for w in chunk:
            word_dur_cs = max(0, int((w["end"] - w["start"]) * 100))
            text = w["word"].upper() if uppercase else w["word"]
            parts.append(f"{{\\kf{word_dur_cs}}}{text}")
        events.append(f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{' '.join(parts)}")

    content = header + "\n".join(events) + "\n"
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    return output_path


# ── Alpha compositing with numpy ────────────────────────────

def _make_rounded_mask(w: int, h: int, radius: int) -> np.ndarray:
    """Pre-compute a rounded-rectangle alpha mask (uint8, 0-255)."""
    mask = np.full((h, w), 255, dtype=np.uint8)
    if radius <= 0:
        return mask
    r = min(radius, w // 2, h // 2)
    # Draw filled rounded rect: start with full, cut corners, add circles
    mask[:r, :r] = 0
    mask[:r, w - r:] = 0
    mask[h - r:, :r] = 0
    mask[h - r:, w - r:] = 0
    cv2.circle(mask, (r, r), r, 255, -1, lineType=cv2.LINE_AA)
    cv2.circle(mask, (w - r - 1, r), r, 255, -1, lineType=cv2.LINE_AA)
    cv2.circle(mask, (r, h - r - 1), r, 255, -1, lineType=cv2.LINE_AA)
    cv2.circle(mask, (w - r - 1, h - r - 1), r, 255, -1, lineType=cv2.LINE_AA)
    return mask


def _make_circle_mask(w: int, h: int) -> np.ndarray:
    """Pre-compute an elliptical alpha mask."""
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.ellipse(mask, (w // 2, h // 2), (w // 2, h // 2), 0, 0, 360, 255, -1, lineType=cv2.LINE_AA)
    return mask


def _composite(canvas: np.ndarray, layer: np.ndarray, x: int, y: int, alpha_mask: np.ndarray | None = None, opacity: float = 1.0):
    """Alpha-composite `layer` (BGR or BGRA) onto `canvas` (BGR) at (x, y).

    Handles clipping to canvas bounds. Modifies canvas in-place.
    """
    lh, lw = layer.shape[:2]
    ch, cw = canvas.shape[:2]

    # Source region (within the layer)
    sx = max(0, -x)
    sy = max(0, -y)
    # Destination region (on canvas)
    dx = max(0, x)
    dy = max(0, y)
    # Effective size
    ew = min(lw - sx, cw - dx)
    eh = min(lh - sy, ch - dy)

    if ew <= 0 or eh <= 0:
        return

    src = layer[sy:sy + eh, sx:sx + ew]
    dst = canvas[dy:dy + eh, dx:dx + ew]

    # Build alpha channel (float32 0-1)
    if layer.shape[2] == 4:
        a = src[:, :, 3].astype(np.float32) / 255.0
        src_bgr = src[:, :, :3]
    else:
        a = np.ones((eh, ew), dtype=np.float32)
        src_bgr = src

    if alpha_mask is not None:
        mask_crop = alpha_mask[sy:sy + eh, sx:sx + ew].astype(np.float32) / 255.0
        a = a * mask_crop

    if opacity < 1.0:
        a = a * opacity

    # Blend: dst = src * a + dst * (1 - a)
    a3 = a[:, :, np.newaxis]
    blended = (src_bgr.astype(np.float32) * a3 + dst.astype(np.float32) * (1.0 - a3))
    canvas[dy:dy + eh, dx:dx + ew] = blended.astype(np.uint8)


# ── Layer preparation (pre-compute static data) ─────────────

class _PreparedLayer:
    """Pre-computed data for a layer to avoid per-frame recomputation."""
    __slots__ = (
        "ltype", "x", "y", "w", "h", "opacity", "blur_ksize",
        "border_radius", "alpha_mask", "static_image",
        "video_crop", "box_shadow",
    )

    def __init__(self):
        self.ltype: str = ""
        self.x: int = 0
        self.y: int = 0
        self.w: int = 0
        self.h: int = 0
        self.opacity: float = 1.0
        self.blur_ksize: int = 0
        self.border_radius: int = 0
        self.alpha_mask: np.ndarray | None = None
        self.static_image: np.ndarray | None = None
        self.video_crop: tuple[int, int, int, int] | None = None  # (x, y, w, h)
        self.box_shadow: str = "none"


def _prepare_layers(
    layers: list[dict],
    asset_dir: str | None,
) -> list[_PreparedLayer]:
    """Pre-compute masks, static images, and transforms for each layer."""
    result = []
    for layer in layers:
        if not layer.get("visible", True):
            continue

        ltype = layer["type"]
        if ltype == "subtitles":
            continue

        transform = layer.get("transform", {})
        style = layer.get("style", {})

        pl = _PreparedLayer()
        pl.ltype = ltype
        pl.x = int(transform.get("x", 0))
        pl.y = int(transform.get("y", 0))
        pl.w = max(2, int(transform.get("width", 100)))
        pl.h = max(2, int(transform.get("height", 100)))
        pl.opacity = float(style.get("opacity", 1.0))
        pl.border_radius = int(style.get("borderRadius", 0))

        # Convert blur to OpenCV kernel size (must be odd)
        blur_val = int(style.get("blur", 0))
        if blur_val > 0:
            k = blur_val * 2 + 1
            pl.blur_ksize = min(k, 301)  # cap for performance

        # Pre-compute alpha masks
        if ltype == "shape":
            shape_data = layer.get("shape", {})
            if shape_data.get("shapeType") == "circle":
                pl.alpha_mask = _make_circle_mask(pl.w, pl.h)
            elif pl.border_radius > 0:
                pl.alpha_mask = _make_rounded_mask(pl.w, pl.h, pl.border_radius)

            # Pre-render static shape image (BGRA)
            r, g, b = _hex_to_rgb(shape_data.get("backgroundColor", "#a855f7"))
            bg_alpha = int(float(shape_data.get("backgroundAlpha", 0.3)) * 255)
            img = np.zeros((pl.h, pl.w, 4), dtype=np.uint8)
            img[:, :] = (b, g, r, bg_alpha)
            pl.static_image = img
            pl.box_shadow = shape_data.get("boxShadowPreset", "none")

        elif ltype == "asset":
            src = layer.get("asset", {}).get("src", "")
            if src.startswith("http") or src.startswith("/api/assets/"):
                filename = src.split("/")[-1]
                local_path = os.path.join(asset_dir or os.path.join(CLIPS_DIR, "_assets"), filename)
            else:
                local_path = src

            if os.path.isfile(local_path):
                img = cv2.imread(local_path, cv2.IMREAD_UNCHANGED)
                if img is not None:
                    if img.shape[2] == 3:
                        img = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
                    pl.static_image = cv2.resize(img, (pl.w, pl.h), interpolation=cv2.INTER_AREA)

            if pl.border_radius > 0:
                pl.alpha_mask = _make_rounded_mask(pl.w, pl.h, pl.border_radius)

        elif ltype in ("gameplay", "facecam"):
            if pl.border_radius > 0:
                pl.alpha_mask = _make_rounded_mask(pl.w, pl.h, pl.border_radius)
            if ltype == "facecam":
                crop = layer.get("video", {}).get("crop")
                if crop:
                    pl.video_crop = (int(crop["x"]), int(crop["y"]), int(crop["w"]), int(crop["h"]))

        result.append(pl)
    return result


# ── Main render function ────────────────────────────────────

def render_from_layers(
    clip_path: str,
    layers: list[dict],
    output_path: str,
    asset_dir: str | None = None,
    progress_cb: Callable[[int, float, float], None] | None = None,
) -> bool:
    """Compose frames with OpenCV, encode with FFmpeg (GPU when available)."""

    input_w, input_h, duration, source_fps = _probe_video(clip_path)
    total_frames = int(duration * TARGET_FPS)
    if total_frames <= 0:
        logger.error("Video has no frames")
        return False

    # Frame step: how many source frames to skip per output frame
    frame_step = source_fps / TARGET_FPS

    # Prepare layers (pre-compute masks, static images)
    prepared = _prepare_layers(layers, asset_dir)

    # Find subtitle layer for ASS generation
    subtitle_layer = None
    for layer in layers:
        if layer.get("type") == "subtitles" and layer.get("visible", True):
            subtitle_layer = layer
            break

    logger.info(f"Subtitle layer found: {subtitle_layer is not None}")
    if subtitle_layer:
        sub_data = subtitle_layer.get("subtitle", {})
        words = sub_data.get("words", [])
        logger.info(f"Subtitle words count: {len(words)}")
        if words:
            logger.info(f"First word: {words[0]}, Last word: {words[-1]}")

    # Generate ASS file if needed
    ass_path = None
    if subtitle_layer and subtitle_layer.get("subtitle", {}).get("words"):
        ass_fd, ass_path = tempfile.mkstemp(suffix=".ass")
        os.close(ass_fd)
        _generate_ass_from_layer(
            subtitle_layer["subtitle"],
            subtitle_layer.get("transform", {}),
            ass_path,
        )
        # Debug: log ASS content
        with open(ass_path, "r", encoding="utf-8") as f:
            ass_content = f.read()
        logger.info(f"ASS file generated at {ass_path}, size={len(ass_content)} bytes")
        logger.info(f"ASS first 500 chars:\n{ass_content[:500]}")

    # Open source video
    cap = cv2.VideoCapture(clip_path)
    if not cap.isOpened():
        logger.error(f"Cannot open video: {clip_path}")
        return False

    # Build FFmpeg encode command
    # Python pipes raw BGR frames -> FFmpeg applies ASS subtitles (if any) + encodes
    vf_filters = []
    # setpts assigns proper timestamps to raw frames so ASS filter works
    vf_filters.append(f"setpts=N/{TARGET_FPS}/TB")
    if ass_path:
        escaped = ass_path.replace("\\", "/").replace(":", "\\:")
        fonts_dir = os.path.abspath(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
        vf_filters.append(f"ass='{escaped}':fontsdir='{fonts_dir}'")

    vf_arg = ",".join(vf_filters)

    # Try GPU encoder first, fallback to CPU
    encoder = "h264_videotoolbox"
    encode_args = ["-b:v", "4M"]

    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}",
        "-r", str(TARGET_FPS),
        "-i", "pipe:0",
        "-i", clip_path,  # for audio
        "-map", "0:v",
        "-map", "1:a?",
        "-vf", vf_arg,
    ]
    cmd.extend([
        "-c:v", encoder, *encode_args,
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        output_path,
    ])

    logger.info(f"Render: {total_frames} frames @ {TARGET_FPS}fps, encoder={encoder}")
    logger.info(f"FFmpeg cmd: {' '.join(cmd)}")
    logger.info(f"ASS path: {ass_path}")

    # stderr to temp file to avoid pipe deadlock (we read it only on failure)
    stderr_fd, stderr_path = tempfile.mkstemp(suffix=".log")
    stderr_file = os.fdopen(stderr_fd, "w")

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=stderr_file,
    )

    try:
        source_frame_idx = 0.0
        last_read_idx = -1
        current_source_frame: np.ndarray | None = None

        for frame_num in range(total_frames):
            # Seek to the right source frame
            target_idx = int(source_frame_idx)
            while last_read_idx < target_idx:
                ret, raw = cap.read()
                if not ret:
                    break
                current_source_frame = raw
                last_read_idx += 1

            if current_source_frame is None:
                break

            # Create canvas (black BGR)
            canvas = np.zeros((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), dtype=np.uint8)

            # Compose each layer
            for pl in prepared:
                if pl.ltype in ("gameplay", "facecam"):
                    frame = current_source_frame
                    if pl.video_crop:
                        cx, cy, cw, ch = pl.video_crop
                        cx = max(0, min(cx, input_w - 1))
                        cy = max(0, min(cy, input_h - 1))
                        cw = max(1, min(cw, input_w - cx))
                        ch = max(1, min(ch, input_h - cy))
                        frame = frame[cy:cy + ch, cx:cx + cw]

                    # Scale to layer size
                    scaled = cv2.resize(frame, (pl.w, pl.h), interpolation=cv2.INTER_AREA)

                    # Blur
                    if pl.blur_ksize > 0:
                        scaled = cv2.GaussianBlur(scaled, (pl.blur_ksize, pl.blur_ksize), 0)

                    _composite(canvas, scaled, pl.x, pl.y, pl.alpha_mask, pl.opacity)

                elif pl.ltype == "shape" and pl.static_image is not None:
                    _composite(canvas, pl.static_image, pl.x, pl.y, pl.alpha_mask, pl.opacity)

                elif pl.ltype == "asset" and pl.static_image is not None:
                    _composite(canvas, pl.static_image, pl.x, pl.y, pl.alpha_mask, pl.opacity)

            # Write frame to FFmpeg
            proc.stdin.write(canvas.tobytes())

            source_frame_idx += frame_step

            # Progress callback
            if frame_num % TARGET_FPS == 0:  # every second
                pct = min(99, int(frame_num / total_frames * 100))
                current_time = frame_num / TARGET_FPS
                if progress_cb:
                    progress_cb(pct, current_time, duration)
                logger.info(f"Render: {pct}% ({current_time:.1f}s / {duration:.1f}s)")

        # Done writing frames
        proc.stdin.close()
        proc.wait(timeout=120)

        if proc.returncode != 0:
            stderr_file.close()
            stderr = ""
            try:
                with open(stderr_path, "r") as f:
                    stderr = f.read()
            except Exception:
                pass
            # If GPU encoder failed, retry with CPU
            if encoder == "h264_videotoolbox" and ("videotoolbox" in stderr.lower() or "encoder" in stderr.lower()):
                logger.warning("VideoToolbox failed, retrying with libx264")
                cap.release()
                return _render_cpu_fallback(clip_path, layers, output_path, asset_dir, progress_cb)
            logger.error(f"Render failed (rc={proc.returncode}):\n{stderr[-1500:]}")
            return False

        # Log stderr even on success to catch subtitle warnings
        try:
            stderr_file.close()
            with open(stderr_path, "r") as f:
                stderr_out = f.read()
            if stderr_out:
                logger.info(f"FFmpeg stderr (last 1000):\n{stderr_out[-1000:]}")
        except Exception:
            pass

        if progress_cb:
            progress_cb(100, duration, duration)

        if os.path.isfile(output_path):
            size_mb = os.path.getsize(output_path) / (1024 * 1024)
            logger.info(f"Rendered: {output_path} ({size_mb:.1f}MB)")
            return True
        return False

    except Exception as e:
        logger.error(f"Render error: {e}")
        try:
            proc.kill()
        except Exception:
            pass
        return False

    finally:
        cap.release()
        try:
            stderr_file.close()
        except Exception:
            pass
        try:
            os.unlink(stderr_path)
        except Exception:
            pass
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        if ass_path and os.path.isfile(ass_path):
            os.unlink(ass_path)


def _render_cpu_fallback(
    clip_path: str,
    layers: list[dict],
    output_path: str,
    asset_dir: str | None = None,
    progress_cb: Callable[[int, float, float], None] | None = None,
) -> bool:
    """Fallback: same pipeline but with libx264 CPU encoder."""
    logger.info("Using libx264 CPU fallback encoder")

    input_w, input_h, duration, source_fps = _probe_video(clip_path)
    total_frames = int(duration * TARGET_FPS)
    if total_frames <= 0:
        return False

    frame_step = source_fps / TARGET_FPS
    prepared = _prepare_layers(layers, asset_dir)

    subtitle_layer = None
    for layer in layers:
        if layer.get("type") == "subtitles" and layer.get("visible", True):
            subtitle_layer = layer
            break

    ass_path = None
    if subtitle_layer and subtitle_layer.get("subtitle", {}).get("words"):
        ass_fd, ass_path = tempfile.mkstemp(suffix=".ass")
        os.close(ass_fd)
        _generate_ass_from_layer(
            subtitle_layer["subtitle"],
            subtitle_layer.get("transform", {}),
            ass_path,
        )

    cap = cv2.VideoCapture(clip_path)
    if not cap.isOpened():
        return False

    vf_filters = []
    # setpts assigns proper timestamps to raw frames so ASS filter works
    vf_filters.append(f"setpts=N/{TARGET_FPS}/TB")
    if ass_path:
        escaped = ass_path.replace("\\", "/").replace(":", "\\:")
        fonts_dir = os.path.abspath(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
        vf_filters.append(f"ass='{escaped}':fontsdir='{fonts_dir}'")

    vf_arg = ",".join(vf_filters)

    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-pix_fmt", "bgr24",
        "-s", f"{OUTPUT_WIDTH}x{OUTPUT_HEIGHT}",
        "-r", str(TARGET_FPS),
        "-i", "pipe:0",
        "-i", clip_path,
        "-map", "0:v", "-map", "1:a?",
        "-vf", vf_arg,
    ]
    cmd.extend([
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        output_path,
    ])

    stderr_fd2, stderr_path2 = tempfile.mkstemp(suffix=".log")
    stderr_file2 = os.fdopen(stderr_fd2, "w")

    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=stderr_file2)

    try:
        source_frame_idx = 0.0
        last_read_idx = -1
        current_source_frame = None

        for frame_num in range(total_frames):
            target_idx = int(source_frame_idx)
            while last_read_idx < target_idx:
                ret, raw = cap.read()
                if not ret:
                    break
                current_source_frame = raw
                last_read_idx += 1

            if current_source_frame is None:
                break

            canvas = np.zeros((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), dtype=np.uint8)

            for pl in prepared:
                if pl.ltype in ("gameplay", "facecam"):
                    frame = current_source_frame
                    if pl.video_crop:
                        cx, cy, cw, ch = pl.video_crop
                        cx = max(0, min(cx, input_w - 1))
                        cy = max(0, min(cy, input_h - 1))
                        cw = max(1, min(cw, input_w - cx))
                        ch = max(1, min(ch, input_h - cy))
                        frame = frame[cy:cy + ch, cx:cx + cw]

                    scaled = cv2.resize(frame, (pl.w, pl.h), interpolation=cv2.INTER_AREA)

                    if pl.blur_ksize > 0:
                        scaled = cv2.GaussianBlur(scaled, (pl.blur_ksize, pl.blur_ksize), 0)

                    _composite(canvas, scaled, pl.x, pl.y, pl.alpha_mask, pl.opacity)

                elif pl.ltype == "shape" and pl.static_image is not None:
                    _composite(canvas, pl.static_image, pl.x, pl.y, pl.alpha_mask, pl.opacity)

                elif pl.ltype == "asset" and pl.static_image is not None:
                    _composite(canvas, pl.static_image, pl.x, pl.y, pl.alpha_mask, pl.opacity)

            proc.stdin.write(canvas.tobytes())
            source_frame_idx += frame_step

            if frame_num % TARGET_FPS == 0:
                pct = min(99, int(frame_num / total_frames * 100))
                if progress_cb:
                    progress_cb(pct, frame_num / TARGET_FPS, duration)

        proc.stdin.close()
        proc.wait(timeout=300)

        if proc.returncode != 0:
            stderr_file2.close()
            stderr = ""
            try:
                with open(stderr_path2, "r") as f:
                    stderr = f.read()
            except Exception:
                pass
            logger.error(f"CPU render failed:\n{stderr[-1500:]}")
            return False

        if progress_cb:
            progress_cb(100, duration, duration)

        if os.path.isfile(output_path):
            size_mb = os.path.getsize(output_path) / (1024 * 1024)
            logger.info(f"Rendered (CPU): {output_path} ({size_mb:.1f}MB)")
            return True
        return False

    except Exception as e:
        logger.error(f"CPU render error: {e}")
        try:
            proc.kill()
        except Exception:
            pass
        return False

    finally:
        cap.release()
        try:
            stderr_file2.close()
        except Exception:
            pass
        try:
            os.unlink(stderr_path2)
        except Exception:
            pass
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
        if ass_path and os.path.isfile(ass_path):
            os.unlink(ass_path)
