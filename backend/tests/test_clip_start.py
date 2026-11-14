"""A clip cut from the live by stream copy starts on its first picture, and knows where that is in the live."""

import shutil
import subprocess

from app.services import clipper


def _video(path, seconds):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=30:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest", "-c:v", "libx264", "-g", "60", "-c:a", "aac", str(path)],
        check=True,
    )


def _late(plain, path, picture, sound):
    """`plain` as a copy cut between two key frames leaves it: the picture starts `picture` seconds
    after the file's time 0, the sound `sound` seconds after it."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-itsoffset", str(picture), "-i", str(plain), "-itsoffset", str(sound), "-i", str(plain),
         "-map", "0:v", "-map", "1:a", "-c", "copy", str(path)],
        check=True,
    )


def _frames(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return int(out.stdout.strip())


def test_a_file_whose_picture_starts_late_is_made_to_start_on_it(tmp_path):
    plain, late = tmp_path / "plain.mp4", tmp_path / "late.mp4"
    _video(plain, 6)
    # What Twitch gives for a cut asked at a segment's start: the picture 2 s in, the sound 0.35 s in
    _late(plain, late, 2.0, 0.35)
    picture, sound = clipper.stream_starts(str(late))
    assert picture == 2.0 and 0.3 < sound < 0.4
    frames = _frames(late)

    dropped = clipper.settle_start(str(late))

    # The file now begins on its first picture: 2 s later than asked, less the few frames an encoder holds back
    assert 1.85 <= dropped <= 2.0
    picture, sound = clipper.stream_starts(str(late))
    assert picture < 0.1 and sound < 0.1
    assert _frames(late) == frames
    assert not list(tmp_path.glob("*.settling.mp4"))
    # Asked again, or on a file that starts at 0: nothing to do
    assert clipper.settle_start(str(late)) == 0.0
    assert clipper.settle_start(str(plain)) == 0.0
    # Not a video: left alone
    assert clipper.stream_starts(str(tmp_path / "none.mp4")) == (None, None)
    assert clipper.settle_start(str(tmp_path / "none.mp4")) == 0.0


def test_a_cut_from_the_live_says_where_it_really_starts(monkeypatch, tmp_path):
    plain, late = tmp_path / "plain.mp4", tmp_path / "late.mp4"
    _video(plain, 6)
    _late(plain, late, 1.6, 1.6)
    asked = []

    def stream_copy(url, start, duration, out):
        asked.append((url, start, duration))
        if start > 500:
            return False
        shutil.copy(late if start == 100.4 else plain, out)
        return True

    monkeypatch.setattr(clipper, "_streamcopy_clip", stream_copy)
    # Asked between two key frames: the file starts on the next one, 1.6 s later
    began = clipper.cut_from_live("https://vod/index.m3u8", 100.4, 6.0, str(tmp_path / "a.mp4"))
    assert 101.9 <= began <= 102.0
    assert clipper.stream_starts(str(tmp_path / "a.mp4"))[0] < 0.1
    # Asked on a key frame: it starts there
    assert clipper.cut_from_live("https://vod/index.m3u8", 200.0, 6.0, str(tmp_path / "b.mp4")) == 200.0
    # The live can't be read
    assert clipper.cut_from_live("https://vod/index.m3u8", 600.0, 6.0, str(tmp_path / "c.mp4")) is None
    assert asked == [("https://vod/index.m3u8", 100.4, 6.0), ("https://vod/index.m3u8", 200.0, 6.0), ("https://vod/index.m3u8", 600.0, 6.0)]
