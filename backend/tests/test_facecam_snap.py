"""Snapping the pose model's person box to the webcam overlay's borders."""

import numpy as np

from app.services.facecam_detector import _snap_to_overlay

FRAME_W, FRAME_H = 1920, 1080
# Webcam overlay in the top-right corner, like Falkarst's stream
CAM = (1518, 0, 402, 446)


def _frames(n=15, seed=0):
    """Half-resolution grayscale frames: changing game footage, a static room
    in the cam (with a shelf above the streamer's head), a slightly moving person."""
    rng = np.random.default_rng(seed)
    h, w = FRAME_H // 2, FRAME_W // 2
    cx, cy, cw, ch = (v // 2 for v in CAM)
    frames = []
    for i in range(n):
        f = rng.integers(0, 256, (h, w)).astype(np.uint8)          # game footage
        room = np.full((ch, cw), 70, np.uint8)
        room[20:24, :] = 200                                         # static shelf
        room[:, 120:123] = 160                                       # static door frame
        f[cy:cy + ch, cx:cx + cw] = room
        dx = int(rng.integers(-6, 7))
        f[cy + 45:cy + ch, cx + 15 + dx:cx + cw - 10 + dx] = 150     # the streamer
        frames.append(f)
    return frames


def test_person_box_grows_to_the_overlay():
    person = (1522, 90, 398, 356)
    x, y, w, h = _snap_to_overlay(_frames(), person, FRAME_W, FRAME_H)
    for got, want in zip((x, y, w, h), CAM):
        assert abs(got - want) <= 6, (x, y, w, h)


def test_too_few_frames_keeps_the_person_box():
    person = (1522, 90, 398, 356)
    assert _snap_to_overlay(_frames(n=2), person, FRAME_W, FRAME_H) == person
