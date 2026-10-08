"""Locating the webcam on frames from a VOD and on an analysis' clips (pose model faked)."""

import cv2
import numpy as np

from app.services import facecam_detector as fd

FRAME_W, FRAME_H = 1920, 1080
CAM = (1518, 0, 402, 446)
# Where the pose model frames the streamer inside the cam (hair to shoulders)
PERSON = (1522, 90, 1920, 446)


class _T:
    """Just enough of a torch tensor: .cpu().numpy() and indexing."""

    def __init__(self, a):
        self.a = np.asarray(a, dtype=float)

    def cpu(self):
        return self

    def numpy(self):
        return self.a

    def __getitem__(self, i):
        return _T(self.a[i])


class _Box:
    def __init__(self, xyxy):
        self.xyxy = _T([xyxy])
        self.conf = [0.9]


class _Result:
    def __init__(self, persons):
        self.boxes = [_Box(p) for p in persons]
        kps = []
        for x1, y1, x2, _ in persons:
            k = np.zeros((17, 3))
            cx = (x1 + x2) / 2
            k[0] = (cx, y1 + 60, 0.9)  # nose
            k[1] = (cx - 20, y1 + 45, 0.9)  # eyes
            k[2] = (cx + 20, y1 + 45, 0.9)
            kps.append(k)
        self.keypoints = type("K", (), {"data": _T(np.array(kps) if kps else np.zeros((0, 17, 3)))})()


class _FakeModel:
    """Sees the streamer in the cam, except on frames flagged as 'away', and a
    game character wandering around the rest of the frame."""

    def __init__(self, away=()):
        self.calls = 0
        self.away = set(away)

    def __call__(self, frame, conf, verbose):
        i = self.calls
        self.calls += 1
        rng = np.random.default_rng(i)
        gx, gy = int(rng.integers(100, 1100)), int(rng.integers(200, 700))
        persons = [(gx, gy, gx + int(rng.integers(120, 400)), gy + int(rng.integers(200, 380)))]
        if i not in self.away:
            persons.append(PERSON)
        return [_Result(persons)]


def _frames(n=10, seed=0):
    """Full-resolution BGR frames: changing game footage, a static room in the cam."""
    rng = np.random.default_rng(seed)
    hw, hh = FRAME_W // 2, FRAME_H // 2
    cx, cy, cw, ch = (v // 2 for v in CAM)
    out = []
    for _ in range(n):
        f = rng.integers(0, 256, (hh, hw)).astype(np.uint8)
        room = np.full((ch, cw), 70, np.uint8)
        room[20:24, :] = 200
        f[cy:cy + ch, cx:cx + cw] = room
        dx = int(rng.integers(-6, 7))
        f[cy + 45:cy + ch, cx + 15 + dx:cx + cw - 10 + dx] = 150
        full = cv2.resize(f, (FRAME_W, FRAME_H), interpolation=cv2.INTER_NEAREST)
        out.append(cv2.cvtColor(full, cv2.COLOR_GRAY2BGR))
    return out


def test_vod_frames_give_the_overlay_and_a_frame_with_the_streamer(monkeypatch):
    # The streamer is away on the middle frame: show another one
    model = _FakeModel(away={5})
    monkeypatch.setattr(fd, "_get_model", lambda: model)

    rect, shown = fd.analyze_frames(_frames())

    assert rect is not None
    for got, want in zip((rect["x"], rect["y"], rect["w"], rect["h"]), CAM):
        assert abs(got - want) <= 8, rect
    assert shown in (4, 6)


def test_no_streamer_anywhere_means_no_cam(monkeypatch):
    monkeypatch.setattr(fd, "_get_model", lambda: _FakeModel(away=range(10)))
    rect, shown = fd.analyze_frames(_frames())
    assert rect is None
    assert shown == 5


def test_clips_keep_where_people_stand(monkeypatch, tmp_path):
    frames = _frames(n=4)
    paths = []
    for name in ("a.mp4", "b.mp4", "c.mp4"):
        path = str(tmp_path / name)
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 10, (FRAME_W, FRAME_H))
        for f in frames * 3:
            writer.write(f)
        writer.release()
        paths.append(path)
    # c.mp4 is scanned last: its 5 frames are calls 10..14
    monkeypatch.setattr(fd, "_get_model", lambda: _FakeModel(away=range(10, 15)))

    result = fd.analyze_clips(paths)

    assert result["rect"] is not None
    assert (result["frame_w"], result["frame_h"]) == (FRAME_W, FRAME_H)
    assert set(result["people"]) == {"a.mp4", "b.mp4", "c.mp4"}
    cam_x = CAM[0]
    assert any(x >= cam_x for x, _ in result["people"]["a.mp4"])
    assert all(x < cam_x for x, _ in result["people"]["c.mp4"])
