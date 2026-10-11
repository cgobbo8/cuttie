"""Clips deleted to free disk space, cut again from the live at the same places (Twitch faked)."""

import subprocess

import pytest

from app.services import clip_tools


def _video(path, seconds):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=10:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest", "-c:v", "libx264", "-c:a", "aac", path],
        check=True,
    )


def test_the_clips_come_back_where_they_were_in_the_live(monkeypatch, tmp_path):
    clips = tmp_path / "clips"
    clips.mkdir()
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(clips))
    (clips / "a_words.json").write_text("[]")  # sidecars stayed
    _video(str(clips / "c.mp4"), 2)  # already there: left alone
    fetched = []

    def stream_copy(url, start, duration, out):
        fetched.append((start, duration))
        if start == 300:  # this part of the live can't be fetched
            return False
        _video(out, duration)
        return True

    monkeypatch.setattr("app.services.clipper._streamcopy_clip", stream_copy)
    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", lambda url, **k: "https://vod/master.m3u8")

    result = clip_tools.restore_clips("job", "https://www.twitch.tv/videos/1", [
        {"filename": "a.mp4", "start": 100.0, "end": 104.0},
        {"filename": "b.mp4", "start": 300.0, "end": 303.0},
        {"filename": "c.mp4", "start": 500.0, "end": 502.0},
    ])

    assert result == {"restored": ["a.mp4", "c.mp4"], "failed": ["b.mp4"]}
    assert sorted(fetched) == [(100.0, 4.0), (300.0, 3.0)]
    assert 3.5 <= clip_tools._duration(str(clips / "a.mp4")) <= 4.5
    assert not (clips / "b.mp4").exists()
    assert not list(clips.glob("*.restoring.mp4"))


def test_a_live_twitch_deleted_says_so(monkeypatch, tmp_path):
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(tmp_path))

    def gone(url, **k):
        raise subprocess.CalledProcessError(1, "yt-dlp", stderr="ERROR: [twitch:vod] 1: Video 1 does not exist")

    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", gone)
    with pytest.raises(clip_tools.LiveGone):
        clip_tools.restore_clips("job", "https://www.twitch.tv/videos/1", [{"filename": "a.mp4", "start": 0, "end": 5}])

    def offline(url, **k):
        raise subprocess.CalledProcessError(1, "yt-dlp", stderr="ERROR: Unable to download JSON metadata: <urlopen error timed out>")

    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", offline)
    with pytest.raises(RuntimeError):
        clip_tools.restore_clips("job", "https://www.twitch.tv/videos/1", [{"filename": "a.mp4", "start": 0, "end": 5}])
