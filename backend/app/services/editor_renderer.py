"""Render a video from the canvas editor layer configuration.

Builds an FFmpeg filtergraph from the layer stack and renders 1080x1920 output.
"""

import json
import logging
import os
import subprocess
import tempfile

logger = logging.getLogger(__name__)

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920

FONTS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "fonts")
CLIPS_DIR = "clips"


def _probe_video(path: str) -> tuple[int, int, float]:
    """Return (width, height, duration) of a video file."""
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path],
        capture_output=True, text=True, timeout=10,
    )
    data = json.loads(probe.stdout)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    w = int(video["width"])
    h = int(video["height"])
    dur = float(data.get("format", {}).get("duration", video.get("duration", "0")))
    return w, h, dur


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)


def _rgb_to_ass_color(r: int, g: int, b: int) -> str:
    """Convert RGB to ASS color (&HBBGGRR&)."""
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
    """Split words into display chunks (same logic as subtitle_generator)."""
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


def _generate_ass_from_layer(
    subtitle_data: dict,
    transform: dict,
    output_path: str,
) -> str:
    """Generate ASS subtitle file from editor layer data."""
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

    # Position: use transform.y to compute MarginV from bottom
    # ASS Alignment 2 = bottom center by default
    # We position top-aligned: Alignment 8 = top center
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
Style: Default,{font_family},{font_size},{highlight_color},{base_color},{outline_color},{back_color},-1,0,0,0,100,100,0,0,1,4,2,7,{margin_l},{margin_r},{margin_v},1

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


def _build_rounded_corner_filter(
    input_label: str,
    output_label: str,
    radius: int,
) -> str:
    """FFmpeg geq filter for rounded corners with alpha mask."""
    return (
        f"{input_label}format=yuva420p,"
        f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
        f"a='if(gt(pow(max(0\\,{radius}-min(X\\,W-1-X))\\,2)"
        f"+pow(max(0\\,{radius}-min(Y\\,H-1-Y))\\,2)"
        f"\\,{radius}*{radius})\\,0\\,255)'"
        f"{output_label}"
    )


