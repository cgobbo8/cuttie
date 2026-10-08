"""Brand palette detection on synthetic logos."""

import numpy as np
from PIL import Image, ImageDraw

from app.services.palette import DEFAULTS, extract_palette


def _logo(path):
    """Green mascot on a transparent background, navy outline, small yellow shield, mint glow."""
    img = Image.new("RGBA", (300, 300), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((20, 20, 280, 280), fill=(180, 240, 216, 255))     # mint
    d.ellipse((50, 50, 250, 250), fill=(24, 60, 84, 255))        # navy
    d.ellipse((60, 60, 240, 240), fill=(60, 180, 132, 255))      # green
    d.ellipse((130, 130, 165, 165), fill=(240, 192, 0, 255))     # yellow
    img.save(path)


def _banner(path):
    img = Image.new("RGB", (600, 240), (168, 228, 204))
    ImageDraw.Draw(img).rectangle((0, 160, 600, 240), fill=(12, 108, 108))
    img.save(path)


def test_roles_follow_the_logo(tmp_path):
    logo, banner = tmp_path / "logo.png", tmp_path / "banner.png"
    _logo(logo)
    _banner(banner)

    result = extract_palette([logo.as_uri(), banner.as_uri()])
    roles = {k: np.array([int(v[i:i + 2], 16) for i in (1, 3, 5)]) for k, v in result["roles"].items()}

    assert np.abs(roles["accent"] - (60, 180, 132)).max() < 24
    assert np.abs(roles["highlight"] - (240, 192, 0)).max() < 24
    assert np.abs(roles["dark"] - (24, 60, 84)).max() < 24
    assert roles["light"].min() > 150
    assert 1 <= len(result["palette"]) <= 6


def test_unreadable_images_fall_back_to_defaults(tmp_path):
    result = extract_palette([(tmp_path / "missing.png").as_uri()])
    assert result == {"palette": [], "roles": DEFAULTS}
