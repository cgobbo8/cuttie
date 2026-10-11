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
    """Sees the streamer in the cam, except on frames flagged as 'away' (by call
    or by a black mark in the top-left corner), and a game character wandering
    around the rest of the frame."""

    def __init__(self, away=()):
        self.calls = 0
        self.away = set(away)

    def __call__(self, frame, conf, verbose):
        i = self.calls
        self.calls += 1
        rng = np.random.default_rng(i)
        gx, gy = int(rng.integers(100, 1100)), int(rng.integers(200, 700))
        persons = [(gx, gy, gx + int(rng.integers(120, 400)), gy + int(rng.integers(200, 380)))]
        if i not in self.away and frame[:16, :16].mean() > 40:
            persons.append(PERSON)
        return [_Result(persons)]


def _frames(n=10, seed=0, away=()):
    """Full-resolution BGR frames: changing game footage, a static room in the cam.

    Frames listed in `away` carry the black mark: nobody in the cam on them.
    """
    rng = np.random.default_rng(seed)
    hw, hh = FRAME_W // 2, FRAME_H // 2
    cx, cy, cw, ch = (v // 2 for v in CAM)
    out = []
    for i in range(n):
        f = rng.integers(0, 256, (hh, hw)).astype(np.uint8)
        room = np.full((ch, cw), 70, np.uint8)
        room[20:24, :] = 200
        f[cy:cy + ch, cx:cx + cw] = room
        dx = int(rng.integers(-6, 7))
        f[cy + 45:cy + ch, cx + 15 + dx:cx + cw - 10 + dx] = 150
        f[:8, :8] = 0 if i in away else 255
        full = cv2.resize(f, (FRAME_W, FRAME_H), interpolation=cv2.INTER_NEAREST)
        out.append(cv2.cvtColor(full, cv2.COLOR_GRAY2BGR))
    return out


def _write(path, frames, fps=10, codec="MJPG"):
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*codec), fps, (frames[0].shape[1], frames[0].shape[0]))
    for f in frames:
        writer.write(f)
    writer.release()
    return path


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


def test_clips_keep_where_people_stand_along_each_clip(monkeypatch, tmp_path):
    # 2 s clips at 10 fps: the streamer stays in a; leaves the cam halfway through b
    # (the stream switched scene); is never in c
    paths = [
        _write(str(tmp_path / "a.avi"), _frames(n=20, seed=1)),
        _write(str(tmp_path / "b.avi"), _frames(n=20, seed=2, away=range(10, 20))),
        _write(str(tmp_path / "c.avi"), _frames(n=20, seed=3, away=range(20))),
    ]
    model = _FakeModel()
    monkeypatch.setattr(fd, "_get_model", lambda: model)
    monkeypatch.setattr(fd, "PRESENCE_EVERY", 0.5)

    result = fd.analyze_clips(paths)

    assert result["rect"] is not None
    assert (result["frame_w"], result["frame_h"]) == (FRAME_W, FRAME_H)
    assert set(result["people"]) == set(result["frames"]) == {"a.avi", "b.avi", "c.avi"}
    assert result["frames"]["b.avi"] == [0.0, 0.5, 1.0, 1.5]
    cam_x = CAM[0]

    def in_cam(clip):
        return sorted(t for x, _, t in result["people"][clip] if x >= cam_x)

    assert in_cam("a.avi") == [0.0, 0.5, 1.0, 1.5]
    assert in_cam("b.avi") == [0.0, 0.5]
    assert in_cam("c.avi") == []
    # The game characters are kept too, with their time
    assert all(len(p) == 3 for p in result["people"]["c.avi"]) and result["people"]["c.avi"]


def test_an_unreadable_clip_keeps_the_frames_that_located_the_cam(monkeypatch, tmp_path):
    paths = [_write(str(tmp_path / f"{n}.avi"), _frames(n=20, seed=s)) for n, s in (("a", 1), ("b", 2))]
    monkeypatch.setattr(fd, "_get_model", lambda: _FakeModel())

    def broken(path, every):
        raise RuntimeError("no decoder")
        yield

    monkeypatch.setattr(fd, "_keyframes", broken)
    result = fd.analyze_clips(paths)

    assert result["frames"] == {}
    # The 5 frames each clip was scanned on, without a time
    assert all(len(p) == 2 for p in result["people"]["a.avi"])
    assert any(x >= CAM[0] for x, _ in result["people"]["a.avi"])


def test_keyframes_are_read_every_few_seconds(tmp_path):
    # 6 s of H.264-like video (MPEG-4, keyframes every 12 frames by default)
    small = [cv2.resize(f, (320, 180)) for f in _frames(n=60, seed=4)]
    path = _write(str(tmp_path / "clip.mp4"), small, codec="mp4v")

    got = list(fd._keyframes(path, 2.0))

    times = [t for t, _ in got]
    assert len(times) >= 3 and times[0] < 0.2
    assert all(b - a >= 1.8 for a, b in zip(times, times[1:]))
    assert got[0][1].shape == (180, 320, 3)