def render_from_layers(
    clip_path: str,
    layers: list[dict],
    output_path: str,
    asset_dir: str | None = None,
) -> bool:
    """Build and execute FFmpeg command from editor layer configuration.

    Args:
        clip_path: Path to the source horizontal clip.
        layers: List of layer dicts from the editor.
        output_path: Where to write the rendered video.
        asset_dir: Directory for asset images (clips/_assets).

    Returns True on success.
    """
    input_w, input_h, duration = _probe_video(clip_path)

    # Collect inputs: [0] is always the source clip
    inputs = ["-i", clip_path]
    input_idx = 1  # next available input index

    # Map asset layers to input indices
    asset_input_map: dict[int, int] = {}  # layer_index -> ffmpeg_input_index

    visible_layers = [l for l in layers if l.get("visible", True)]

    for i, layer in enumerate(visible_layers):
        if layer["type"] == "asset" and layer.get("asset", {}).get("src"):
            src = layer["asset"]["src"]
            # Resolve asset path: if it's a relative URL like /api/assets/xxx, find the file
            if src.startswith("http") or src.startswith("/api/assets/"):
                filename = src.split("/")[-1]
                local_path = os.path.join(asset_dir or os.path.join(CLIPS_DIR, "_assets"), filename)
            else:
                local_path = src

            if os.path.isfile(local_path):
                inputs.extend(["-i", local_path])
                asset_input_map[i] = input_idx
                input_idx += 1

    # Build filtergraph
    filters = []
    # Start with a black canvas
    filters.append(
        f"color=black:s={OUTPUT_WIDTH}x{OUTPUT_HEIGHT}:d={duration:.3f},"
        f"format=yuva420p[canvas]"
    )

    canvas_label = "[canvas]"
    step = 0

    # Track if we need to split the source video
    video_layer_count = sum(1 for l in visible_layers if l["type"] in ("gameplay", "facecam"))
    if video_layer_count > 1:
        split_labels = "".join(f"[src_{j}]" for j in range(video_layer_count))
        filters.append(f"[0:v]split={video_layer_count}{split_labels}")
    src_idx = 0
    use_split = video_layer_count > 1

    # Process each layer
    subtitle_layer = None  # Handle subtitles last (ASS burn)

    for i, layer in enumerate(visible_layers):
        ltype = layer["type"]
        transform = layer.get("transform", {})
        style = layer.get("style", {})
        lx = int(transform.get("x", 0))
        ly = int(transform.get("y", 0))
        lw = int(transform.get("width", 100))
        lh = int(transform.get("height", 100))
        opacity = float(style.get("opacity", 1.0))
        blur = int(style.get("blur", 0))
        border_radius = int(style.get("borderRadius", 0))

        if ltype == "subtitles":
            subtitle_layer = layer
            continue

        layer_label = f"[l{step}]"

        if ltype == "gameplay":
            src_label = f"[src_{src_idx}]" if use_split else "[0:v]"
            src_idx += 1
            chain = f"{src_label}scale={lw}:{lh}:force_original_aspect_ratio=decrease,pad={lw}:{lh}:(ow-iw)/2:(oh-ih)/2"
            if blur > 0:
                chain += f",boxblur={blur}:{blur}"
            if border_radius > 0:
                chain += f",format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='if(gt(pow(max(0\\,{border_radius}-min(X\\,W-1-X))\\,2)+pow(max(0\\,{border_radius}-min(Y\\,H-1-Y))\\,2)\\,{border_radius}*{border_radius})\\,0\\,255)'"
            if opacity < 1.0:
                chain += f",format=yuva420p,colorchannelmixer=aa={opacity:.2f}"
            chain += layer_label
            filters.append(chain)

        elif ltype == "facecam":
            src_label = f"[src_{src_idx}]" if use_split else "[0:v]"
            src_idx += 1
            video_data = layer.get("video", {})
            crop = video_data.get("crop")
            chain = f"{src_label}"
            if crop:
                chain += f"crop={crop['w']}:{crop['h']}:{crop['x']}:{crop['y']},"
            chain += f"scale={lw}:{lh}"
            if blur > 0:
                chain += f",boxblur={blur}:{blur}"
            # Facecam border radius (or shape's circle)
            radius = border_radius
            if radius > 0:
                chain += (
                    f",format=yuva420p,"
                    f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
                    f"a='if(gt(pow(max(0\\,{radius}-min(X\\,W-1-X))\\,2)"
                    f"+pow(max(0\\,{radius}-min(Y\\,H-1-Y))\\,2)"
                    f"\\,{radius}*{radius})\\,0\\,255)'"
                )
            if opacity < 1.0:
                chain += f",format=yuva420p,colorchannelmixer=aa={opacity:.2f}"
            chain += layer_label
            filters.append(chain)

        elif ltype == "shape":
            shape_data = layer.get("shape", {})
            bg_color = shape_data.get("backgroundColor", "#a855f7")
            bg_alpha = float(shape_data.get("backgroundAlpha", 0.3))
            shape_type = shape_data.get("shapeType", "rectangle")

            r, g, b = _hex_to_rgb(bg_color)
            # FFmpeg color with alpha
            alpha_hex = f"{int(bg_alpha * 255):02X}"
            ffmpeg_color = f"#{r:02X}{g:02X}{b:02X}{alpha_hex}"

            chain = f"color={ffmpeg_color}:s={lw}x{lh}:d={duration:.3f},format=yuva420p"
            if shape_type == "circle":
                # Make a circle using geq alpha
                rx = lw // 2
                ry = lh // 2
                chain += (
                    f",geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
                    f"a='if(gt(pow((X-{rx})/{rx}.0\\,2)+pow((Y-{ry})/{ry}.0\\,2)\\,1)\\,0\\,p(X,Y))'"
                )
            elif border_radius > 0:
                chain += (
                    f",geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
                    f"a='if(gt(pow(max(0\\,{border_radius}-min(X\\,W-1-X))\\,2)"
                    f"+pow(max(0\\,{border_radius}-min(Y\\,H-1-Y))\\,2)"
                    f"\\,{border_radius}*{border_radius})\\,0\\,p(X,Y))'"
                )
            if opacity < 1.0:
                chain += f",colorchannelmixer=aa={opacity * bg_alpha:.2f}"
            chain += layer_label
            filters.append(chain)

        elif ltype == "asset" and i in asset_input_map:
            fidx = asset_input_map[i]
            chain = f"[{fidx}:v]scale={lw}:{lh},format=yuva420p"
            if blur > 0:
                chain += f",boxblur={blur}:{blur}"
            if border_radius > 0:
                chain += (
                    f",geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':"
                    f"a='if(gt(pow(max(0\\,{border_radius}-min(X\\,W-1-X))\\,2)"
                    f"+pow(max(0\\,{border_radius}-min(Y\\,H-1-Y))\\,2)"
                    f"\\,{border_radius}*{border_radius})\\,0\\,255)'"
                )
            if opacity < 1.0:
                chain += f",colorchannelmixer=aa={opacity:.2f}"
            chain += layer_label
            filters.append(chain)

        else:
            continue

        # Overlay this layer onto the canvas
        next_canvas = f"[c{step}]"
        filters.append(f"{canvas_label}{layer_label}overlay={lx}:{ly}:format=auto{next_canvas}")
        canvas_label = next_canvas
        step += 1

    # Handle subtitles: generate ASS and burn
    ass_path = None
    if subtitle_layer and subtitle_layer.get("subtitle", {}).get("words"):
        ass_fd, ass_path = tempfile.mkstemp(suffix=".ass")
        os.close(ass_fd)
        _generate_ass_from_layer(
            subtitle_layer["subtitle"],
            subtitle_layer.get("transform", {}),
            ass_path,
        )
        escaped = ass_path.replace("\\", "/").replace(":", "\\:")
        fonts_dir = os.path.abspath(FONTS_DIR).replace("\\", "/").replace(":", "\\:")
        filters.append(f"{canvas_label}ass='{escaped}':fontsdir='{fonts_dir}'[out]")
    else:
        # No subtitles — rename final canvas to [out]
        filters.append(f"{canvas_label}null[out]")

    filtergraph = ";".join(filters)

    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filtergraph,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", "3M", "-maxrate", "4M", "-bufsize", "6M",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-shortest",
        output_path,
    ]

    logger.info(f"Render command: ffmpeg ... -filter_complex <{len(filtergraph)} chars> ... {output_path}")
    logger.debug(f"Full filtergraph:\n{filtergraph}")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode != 0:
            logger.error(f"Render failed:\n{result.stderr[-1000:]}")
            return False

        if os.path.isfile(output_path):
            size_mb = os.path.getsize(output_path) / (1024 * 1024)
            logger.info(f"Rendered: {output_path} ({size_mb:.1f}MB)")
            return True
        return False

    except subprocess.TimeoutExpired:
        logger.error(f"Render timed out: {output_path}")
        return False

    finally:
        if ass_path and os.path.isfile(ass_path):
            os.unlink(ass_path)
