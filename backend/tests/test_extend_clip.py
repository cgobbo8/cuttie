"""A stored clip made longer: re-extracted from the live, its sidecars following (Twitch faked)."""

import json
import subprocess

from app.services import clip_tools, facecam_detector, vod_transcript


def _video(path, seconds):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=size=320x180:rate=10:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-shortest", "-c:v", "libx264", "-c:a", "aac", path],
        check=True,
    )


def test_a_clip_made_longer_keeps_its_name_and_its_sidecars_follow(monkeypatch, tmp_path):
    clips = tmp_path / "clips" / "job"
    clips.mkdir(parents=True)
    transcripts = tmp_path / "transcripts" / "job"
    transcripts.mkdir(parents=True)
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(clips))
    monkeypatch.setattr(clip_tools.paths, "WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setattr(vod_transcript, "transcript_dir", lambda job_id: str(transcripts))

    # The clip covers 100-106 s of the live; the streamer wants 3 s more before it
    _video(str(clips / "a.mp4"), 6)
    (clips / "a_meta.json").write_text(json.dumps({"vod_start": 100, "vod_end": 106}))
    (clips / "a_words.json").write_text(json.dumps([{"word": "Maurice", "start": 1.0, "end": 1.4, "speaker": "Falkarst"}]))
    (clips / "facecam.json").write_text(json.dumps({"version": 3, "rect": None, "frame_w": 320, "frame_h": 180, "people": {"a.mp4": [], "b.mp4": [[10, 10, 0.0]]}, "frames": {"a.mp4": [0.0]}}))
    # The live transcript has words there
    (transcripts / "chunk_000.json").write_text(json.dumps({
        "start": 0,
        "segments": [[97.2, 98.4, " attends regarde"]],
        "words": [{"word": "attends", "start": 97.2, "end": 97.7}, {"word": "regarde", "start": 97.8, "end": 98.4}],
    }))

    fetched = []

    def stream_copy(url, start, duration, out):
        fetched.append((url, start, duration))
        _video(out, duration)
        return True

    monkeypatch.setattr("app.services.clipper._streamcopy_clip", stream_copy)
    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", lambda url, **k: "https://vod/master.m3u8")
    monkeypatch.setattr(facecam_detector, "presence", lambda path: ([[160, 90, 4.0]], [0.0, 4.0, 8.0]))
    monkeypatch.setattr(clip_tools, "_label_speakers", lambda job_id, path, words: words)

    result = clip_tools.extend_clip("job", "a.mp4", "https://www.twitch.tv/videos/1", 97.0, 106.0)

    assert fetched == [("https://vod/master.m3u8", 97.0, 9.0)]
    assert result["added_before"] == 3.0 and 8.5 <= result["duration"] <= 9.5
    assert json.loads((clips / "a_meta.json").read_text()) == {"vod_start": 97.0, "vod_end": 106.0}
    assert 8.5 <= json.loads((clips / "a_probe.json").read_text())["duration"] <= 9.5
    words = json.loads((clips / "a_words.json").read_text())
    # The added words first, from the live transcript; the old ones 3 s later, speaker kept
    assert [(w["word"], w["start"]) for w in words] == [("attends", 0.2), ("regarde", 0.8), ("Maurice", 4.0)]
    assert words[-1]["speaker"] == "Falkarst"
    cam = json.loads((clips / "facecam.json").read_text())
    assert cam["people"]["a.mp4"] == [[160, 90, 4.0]] and cam["frames"]["a.mp4"] == [0.0, 4.0, 8.0]
    assert cam["people"]["b.mp4"] == [[10, 10, 0.0]]
    assert not (clips / "a.extending.mp4").exists()


def test_a_clip_that_cannot_be_fetched_stays_as_it_was(monkeypatch, tmp_path):
    clips = tmp_path / "clips"
    clips.mkdir()
    monkeypatch.setattr(clip_tools.paths, "clip_dir", lambda job_id: str(clips))
    _video(str(clips / "a.mp4"), 2)
    before = (clips / "a.mp4").read_bytes()
    monkeypatch.setattr("app.services.clipper._streamcopy_clip", lambda *a: False)
    monkeypatch.setattr("app.services.frame_extractor.get_vod_direct_url", lambda url, **k: "https://vod/master.m3u8")

    try:
        clip_tools.extend_clip("job", "a.mp4", "https://www.twitch.tv/videos/1", 70.0, 102.0)
        raise AssertionError("should have failed")
    except RuntimeError:
        pass
    assert (clips / "a.mp4").read_bytes() == before
