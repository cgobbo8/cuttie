"""Moments of the live cut into small clips for the compilations (Twitch faked)."""

import json
import subprocess

from app.services import clip_tools, clipper
from app.services.vod_transcript import VodTranscript


def _video(path, seconds):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=10:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest", "-c:v", "libx264", "-c:a", "aac", path],
        check=True,
    )


# A live in 10 s segments, the first one a little shorter
SEGMENTS = [(0.0, 7.5, "https://vod/0.ts")] + [(7.5 + 10.0 * i, 10.0, f"https://vod/{i + 1}.ts") for i in range(60)]


def test_a_clip_takes_the_room_its_segments_give():
    # A sentence inside one segment (57.5-67.5): that segment alone, the room it holds on each side
    assert clip_tools.piece_bounds(SEGMENTS, 60.0, 63.0) == (57.5, 67.5, 6, 7)
    # It starts where its first segment does (the one place with a key frame for sure), whatever room that makes
    assert clip_tools.piece_bounds(SEGMENTS, 66.0, 66.8) == (57.5, 67.5, 6, 7)
    # Too close to the segment's edge: the next one comes too, never more than 8 s of room after the moment
    assert clip_tools.piece_bounds(SEGMENTS, 66.0, 67.2) == (57.5, 75.2, 6, 8)
    # A moment across two segments
    assert clip_tools.piece_bounds(SEGMENTS, 65.0, 72.0) == (57.5, 77.5, 6, 8)
    # One that begins right after a segment's edge: the segment before comes too, for the room before it
    assert clip_tools.piece_bounds(SEGMENTS, 57.8, 60.0) == (47.5, 67.5, 5, 7)
    # The live starts and ends somewhere
    assert clip_tools.piece_bounds(SEGMENTS, 0.2, 3.0) == (0.0, 7.5, 0, 1)
    assert clip_tools.piece_bounds(SEGMENTS, 600.0, 606.9) == (597.5, 607.5, 60, 61)
    # No playlist to read: ffmpeg seeks by itself and starts on the next key frame, so it is asked 5 s before the moment
    low, high, first, stop = clip_tools.piece_bounds(None, 60.0, 63.0)
    assert (round(low, 1), round(high, 1), first, stop) == (55.0, 63.6, 0, 0)


def test_reads_a_plain_playlist_only(monkeypatch):
    class Reply:
        def __init__(self, text):
            self.text = text

    plain = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:7.500,\n0.ts\n#EXTINF:10.000,\n1.ts\n#EXT-X-ENDLIST\n"
    monkeypatch.setattr("requests.get", lambda url, **k: Reply(plain))
    assert clip_tools._live_segments("https://vod/chunked/index-dvr.m3u8") == [
        (0.0, 7.5, "https://vod/chunked/0.ts"),
        (7.5, 10.0, "https://vod/chunked/1.ts"),
    ]
    # Anything else (fragmented MP4, a break in the timeline): ffmpeg reads the playlist itself
    monkeypatch.setattr("requests.get", lambda url, **k: Reply(plain.replace("#EXT-X-TARGETDURATION:10", '#EXT-X-MAP:URI="init.mp4"')))
    assert clip_tools._live_segments("https://vod/index.m3u8") is None
    monkeypatch.setattr("requests.get", lambda url, **k: Reply(plain.replace("#EXTINF:10.000,", "#EXT-X-DISCONTINUITY\n#EXTINF:10.000,")))
    assert clip_tools._live_segments("https://vod/index.m3u8") is None


def test_moments_become_clips_with_their_sidecars(monkeypatch, tmp_path):
    clips = tmp_path / "clips"
    clips.mkdir()
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(clips))
    monkeypatch.setattr(clip_tools, "_lives", {})
    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", lambda url, **k: "https://vod/index.m3u8")
    # No playlist to read here: the live's own playlist is read by ffmpeg (faked)
    monkeypatch.setattr(clip_tools, "_live_segments", lambda direct: None)
    fetched = []

    def stream_copy(url, start, duration, out):
        fetched.append((round(start, 1), round(duration, 1)))
        if start > 400:  # this part of the live can't be fetched
            return False
        _video(out, duration)
        return True

    monkeypatch.setattr("app.services.clipper._streamcopy_clip", stream_copy)
    monkeypatch.setattr(clip_tools, "_words_between", lambda job, path, clip_start, a, b: [{"word": "calme", "start": 1.0, "end": 1.4}])
    monkeypatch.setattr(clip_tools, "_label_speakers", lambda job, path, words: [{**w, "speaker": "Falkarst"} for w in words])
    checked = []
    monkeypatch.setattr(clip_tools, "_recheck_cam", lambda job, name, path: checked.append(name))

    result = clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [
        {"id": "abc123def4", "start": 100.0, "end": 103.0},
        {"id": "zzz999yyy8", "start": 500.0, "end": 503.0},
        {"id": "../etc", "start": 0.0, "end": 5.0},
    ])

    assert [p["id"] for p in result["pieces"]] == ["abc123def4"]
    assert result["failed"] == ["zzz999yyy8"]
    assert sorted(fetched) == [(95.0, 8.6), (495.0, 8.6)]
    piece = result["pieces"][0]
    assert piece["file"] == "piece_abc123def4.mp4" and (piece["vod_start"], piece["vod_end"]) == (95.0, 103.6)
    assert "tight" not in piece
    assert json.loads((clips / "piece_abc123def4_meta.json").read_text()) == {"vod_start": 95.0, "vod_end": 103.6, "settled": True}
    assert json.loads((clips / "piece_abc123def4_words.json").read_text()) == [{"word": "calme", "start": 1.0, "end": 1.4, "speaker": "Falkarst"}]
    assert json.loads((clips / "piece_abc123def4_probe.json").read_text())["width"] == 320
    assert checked == ["piece_abc123def4.mp4"]
    assert not list(clips.glob("*.cutting.mp4")) and not list(clips.glob("*etc*"))

    # Asked again, its cut moved inside the clip: nothing is fetched
    fetched.clear()
    again = clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "abc123def4", "start": 99.8, "end": 103.4}])
    assert [p["id"] for p in again["pieces"]] == ["abc123def4"] and fetched == []
    # ...and past it: cut again, wider
    clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "abc123def4", "start": 93.0, "end": 103.0}])
    assert fetched == [(88.0, 15.6)]
    assert json.loads((clips / "piece_abc123def4_meta.json").read_text()) == {"vod_start": 88.0, "vod_end": 103.6, "settled": True}
    # A clip cut before files were made to start on their first picture is cut again
    (clips / "piece_abc123def4_meta.json").write_text(json.dumps({"vod_start": 88.0, "vod_end": 103.6}))
    fetched.clear()
    clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "abc123def4", "start": 93.0, "end": 103.0}])
    assert fetched == [(88.0, 15.6)]


