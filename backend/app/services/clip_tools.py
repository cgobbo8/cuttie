"""On-demand helpers for the clip editor (called through the worker HTTP server)."""

import json
import logging
import os
import re
import subprocess
import tempfile

from app.services import paths

logger = logging.getLogger(__name__)


def transcribe_clip_words(job_id: str, clip_filename: str) -> list[dict]:
    """Word-level transcription of a stored clip, with speaker labels when possible.

    Writes <clip>_words.json next to the clip and returns the words.
    """
    from app.services.subtitle_generator import transcribe_with_words

    clip_dir = paths.clip_dir(job_id)
    clip_path = os.path.join(clip_dir, clip_filename)
    if not os.path.isfile(clip_path):
        raise FileNotFoundError(clip_path)

    _, _, words = transcribe_with_words(clip_path)

    if words:
        try:
            words = _label_speakers(job_id, clip_path, words)
        except Exception as e:
            # Diarization is optional — keep plain Whisper words
            logger.warning(f"Diarization skipped for {clip_filename}: {e}")

        base = os.path.splitext(clip_filename)[0]
        with open(os.path.join(clip_dir, f"{base}_words.json"), "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False)

    return words


def _label_speakers(job_id: str, clip_path: str, words: list[dict]) -> list[dict]:
    import numpy as np

    from app.services.db import get_job
    from app.services.speaker_diarizer import (
        _load_wav,
        assign_speakers_to_words,
        diarize_waveform,
        identify_speakers,
    )

    fd, tmp_wav = tempfile.mkstemp(suffix=".wav", dir=paths.WORK_DIR)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", clip_path, "-vn", "-ac", "1", "-ar", "16000",
             "-loglevel", "error", tmp_wav],
            check=True, capture_output=True, timeout=30,
        )
        waveform, sr = _load_wav(tmp_wav)
    finally:
        os.remove(tmp_wav)

    voiceprint = None
    voiceprint_path = os.path.join(paths.clip_dir(job_id), "_voiceprint.npy")
    if os.path.isfile(voiceprint_path):
        voiceprint = np.load(voiceprint_path)

    segments = diarize_waveform(waveform, sr, voiceprint)
    if not segments:
        return words

    job = get_job(job_id)
    streamer_name = (job.streamer if job else None) or "Streamer"

    speaker_names = identify_speakers(waveform, sr, segments, voiceprint, streamer_name)
    return assign_speakers_to_words(words, segments, speaker_names)


def detect_job_facecam(job_id: str, clip_filenames: list[str]) -> dict | None:
    """Locate the webcam across stored clips and cache it in facecam.json.

    facecam.json also keeps where people stand along each clip (v3: with the
    time of each frame), so the API can check whether the cam is on screen in
    the part of a clip that gets exported.
    """
    from app.services.facecam_detector import analyze_clips

    clip_dir = paths.clip_dir(job_id)
    clip_paths = [
        os.path.join(clip_dir, os.path.basename(name))
        for name in clip_filenames
        if os.path.isfile(os.path.join(clip_dir, os.path.basename(name)))
    ]
    if not clip_paths:
        return None

    result = analyze_clips(clip_paths)
    with open(os.path.join(clip_dir, "facecam.json"), "w", encoding="utf-8") as f:
        json.dump({"version": 3, **result}, f)
    return result["rect"]


VOD_SAMPLES = 10
VOD_FRAME_WORKERS = 5


