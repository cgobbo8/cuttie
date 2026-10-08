"""Brand palette detection: dominant colors of a streamer's logo and banner,
with a role for each (accent, highlight, dark, light) so templates can use them."""

import colorsys
import io
import logging
import urllib.request

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

MAX_BYTES = 8 * 1024 * 1024
SAMPLE_SIZE = 160
DEFAULTS = {"accent": "#3DBE8B", "highlight": "#FFD21F", "dark": "#111317", "light": "#F5F5F2"}


def _hex(rgb) -> str:
    return "#{:02X}{:02X}{:02X}".format(*(int(round(c)) for c in rgb))


def _hls(rgb) -> tuple[float, float, float]:
    """(hue 0-360, lightness 0-1, saturation 0-1)"""
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    return h * 360, l, s


def _download(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Cuttie"})
    with urllib.request.urlopen(req, timeout=10) as res:
        data = res.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("image too large")
    return Image.open(io.BytesIO(data))


def _opaque_pixels(img: Image.Image) -> np.ndarray:
    """RGB pixels of a downscaled copy, ignoring transparent ones."""
    img = img.convert("RGBA")
    img.thumbnail((SAMPLE_SIZE, SAMPLE_SIZE))
    px = np.asarray(img).reshape(-1, 4)
    return px[px[:, 3] >= 160][:, :3]


def _clusters(pixels: np.ndarray, n: int = 16) -> list[tuple[np.ndarray, int]]:
    """Quantize to `n` colors; returns (rgb, pixel count) pairs, largest first."""
    if len(pixels) == 0:
        return []
    strip = Image.fromarray(pixels.reshape(1, -1, 3).astype(np.uint8), "RGB")
    q = strip.quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    pal = np.array(q.getpalette()[: n * 3], dtype=float).reshape(-1, 3)
    counts = np.bincount(np.asarray(q).ravel(), minlength=n)
    return sorted(((pal[i], int(counts[i])) for i in range(n) if counts[i]), key=lambda c: -c[1])


def _merge(colors: list[tuple[np.ndarray, float]], dist: float = 38.0) -> list[tuple[np.ndarray, float]]:
    """Merge near-identical colors (keeps the heavier one's value)."""
    merged: list[list] = []
    for rgb, w in sorted(colors, key=lambda c: -c[1]):
        for m in merged:
            if np.linalg.norm(m[0] - rgb) < dist:
                m[1] += w
                break
        else:
            merged.append([rgb, w])
    return [(m[0], m[1]) for m in sorted(merged, key=lambda m: -m[1])]


def _hue_distance(a: float, b: float) -> float:
    d = abs(a - b) % 360
    return min(d, 360 - d)


def assign_roles(colors: list[tuple[np.ndarray, float]]) -> dict[str, str | None]:
    """Pick accent / highlight / dark / light among weighted colors (None = not found)."""
    roles: dict[str, str | None] = {k: None for k in DEFAULTS}
    if not colors:
        return roles
    total = sum(w for _, w in colors) or 1
    info = [(rgb, w / total, *_hls(rgb)) for rgb, w in colors]  # rgb, share, hue, light, sat

    # Accent: the most present colorful, mid-light color
    vivid = [c for c in info if c[4] >= 0.28 and 0.22 <= c[3] <= 0.78 and c[1] >= 0.02]
    accent = max(vivid, key=lambda c: c[1] * (0.5 + c[4])) if vivid else None
    if accent is not None:
        roles["accent"] = _hex(accent[0])

    # Highlight: a bright, saturated color clearly different from the accent
    pops = [
        c for c in info
        if c[4] >= 0.55 and c[3] >= 0.42 and c[3] <= 0.8 and c[1] >= 0.004
        and (accent is None or _hue_distance(c[2], accent[2]) >= 40)
    ]
    if pops:
        roles["highlight"] = _hex(max(pops, key=lambda c: c[4] * c[3] * (1 + c[1]))[0])

    # Dark / light: mostly about how present the color is in the logo
    darks = [c for c in info if c[3] <= 0.3 and c[1] >= 0.01]
    if darks:
        roles["dark"] = _hex(max(darks, key=lambda c: c[1] * (0.7 + 0.3 * c[4]))[0])

    lights = [c for c in info if c[3] >= 0.72 and c[1] >= 0.01]
    if lights:
        roles["light"] = _hex(max(lights, key=lambda c: c[1] * (0.7 + 0.3 * c[4]))[0])
    return roles


def extract_palette(urls: list[str], weights: list[float] | None = None) -> dict:
    """Palette of the given images: the logo first, then the banner.

    The logo decides each role; the banner only fills roles the logo has no
    color for (a teal background must not beat the logo's navy outline).
    """
    weights = weights or [1.0] + [0.45] * (len(urls) - 1)
    per_image: list[list[tuple[np.ndarray, float]]] = []
    for url, weight in zip(urls, weights):
        try:
            pixels = _opaque_pixels(_download(url))
        except Exception as e:
            logger.warning(f"Palette: cannot read {url}: {e}")
            per_image.append([])
            continue
        n = max(len(pixels), 1)
        per_image.append([(rgb, weight * count / n) for rgb, count in _clusters(pixels)])

    roles = {k: None for k in DEFAULTS}
    for colors in per_image:
        found = assign_roles(_merge(colors))
        roles = {k: roles[k] or found[k] for k in roles}
    roles = {k: v or DEFAULTS[k] for k, v in roles.items()}

    everything = _merge([c for colors in per_image for c in colors])
    palette = [_hex(rgb) for rgb, _ in everything[:6]]
    return {"palette": palette, "roles": roles}