def _segments(folder, seconds=12, each=4):
    """A small live in TS segments like Twitch's (a key frame every 2 s): [(start, length, path)]."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=30:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:v", "libx264", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
         "-c:a", "aac", "-f", "hls", "-hls_time", str(each), "-hls_list_size", "0", "-hls_segment_filename", str(folder / "seg%d.ts"), str(folder / "live.m3u8")],
        check=True,
    )
    # As addresses, like Twitch's: a bare Windows path would read as a protocol named after its drive,
    # and ffmpeg takes "file:C:/..." there, not "file:///C:/..."
    return [(float(i * each), float(each), "file:" + (folder / f"seg{i}.ts").as_posix()) for i in range(seconds // each)]


def test_a_clip_starts_on_its_first_picture_and_its_moment_is_cut_on_its_words(monkeypatch, tmp_path):
    clips, live = tmp_path / "clips", tmp_path / "live"
    clips.mkdir()
    live.mkdir()
    segments = _segments(live)
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(clips))
    monkeypatch.setattr(clip_tools, "_live", lambda url: ("https://vod/index.m3u8", segments))

    def no_seek(*args):
        raise AssertionError("the live's own playlist is not read when its segments are known")

    monkeypatch.setattr("app.services.clipper._streamcopy_clip", no_seek)
    # What the clip's own transcription times, on the clip's clock
    monkeypatch.setattr(clip_tools, "_words_between", lambda job, path, clip_start, a, b: [
        {"word": "Bon.", "start": 0.4, "end": 0.7}, {"word": "C'est", "start": 1.3, "end": 1.5}, {"word": "calme", "start": 1.5, "end": 1.9}, {"word": "Allez", "start": 3.0, "end": 3.3},
    ])
    monkeypatch.setattr(clip_tools, "_label_speakers", lambda job, path, words: words)
    monkeypatch.setattr(clip_tools, "_recheck_cam", lambda job, name, path: None)
    # What the live's transcript has: lines, their times rough
    monkeypatch.setattr("app.services.vod_transcript.load_cached", lambda job_id: VodTranscript(segments=[(3.0, 4.6, " Bon."), (5.0, 6.2, " c'est calme"), (6.5, 7.5, " Allez")]))

    result = clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [
        {"id": "seg1piece0", "start": 4.65, "end": 6.7, "fit": [5.0, 6.2]},
        {"id": "nofit12345", "start": 4.65, "end": 6.7},
        {"id": "sound12345", "start": 4.65, "end": 6.7, "fit": [9.0, 11.0]},
    ])

    assert result["failed"] == []
    piece, plain, other = result["pieces"]
    # The moment sits in the second segment (4-8 s): the clip is that segment, from its first picture
    assert (piece["vod_start"], piece["vod_end"]) == (4.0, 8.0) and 3.8 <= piece["duration"] <= 4.3
    picture, sound = clipper.stream_starts(str(clips / "piece_seg1piece0.mp4"))
    assert picture < 0.1 and sound < 0.1
    assert json.loads((clips / "piece_seg1piece0_meta.json").read_text()) == {"vod_start": 4.0, "vod_end": 8.0, "settled": True}
    # The line is said "from 5.0 to 6.2 s"; its words are really said from 5.3 to 5.9 s (1.3-1.9 s of the clip)
    assert piece["tight"] == [5.22, 6.06]
    # Not asked: nothing; asked on a part of the live where nothing it says is found: left as it is
    assert "tight" not in plain and other["tight"] is None

    # Asked again once cut: the words are read again, nothing is fetched
    monkeypatch.setattr(clip_tools, "_live", no_seek)
    again = clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "seg1piece0", "start": 5.0, "end": 6.2, "fit": [5.0, 6.2]}])
    assert again["pieces"][0]["tight"] == [5.22, 6.06]