def detect_vod_facecam(vod_id: str, duration: float) -> dict:
    """Find the webcam on a Twitch VOD before any analysis (first launch).

    Frames are taken across the whole live, so game footage differs a lot
    from one to the next while the cam overlay stays put. The frame shown to
    the streamer is stored as brand/webcam_<vod_id>.jpg.
    """
    import shutil
    from concurrent.futures import ThreadPoolExecutor

    import cv2

    from app.services.facecam_detector import analyze_frames
    from app.services.frame_extractor import _extract_remote_frame, get_vod_direct_url

    direct_url = get_vod_direct_url(f"https://www.twitch.tv/videos/{vod_id}", max_height=1080)
    times = [duration * (0.08 + 0.84 * i / (VOD_SAMPLES - 1)) for i in range(VOD_SAMPLES)]

    os.makedirs(paths.WORK_DIR, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="webcam_", dir=paths.WORK_DIR)
    try:
        files = [os.path.join(tmp, f"frame_{i:02d}.jpg") for i in range(VOD_SAMPLES)]
        with ThreadPoolExecutor(max_workers=VOD_FRAME_WORKERS) as pool:
            ok = list(pool.map(lambda job: _extract_remote_frame(direct_url, *job), zip(times, files)))
        frames = [img for img in (cv2.imread(f) for f, good in zip(files, ok) if good) if img is not None]
        if len(frames) < 3:
            raise RuntimeError(f"only {len(frames)} frames read from the VOD")

        rect, shown = analyze_frames(frames)
        key = f"brand/webcam_{vod_id}.jpg"
        dest = paths.storage_path(key)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        cv2.imwrite(dest, frames[shown], [cv2.IMWRITE_JPEG_QUALITY, 88])
        height, width = frames[shown].shape[:2]
        logger.info(f"VOD {vod_id}: webcam {rect} on {len(frames)} frames")
        return {"facecam": rect, "frame_key": key, "frame_w": width, "frame_h": height}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ── A clip made longer (more before or after it, asked from the trim strip) ──

EXTEND_ATTEMPTS = 2


def extend_clip(job_id: str, clip_filename: str, vod_url: str, start: float, end: float) -> dict:
    """Extract a stored clip again over a wider part of the live (`start`-`end`, live seconds).

    The clip keeps its name and its sidecars follow: _meta.json (where it sits
    in the live), _probe.json, _words.json (the added part's words come from
    the live transcript, or that part alone is transcribed; speakers labelled
    again) and its cam check in facecam.json.
    """
    from app.services.clipper import _streamcopy_clip, cut_from_live
    from app.services.frame_extractor import get_vod_direct_url

    clip_dir = paths.clip_dir(job_id)
    clip_path = os.path.join(clip_dir, clip_filename)
    if not os.path.isfile(clip_path):
        raise FileNotFoundError(clip_path)
    base = os.path.splitext(clip_filename)[0]
    meta_path = os.path.join(clip_dir, f"{base}_meta.json")
    meta = _read_json(meta_path)
    meta = meta if isinstance(meta, dict) else {}
    old_start = float(meta.get("vod_start", start))
    old_end = float(meta.get("vod_end", end))
    # A clip cut before files were made to start on their first picture keeps its old clock
    # (what is timed on it was timed that way); the others start exactly where their meta says
    settled = bool(meta.get("settled"))

    tmp = os.path.join(clip_dir, f"{base}.extending.mp4")
    for _ in range(EXTEND_ATTEMPTS):
        direct = get_vod_direct_url(vod_url)
        if not direct:
            continue
        if settled:
            began = cut_from_live(direct, start, end - start, tmp)
        else:
            began = start if _streamcopy_clip(direct, start, end - start, tmp) else None
        if began is not None and _duration(tmp) >= (end - began) - 2:
            # One value for the meta, the words and what the app moves with them
            start = round(began, 2)
            break
    else:
        if os.path.isfile(tmp):
            os.remove(tmp)
        raise RuntimeError("the live's video could not be fetched")
    _replace(tmp, clip_path)

    places = 2 if settled else 1
    probe = _probe(clip_path)
    meta.update({"vod_start": round(start, places), "vod_end": round(end, 1)})
    _write_json(meta_path, meta)
    _write_json(os.path.join(clip_dir, f"{base}_probe.json"), probe)

    added_before = round(old_start - start, places)
    try:
        _extend_words(job_id, os.path.join(clip_dir, f"{base}_words.json"), clip_path, start, end, old_start, old_end)
    except Exception as e:
        logger.warning(f"Words of {clip_filename} not extended: {e}")
    try:
        _recheck_cam(job_id, clip_filename, clip_path)
    except Exception as e:
        logger.warning(f"Cam of {clip_filename} not checked again: {e}")
    logger.info(f"Clip {clip_filename} now {start:.1f}-{end:.1f} (was {old_start:.1f}-{old_end:.1f})")
    return {"vod_start": meta["vod_start"], "vod_end": meta["vod_end"], "duration": probe["duration"], "added_before": added_before}


RESTORE_WORKERS = 3
# What yt-dlp says about a VOD Twitch deleted (7 to 60 days after the live)
_GONE = ("does not exist", "404", "not available", "deleted", "private")


class LiveGone(Exception):
    """The live is no longer on Twitch: its clips can't be cut again."""


