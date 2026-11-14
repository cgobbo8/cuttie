"""Moments of the live cut into small clips for the compilations (Twitch faked)."""

import json
import subprocess

from app.services import clip_tools


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
    # Never more than 8 s of room on a side
    assert clip_tools.piece_bounds(SEGMENTS, 66.0, 66.8) == (58.0, 67.5, 6, 7)
    # Too close to the segment's edge: the next one comes too, its room capped
    assert clip_tools.piece_bounds(SEGMENTS, 66.0, 67.2) == (58.0, 75.2, 6, 8)
    # A moment across two segments
    assert clip_tools.piece_bounds(SEGMENTS, 65.0, 72.0) == (57.5, 77.5, 6, 8)
    # The live starts and ends somewhere
    assert clip_tools.piece_bounds(SEGMENTS, 0.2, 3.0) == (0.0, 7.5, 0, 1)
    assert clip_tools.piece_bounds(SEGMENTS, 600.0, 606.9) == (597.5, 607.5, 60, 61)
    # No playlist to read: the moment and a little room, ffmpeg seeks by itself
    low, high, first, stop = clip_tools.piece_bounds(None, 60.0, 63.0)
    assert (round(low, 1), round(high, 1), first, stop) == (59.4, 63.6, 0, 0)


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
    assert sorted(fetched) == [(99.4, 4.2), (499.4, 4.2)]
    piece = result["pieces"][0]
    assert piece["file"] == "piece_abc123def4.mp4" and (piece["vod_start"], piece["vod_end"]) == (99.4, 103.6)
    assert json.loads((clips / "piece_abc123def4_meta.json").read_text()) == {"vod_start": 99.4, "vod_end": 103.6}
    assert json.loads((clips / "piece_abc123def4_words.json").read_text()) == [{"word": "calme", "start": 1.0, "end": 1.4, "speaker": "Falkarst"}]
    assert json.loads((clips / "piece_abc123def4_probe.json").read_text())["width"] == 320
    assert checked == ["piece_abc123def4.mp4"]
    assert not list(clips.glob("*.cutting.mp4")) and not list(clips.glob("*etc*"))

    # Asked again, its cut moved inside the clip: nothing is fetched
    fetched.clear()
    again = clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "abc123def4", "start": 99.8, "end": 103.4}])
    assert [p["id"] for p in again["pieces"]] == ["abc123def4"] and fetched == []
    # ...and past it: cut again, wider
    clip_tools.extract_pieces("job", "https://www.twitch.tv/videos/1", [{"id": "abc123def4", "start": 95.0, "end": 103.0}])
    assert fetched == [(94.4, 9.2)]
    assert json.loads((clips / "piece_abc123def4_meta.json").read_text()) == {"vod_start": 94.4, "vod_end": 103.6}