def restore_clips(job_id: str, vod_url: str, clips: list[dict]) -> dict:
    """Cut a project's clips again from the live, at the same places (`clips`:
    filename, start, end in live seconds), after they were deleted to free disk
    space. Their sidecars stayed: same words, same cam, same thumbnails."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    from app.services.clipper import _streamcopy_clip

    direct = _live_url(vod_url)

    clip_dir = paths.clip_dir(job_id)
    os.makedirs(clip_dir, exist_ok=True)
    t0 = time.time()

    def restore(clip: dict) -> bool:
        name = os.path.basename(clip["filename"])
        start, end = float(clip["start"]), float(clip["end"])
        target = os.path.join(clip_dir, name)
        if os.path.isfile(target):
            return True
        tmp = os.path.join(clip_dir, f"{os.path.splitext(name)[0]}.restoring.mp4")
        if _streamcopy_clip(direct, start, end - start, tmp) and _duration(tmp) >= (end - start) - 2:
            _replace(tmp, target)
            return True
        if os.path.isfile(tmp):
            os.remove(tmp)
        return False

    with ThreadPoolExecutor(RESTORE_WORKERS) as pool:
        done = list(pool.map(restore, clips))
    restored = [os.path.basename(c["filename"]) for c, ok in zip(clips, done) if ok]
    failed = [os.path.basename(c["filename"]) for c, ok in zip(clips, done) if not ok]
    logger.info(f"[{job_id[:8]}] Clips cut again from the live: {len(restored)}/{len(clips)} in {time.time() - t0:.0f} s")
    return {"restored": restored, "failed": failed}


# ── Pieces of the live for a compilation (found by searching it) ─────────────

PIECE_WORKERS = 3
_PIECE_ID = re.compile(r"^[a-z0-9]{6,24}$")


def piece_filename(piece_id: str) -> str:
    return f"piece_{piece_id}.mp4"


# A piece's clip is a little wider than its moment, so its cut can move without fetching again:
# at least this much on each side, and after it up to this much when the live's segments already
# fetched give it (the live comes in 10 s segments, each several MB: one less to fetch is seconds
# saved). Before it, the clip starts where its first segment does: a copy can only begin on a key
# frame, and a segment's start is the one place where there is one for sure.
PIECE_MARGIN_MIN = 0.6
PIECE_MARGIN_MAX = 8.0
# Without the live's segments, ffmpeg seeks by itself and starts on the next key frame: room for one before the moment
PIECE_SEEK_MARGIN = 5.0
# Where a live's video is read from, kept a few minutes: asking Twitch takes a second or two each time
_LIVE_TTL = 600.0
_lives: dict[str, tuple[float, str, list | None]] = {}


def extract_pieces(job_id: str, vod_url: str, pieces: list[dict]) -> dict:
    """Cut moments of the live (`pieces`: id, start, end in live seconds) into small
    clips next to the analysis' ones: piece_<id>.mp4 with the same sidecars
    (_meta, _probe, _words, cam check), so they edit and export like any clip.
    Each clip is a little wider than its moment; one that already covers its
    moment is left alone.

    A piece with `fit` ([start, end] in live seconds: the lines of the live's
    transcript it is made of) also gets `tight`: where those words are really
    said, from the clip's timed words and its sound (None when they are not found)."""
    import time
    from concurrent.futures import ThreadPoolExecutor

    clip_dir = paths.clip_dir(job_id)
    os.makedirs(clip_dir, exist_ok=True)
    wanted = [p for p in pieces if _PIECE_ID.match(str(p.get("id", ""))) and float(p["end"]) - float(p["start"]) >= 0.3]
    todo = [p for p in wanted if not _piece_ready(clip_dir, p)]
    t0 = time.time()
    direct, segments = _live(vod_url) if todo else (None, None)

    def extract(piece: dict) -> bool:
        name = piece_filename(piece["id"])
        base = os.path.splitext(name)[0]
        target = os.path.join(clip_dir, name)
        tmp = os.path.join(clip_dir, f"{base}.cutting.mp4")
        bounds = _cut_part(direct, segments, float(piece["start"]), float(piece["end"]), tmp)
        if not bounds:
            if os.path.isfile(tmp):
                os.remove(tmp)
            return False
        start, end = bounds
        _replace(tmp, target)
        # "settled": the file starts on its first picture, at vod_start exactly (words and cuts are timed on it)
        _write_json(os.path.join(clip_dir, f"{base}_meta.json"), {"vod_start": round(start, 2), "vod_end": round(end, 2), "settled": True})
        _write_json(os.path.join(clip_dir, f"{base}_probe.json"), _probe(target))
        try:
            words = sorted(_words_between(job_id, target, start, start, end), key=lambda w: w["start"])
            try:
                words = _label_speakers(job_id, target, words) if words else words
            except Exception as e:
                logger.warning(f"Speakers not labelled on {name}: {e}")
            _write_json(os.path.join(clip_dir, f"{base}_words.json"), words)
        except Exception as e:
            # The editor transcribes it when the piece opens
            logger.warning(f"Words of {name} not ready: {e}")
        try:
            _recheck_cam(job_id, name, target)
        except Exception as e:
            logger.warning(f"Cam of {name} not checked: {e}")
        return True

    done: dict[str, bool] = {}
    if todo:
        with ThreadPoolExecutor(PIECE_WORKERS) as pool:
            done = dict(zip([p["id"] for p in todo], pool.map(extract, todo)))
        logger.info(f"[{job_id[:8]}] Pieces of the live: {sum(done.values())}/{len(todo)} cut in {time.time() - t0:.0f} s")
    ready = []
    transcript = None
    for p in wanted:
        if done.get(p["id"], True):
            base = os.path.splitext(piece_filename(p["id"]))[0]
            meta = _read_json(os.path.join(clip_dir, f"{base}_meta.json")) or {}
            piece = {
                "id": p["id"],
                "file": piece_filename(p["id"]),
                "vod_start": meta.get("vod_start", p["start"]),
                "vod_end": meta.get("vod_end", p["end"]),
                "duration": _duration(os.path.join(clip_dir, piece_filename(p["id"]))),
            }
            if p.get("fit"):
                if transcript is None:
                    from app.services.vod_transcript import load_cached

                    transcript = load_cached(job_id) or False
                try:
                    piece["tight"] = _tight(transcript, os.path.join(clip_dir, piece["file"]), _read_json(os.path.join(clip_dir, f"{base}_words.json")), piece, p["fit"])
                except Exception as e:
                    # The passage keeps its rough cut: never a reason to fail the piece
                    logger.warning(f"Piece {p['id']} not cut on its words: {type(e).__name__}: {e}")
                    piece["tight"] = None
            ready.append(piece)
    fitted = [p for p in ready if p.get("tight")]
    if fitted:
        # What each passage lasted as the transcript's lines gave it, and once cut on its words
        fits = {p["id"]: p["fit"] for p in pieces if p.get("fit") and len(p["fit"]) == 2}
        cuts = ", ".join(f"{float(fits[p['id']][1]) - float(fits[p['id']][0]):.1f} -> {p['tight'][1] - p['tight'][0]:.1f} s" for p in fitted if p["id"] in fits)
        logger.info(f"[{job_id[:8]}] Pieces cut on their words: {len(fitted)}/{sum(1 for p in ready if 'tight' in p)} ({cuts})")
    return {"pieces": ready, "failed": [p["id"] for p in wanted if not done.get(p["id"], True)]}


def _tight(transcript, clip_path: str, words, piece: dict, fit: list) -> list[float] | None:
    """Where the passage `fit` (live seconds, as the live's transcript has it) is really said
    in its clip: [start, end] in live seconds, None when its words are not found there."""
    from app.services import tight_cut

    if not transcript or not isinstance(words, list) or not words or len(fit) != 2:
        return None
    a, b = float(fit[0]), float(fit[1])
    text = tight_cut.passage_text(transcript, a, b)
    if not text:
        return None
    at = float(piece["vod_start"])
    found = tight_cut.fit(words, text, a - at, b - at, tight_cut.envelope(clip_path), piece.get("duration") or None)
    return [round(at + found[0], 2), round(at + found[1], 2)] if found else None


def _live(vod_url: str) -> tuple[str, list[tuple[float, float, str]] | None]:
    """Where the live's video is read from and its segments, asked once every few minutes."""
    import time

    known = _lives.get(vod_url)
    if known and time.time() - known[0] < _LIVE_TTL:
        return known[1], known[2]
    direct = _live_url(vod_url)
    segments = _live_segments(direct)
    _lives[vod_url] = (time.time(), direct, segments)
    return direct, segments


def _live_segments(direct_url: str) -> list[tuple[float, float, str]] | None:
    """The live's video as its playlist lists it: (start, length, url) of each segment.
    None when the playlist isn't a plain list of segments (ffmpeg then reads it itself)."""
    from urllib.parse import urljoin

    import requests

    try:
        text = requests.get(direct_url, timeout=20).text
    except requests.RequestException:
        return None
    if "#EXTINF" not in text or "#EXT-X-MAP" in text or "#EXT-X-KEY" in text or "#EXT-X-BYTERANGE" in text:
        return None
    segments: list[tuple[float, float, str]] = []
    at = 0.0
    length: float | None = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("#EXTINF:"):
            try:
                length = float(line[8:].split(",")[0])
            except ValueError:
                return None
        elif line.startswith("#EXT-X-DISCONTINUITY"):
            # Times after it can't be trusted from the lengths alone
            return None
        elif line and not line.startswith("#") and length is not None:
            segments.append((at, length, urljoin(direct_url, line)))
            at += length
            length = None
    return segments or None


def piece_bounds(segments: list[tuple[float, float, str]] | None, start: float, end: float) -> tuple[float, float, int, int]:
    """The part of the live a moment's clip covers, and the segments it reads
    (first index, one past the last): from the start of the segment that holds
    the moment's beginning (and PIECE_MARGIN_MIN before it), to the moment's end
    with at least PIECE_MARGIN_MIN after it, widened up to PIECE_MARGIN_MAX with
    what the last segment holds anyway (segments come whole, 10 s each: the room
    is free)."""
    low, high = max(0.0, start - PIECE_MARGIN_MIN), end + PIECE_MARGIN_MIN
    if not segments:
        # ffmpeg will seek by itself: it starts on the first key frame after where it is asked
        return max(0.0, start - PIECE_SEEK_MARGIN), high, 0, 0
    live_end = segments[-1][0] + segments[-1][1]
    high = min(high, live_end)
    first = next((i for i, (at, length, _u) in enumerate(segments) if at + length > low), len(segments) - 1)
    last = next((i for i in range(len(segments) - 1, -1, -1) if segments[i][0] < high), first)
    held_to = segments[last][0] + segments[last][1]
    return segments[first][0], min(held_to, end + PIECE_MARGIN_MAX, live_end), first, last + 1


def _cut_part(direct_url: str, segments: list[tuple[float, float, str]] | None, start: float, end: float, out: str) -> tuple[float, float] | None:
    """Cut the moment `start`-`end` of the live (and room around it) into `out` without re-encoding.
    Returns the part of the live the file covers (it starts on its first picture, at the first
    second returned), None when it couldn't be fetched."""
    from app.services.clipper import cut_from_live, settle_start

    low, high, first, stop = piece_bounds(segments, start, end)
    if segments and stop > first:
        # Only the segments needed, in a playlist of their own, read from its very first picture:
        # ffmpeg doesn't read the live's first segment to know the streams, nor more of the live
        # than the piece, and without a seek the file starts exactly where the first segment does
        part = segments[first:stop]
        playlist = f"{out}.m3u8"
        lines = ["#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{int(max(length for _a, length, _u in part)) + 1}", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"]
        for _at, length, url in part:
            lines += [f"#EXTINF:{length:.3f},", url]
        lines.append("#EXT-X-ENDLIST")
        try:
            with open(playlist, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            subprocess.run(
                ["ffmpeg", "-y", "-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-i", playlist,
                 "-t", f"{high - low:.3f}", "-c", "copy", "-movflags", "+faststart", out],
                check=True, timeout=120, capture_output=True, text=True,
            )
            # A segment that doesn't begin on a key frame after all: the file starts on its first one
            low += settle_start(out)
            if low <= start and _duration(out) >= (high - low) - 2:
                return low, high
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as e:
            logger.warning(f"Piece {start:.0f}-{end:.0f} s not cut from its segments ({type(e).__name__}): reading the live's playlist instead")
        finally:
            if os.path.isfile(playlist):
                os.remove(playlist)
    low = max(0.0, min(low, start - PIECE_SEEK_MARGIN))
    began = cut_from_live(direct_url, low, high - low, out)
    if began is not None and began <= start and _duration(out) >= (high - began) - 2:
        return began, high
    return None


def _piece_ready(clip_dir: str, piece: dict) -> bool:
    """The piece's clip is there, covers its moment and starts on its first picture (one cut
    before that was made sure of is cut again: its words and its picture were up to 2 s apart)."""
    base = os.path.splitext(piece_filename(piece["id"]))[0]
    meta = _read_json(os.path.join(clip_dir, f"{base}_meta.json"))
    return (
        os.path.isfile(os.path.join(clip_dir, f"{base}.mp4"))
        and isinstance(meta, dict)
        and bool(meta.get("settled"))
        and float(meta.get("vod_start", 1e12)) <= float(piece["start"]) + 0.05
        and float(meta.get("vod_end", -1)) >= float(piece["end"]) - 0.05
    )


def _live_url(vod_url: str) -> str:
    """Where the live's video is read from; LiveGone when Twitch no longer has it."""
    from app.services.frame_extractor import get_vod_direct_url

    try:
        return get_vod_direct_url(vod_url)
    except subprocess.CalledProcessError as e:
        said = f"{e.stderr or ''} {e.stdout or ''}".lower()
        if any(word in said for word in _GONE):
            raise LiveGone(vod_url) from e
        raise RuntimeError("the live's video could not be fetched") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("the live's video could not be fetched") from e


def _extend_words(job_id: str, words_path: str, clip_path: str, start: float, end: float, old_start: float, old_end: float) -> None:
    """Shift the clip's words to its new start and add the words of the added parts."""
    old = _read_json(words_path)
    if not isinstance(old, list):
        return  # never transcribed: the editor does it when the clip opens
    shift = old_start - start
    words = [{**w, "start": round(w["start"] + shift, 3), "end": round(w["end"] + shift, 3)} for w in old]
    for a, b in ((start, old_start), (old_end, end)):
        if b - a > 0.5:
            words += _words_between(job_id, clip_path, start, a, b)
    words.sort(key=lambda w: w["start"])
    try:
        words = _label_speakers(job_id, clip_path, words)
    except Exception as e:
        logger.warning(f"Speakers not labelled again on {os.path.basename(clip_path)}: {e}")
    _write_json(words_path, words)


def _words_between(job_id: str, clip_path: str, clip_start: float, a: float, b: float) -> list[dict]:
    """Words said between `a` and `b` (live seconds), in clip seconds: from the live transcript, else transcribed."""
    from app.services.vod_transcript import cached_words

    live = cached_words(job_id, a, b)
    if live is not None:
        return [{"word": w["word"], "start": round(w["start"] - clip_start, 3), "end": round(w["end"] - clip_start, 3)} for w in live]

    from app.services.llm_analyzer import _transcribe_audio

    os.makedirs(paths.WORK_DIR, exist_ok=True)
    fd, audio = tempfile.mkstemp(suffix=".mp3", dir=paths.WORK_DIR)
    os.close(fd)
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-ss", str(a - clip_start), "-t", str(b - a), "-i", clip_path,
             "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-loglevel", "error", audio],
            check=True, capture_output=True, timeout=60,
        )
        _text, _rate, _segments, words = _transcribe_audio(audio)
    finally:
        os.remove(audio)
    offset = a - clip_start
    return [{"word": w["word"], "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)} for w in words]


def _recheck_cam(job_id: str, clip_filename: str, clip_path: str) -> None:
    """Who stands where along the new clip, in facecam.json (the API judges the cam from it)."""
    from app.services.facecam_detector import presence

    path = os.path.join(paths.clip_dir(job_id), "facecam.json")
    data = _read_json(path)
    if not isinstance(data, dict) or data.get("version") not in (2, 3):
        return
    seen = presence(clip_path)
    if not seen:
        return
    data.setdefault("people", {})[clip_filename], data.setdefault("frames", {})[clip_filename] = seen
    data["version"] = 3
    _write_json(path, data)


def _probe(path: str) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", "-select_streams", "v:0", "-show_format", path],
        capture_output=True, text=True, timeout=15,
    )
    data = json.loads(result.stdout or "{}")
    stream = (data.get("streams") or [{}])[0]
    return {
        "width": stream.get("width", 1920),
        "height": stream.get("height", 1080),
        "duration": round(float((data.get("format") or {}).get("duration", stream.get("duration", 0)) or 0), 3),
    }


def _duration(path: str) -> float:
    return _probe(path)["duration"] if os.path.isfile(path) else 0.0


def _replace(src: str, dst: str, attempts: int = 10) -> None:
    """os.replace, waiting a little when a reader still holds the old file (Windows)."""
    import time

    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.5)


def _read_json(path: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
