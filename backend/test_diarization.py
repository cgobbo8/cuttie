#!/usr/bin/env python3
"""Speaker diarization POC — tests pyannote + ECAPA-TDNN on local clips.

Combines pyannote diarization with Groq Whisper transcription to produce
speaker-labeled transcripts. Also tests voiceprint extraction for
identifying the streamer across clips.

Usage:
    uv run python test_diarization.py <job_id_prefix> [options]
    uv run python test_diarization.py clips/path/to/clip.mp4 [options]

Examples:
    uv run python test_diarization.py 07e5907a --max-clips 3
    uv run python test_diarization.py 07e5907a --voiceprint --whisper
    uv run python test_diarization.py clips/07e5907a*/clip_01.mp4 --whisper
"""

import argparse
import glob
import json
import os
import subprocess
import sys
import time
from collections import defaultdict

import numpy as np
import torch
import torchaudio

# ─── Colors ──────────────────────────────────────────────────────────────────

COLORS = {
    "SPEAKER_00": "\033[96m",   # cyan
    "SPEAKER_01": "\033[93m",   # yellow
    "SPEAKER_02": "\033[95m",   # magenta
    "SPEAKER_03": "\033[92m",   # green
    "SPEAKER_04": "\033[91m",   # red
}
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"


def color_speaker(speaker: str) -> str:
    c = COLORS.get(speaker, "\033[97m")
    return f"{c}{speaker}{RESET}"


# ─── Audio utils ─────────────────────────────────────────────────────────────

def extract_wav(video_path: str, output_path: str, sr: int = 16000) -> bool:
    """Extract mono WAV at given sample rate from video."""
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", str(sr),
             "-loglevel", "error", output_path],
            check=True, capture_output=True, timeout=30,
        )
        return os.path.isfile(output_path)
    except Exception as e:
        print(f"  {RED}FFmpeg error: {e}{RESET}")
        return False


def extract_mp3(video_path: str, output_path: str) -> bool:
    """Extract MP3 for Whisper API."""
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", video_path, "-vn", "-c:a", "libmp3lame",
             "-b:a", "64k", "-loglevel", "error", output_path],
            check=True, capture_output=True, timeout=30,
        )
        return os.path.isfile(output_path)
    except Exception as e:
        print(f"  {RED}FFmpeg error: {e}{RESET}")
        return False


def get_duration(path: str) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", path],
        capture_output=True, text=True,
    )
    return float(r.stdout.strip()) if r.stdout.strip() else 0


def fmt(seconds: float) -> str:
    m, s = divmod(seconds, 60)
    return f"{int(m):02d}:{s:05.2f}"


# ─── Diarization ─────────────────────────────────────────────────────────────

_pipeline = None  # Cached pipeline


def get_pipeline(device: str):
    """Load pyannote pipeline (cached across calls)."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    from pyannote.audio import Pipeline

    print(f"\n{BOLD}Loading pyannote community-1...{RESET}")
    t0 = time.time()
    _pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1")

    if device == "mps" and torch.backends.mps.is_available():
        _pipeline.to(torch.device("mps"))
        print(f"  {GREEN}✓ MPS (Apple Silicon GPU){RESET} — loaded in {time.time()-t0:.1f}s")
    elif device == "cuda" and torch.cuda.is_available():
        _pipeline.to(torch.device("cuda"))
        print(f"  {GREEN}✓ CUDA GPU{RESET} — loaded in {time.time()-t0:.1f}s")
    else:
        print(f"  {YELLOW}⚠ CPU mode (slower){RESET} — loaded in {time.time()-t0:.1f}s")

    return _pipeline


def run_diarization(wav_path: str, device: str) -> tuple[list[dict], float]:
    """Run diarization on WAV file.

    Returns (segments, elapsed_seconds) where segments = [{"speaker", "start", "end"}].
    Uses exclusive_speaker_diarization (no overlapping speech) for cleaner
    transcript assignment.
    """
    pipeline = get_pipeline(device)
    t0 = time.time()
    output = pipeline(wav_path)
    elapsed = time.time() - t0

    # pyannote 4.x returns DiarizeOutput with .speaker_diarization and
    # .exclusive_speaker_diarization attributes (Annotation objects).
    # Use exclusive (non-overlapping) for transcript word assignment.
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        # Fallback: maybe it's already an Annotation (pyannote 3.x compat)
        annotation = getattr(output, "speaker_diarization", output)

    segments = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        segments.append({"speaker": speaker, "start": turn.start, "end": turn.end})

    return segments, elapsed


# ─── Whisper transcription (via Groq) ────────────────────────────────────────

def transcribe_whisper(mp3_path: str) -> list[dict]:
    """Transcribe with Groq Whisper, returning word-level timestamps.

    Returns [{"word", "start", "end"}].
    """
    from openai import OpenAI

    client = OpenAI(
        api_key=os.getenv("GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
    )

    with open(mp3_path, "rb") as f:
        result = client.audio.transcriptions.create(
            model="whisper-large-v3-turbo",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["word"],
        )

    words = []
    if hasattr(result, "words") and result.words:
        for w in result.words:
            words.append({"word": w.word, "start": w.start, "end": w.end})
    return words


# ─── Speaker assignment ──────────────────────────────────────────────────────

def assign_speakers_to_words(
    words: list[dict], diarize_segments: list[dict],
) -> list[dict]:
    """Assign a speaker to each Whisper word based on diarization timestamps.

    Uses temporal overlap: each word gets the speaker with the most overlapping
    diarization time.
    """
    labeled = []
    for w in words:
        w_start, w_end = w["start"], w["end"]
        best_speaker = "?"
        best_overlap = 0

        for seg in diarize_segments:
            overlap_start = max(w_start, seg["start"])
            overlap_end = min(w_end, seg["end"])
            overlap = max(0, overlap_end - overlap_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = seg["speaker"]

        labeled.append({**w, "speaker": best_speaker})
    return labeled


def format_speaker_transcript(labeled_words: list[dict], speaker_names: dict[str, str]) -> str:
    """Format labeled words into a readable speaker-annotated transcript.

    Groups consecutive words by the same speaker into lines.
    """
    if not labeled_words:
        return "  (no speech detected)"

    lines = []
    current_speaker = None
    current_words = []
    current_start = 0

    for w in labeled_words:
        if w["speaker"] != current_speaker:
            if current_words:
                name = speaker_names.get(current_speaker, current_speaker)
                text = " ".join(current_words)
                lines.append((current_start, current_speaker, name, text))
            current_speaker = w["speaker"]
            current_words = [w["word"]]
            current_start = w["start"]
        else:
            current_words.append(w["word"])

    # Flush last group
    if current_words:
        name = speaker_names.get(current_speaker, current_speaker)
        lines.append((current_start, current_speaker, name, " ".join(current_words)))

    output = []
    for start, spk_id, name, text in lines:
        c = COLORS.get(spk_id, "\033[97m")
        output.append(f"  {DIM}[{fmt(start)}]{RESET} {c}{BOLD}{name}{RESET}: {text}")
    return "\n".join(output)


# ─── Voiceprint (ECAPA-TDNN) ─────────────────────────────────────────────────

_classifier = None


def get_classifier():
    """Load ECAPA-TDNN classifier (cached)."""
    global _classifier
    if _classifier is not None:
        return _classifier

    from speechbrain.inference.speaker import EncoderClassifier
    print(f"  Loading ECAPA-TDNN...")
    # SpeechBrain + MPS can be flaky, use CPU for embeddings (fast enough)
    _classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"},
    )
    return _classifier


def extract_voiceprint(
    wav_path: str, segments: list[dict], speaker_id: str,
) -> np.ndarray | None:
    """Extract ECAPA-TDNN embedding for a speaker from their diarized segments."""
    waveform, sr = torchaudio.load(wav_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000

    chunks = []
    total = 0.0
    for seg in segments:
        if seg["speaker"] != speaker_id:
            continue
        s, e = int(seg["start"] * sr), int(seg["end"] * sr)
        chunks.append(waveform[:, s:e])
        total += seg["end"] - seg["start"]
        if total >= 30:
            break

    if not chunks or total < 2:
        return None

    audio = torch.cat(chunks, dim=1)
    classifier = get_classifier()
    embedding = classifier.encode_batch(audio)
    return embedding.squeeze().cpu().numpy()


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def identify_speakers(
    wav_path: str, segments: list[dict], speakers: list[dict],
    ref_embedding: np.ndarray, ref_name: str, threshold: float = 0.70,
) -> dict[str, str]:
    """Match speakers against a reference voiceprint.

    Returns {speaker_id: display_name}.
    """
    waveform, sr = torchaudio.load(wav_path)
    if sr != 16000:
        waveform = torchaudio.functional.resample(waveform, sr, 16000)
        sr = 16000

    classifier = get_classifier()
    names: dict[str, str] = {}

    for spk in speakers:
        spk_id = spk["id"]
        chunks = []
        total = 0.0
        for seg in segments:
            if seg["speaker"] != spk_id:
                continue
            s, e = int(seg["start"] * sr), int(seg["end"] * sr)
            chunks.append(waveform[:, s:e])
            total += seg["end"] - seg["start"]
            if total >= 15:
                break

        if not chunks or total < 1:
            names[spk_id] = spk_id
            continue

        audio = torch.cat(chunks, dim=1)
        emb = classifier.encode_batch(audio).squeeze().cpu().numpy()
        sim = cosine_similarity(ref_embedding, emb)

        if sim >= threshold:
            names[spk_id] = f"🎙 {ref_name}"
            spk["similarity"] = sim
            spk["identified"] = True
        else:
            names[spk_id] = spk_id
            spk["similarity"] = sim
            spk["identified"] = False

    return names


# ─── Analysis helpers ────────────────────────────────────────────────────────

def compute_speaker_stats(segments: list[dict], duration: float) -> list[dict]:
    """Compute per-speaker statistics from diarization segments."""
    stats: dict[str, dict] = {}
    for seg in segments:
        spk = seg["speaker"]
        dur = seg["end"] - seg["start"]
        if spk not in stats:
            stats[spk] = {"id": spk, "total_duration": 0, "segment_count": 0}
        stats[spk]["total_duration"] += dur
        stats[spk]["segment_count"] += 1

    result = sorted(stats.values(), key=lambda x: -x["total_duration"])
    for s in result:
        s["total_duration"] = round(s["total_duration"], 2)
        s["pct"] = round(s["total_duration"] / duration * 100, 1) if duration > 0 else 0
    return result


# ─── Main ────────────────────────────────────────────────────────────────────

def process_clip(
    clip_path: str, device: str, do_whisper: bool, do_voiceprint: bool,
    ref_embedding: np.ndarray | None, streamer_name: str,
) -> dict:
    """Process a single clip: diarize, optionally transcribe, optionally identify."""
    basename = os.path.basename(clip_path)
    duration = get_duration(clip_path)

    print(f"\n{'─'*70}")
    print(f"  {BOLD}{basename}{RESET}  ({duration:.1f}s)")
    print(f"{'─'*70}")

    # Extract WAV for diarization
    wav_path = clip_path.rsplit(".", 1)[0] + "_diarize.wav"
    if not extract_wav(clip_path, wav_path):
        return {"clip": basename, "error": "ffmpeg failed"}

    # 1. Diarization
    print(f"  {DIM}Running diarization...{RESET}")
    segments, elapsed = run_diarization(wav_path, device)
    speakers = compute_speaker_stats(segments, duration)

    print(f"  {GREEN}✓ Diarization{RESET} in {elapsed:.2f}s "
          f"(RTF: {elapsed/duration:.3f}x, {duration/elapsed:.0f}x real-time)")
    print(f"  Speakers: {len(speakers)}")
    for s in speakers:
        bar_len = int(s["pct"] / 2)
        bar = "█" * bar_len + "░" * (50 - bar_len)
        print(f"    {color_speaker(s['id'])} {bar} {s['total_duration']:.1f}s ({s['pct']}%) "
              f"— {s['segment_count']} segments")

    # 2. Speaker identification (voiceprint matching)
    speaker_names: dict[str, str] = {s["id"]: s["id"] for s in speakers}

    if do_voiceprint and ref_embedding is not None and len(speakers) > 0:
        print(f"\n  {DIM}Matching voiceprints...{RESET}")
        speaker_names = identify_speakers(
            wav_path, segments, speakers, ref_embedding, streamer_name,
        )
        for s in speakers:
            sim = s.get("similarity", None)
            identified = s.get("identified", False)
            name = speaker_names.get(s["id"], s["id"])
            if sim is not None:
                icon = f"{GREEN}✓{RESET}" if identified else f"{DIM}✗{RESET}"
                print(f"    {icon} {color_speaker(s['id'])} → {BOLD}{name}{RESET} "
                      f"(similarity: {sim:.4f})")

    # 3. Speaker timeline
    print(f"\n  {BOLD}Timeline:{RESET}")
    for seg in segments[:30]:  # limit to first 30 segments for readability
        dur = seg["end"] - seg["start"]
        name = speaker_names.get(seg["speaker"], seg["speaker"])
        c = COLORS.get(seg["speaker"], "\033[97m")
        bar = "▓" * max(1, int(dur * 2))
        print(f"    {DIM}[{fmt(seg['start'])} → {fmt(seg['end'])}]{RESET} "
              f"{c}{name:15s}{RESET} {bar} {dur:.1f}s")
    if len(segments) > 30:
        print(f"    {DIM}... ({len(segments) - 30} more segments){RESET}")

    # 4. Whisper + speaker assignment
    words = []
    if do_whisper:
        mp3_path = clip_path.rsplit(".", 1)[0] + "_diarize.mp3"
        if extract_mp3(clip_path, mp3_path):
            print(f"\n  {DIM}Transcribing with Whisper (Groq)...{RESET}")
            t0 = time.time()
            words = transcribe_whisper(mp3_path)
            whisper_elapsed = time.time() - t0
            print(f"  {GREEN}✓ Whisper{RESET} in {whisper_elapsed:.1f}s — {len(words)} words")

            # Assign speakers to words
            labeled = assign_speakers_to_words(words, segments)

            print(f"\n  {BOLD}Speaker-labeled transcript:{RESET}")
            print(format_speaker_transcript(labeled, speaker_names))

            try:
                os.remove(mp3_path)
            except OSError:
                pass

    # Cleanup
    try:
        os.remove(wav_path)
    except OSError:
        pass

    return {
        "clip": basename,
        "duration": round(duration, 1),
        "diarize_time": round(elapsed, 3),
        "speakers": speakers,
        "segment_count": len(segments),
        "word_count": len(words),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Test speaker diarization on Cuttie clips",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  uv run python test_diarization.py 07e5907a --max-clips 3
  uv run python test_diarization.py 07e5907a --voiceprint --whisper
  uv run python test_diarization.py clips/07e5907a*/clip_01.mp4 --whisper
        """,
    )
    parser.add_argument("path", help="Job ID prefix or path to a clip MP4")
    parser.add_argument("--device", default="mps", choices=["mps", "cpu", "cuda"],
                        help="Compute device (default: mps)")
    parser.add_argument("--max-clips", type=int, default=5,
                        help="Max clips to test per job (default: 5)")
    parser.add_argument("--whisper", action="store_true",
                        help="Also run Whisper transcription and produce speaker-labeled transcript")
    parser.add_argument("--voiceprint", action="store_true",
                        help="Extract streamer voiceprint from first clip and match across others")
    parser.add_argument("--streamer", default=None,
                        help="Streamer name for voiceprint labeling (auto-detected from DB if omitted)")
    parser.add_argument("--threshold", type=float, default=0.70,
                        help="Cosine similarity threshold for voiceprint matching (default: 0.70)")
    args = parser.parse_args()

    # ── Resolve clips ──
    clips: list[str] = []
    if os.path.isfile(args.path):
        clips = [args.path]
    else:
        # Try as job ID prefix
        job_dirs = sorted(glob.glob(f"clips/{args.path}*"))
        if job_dirs:
            job_dir = job_dirs[0]
            all_mp4s = sorted(glob.glob(f"{job_dir}/*.mp4"))
            clips = all_mp4s[:args.max_clips]
            print(f"Found {len(all_mp4s)} clips in {os.path.basename(job_dir)}, testing {len(clips)}")
        else:
            print(f"{RED}No file or job found for: {args.path}{RESET}")
            sys.exit(1)

    if not clips:
        print(f"{RED}No clips to test{RESET}")
        sys.exit(1)

    # ── Detect streamer name from DB ──
    streamer_name = args.streamer
    if not streamer_name:
        try:
            import sqlite3
            conn = sqlite3.connect("cuttie.db")
            conn.row_factory = sqlite3.Row
            job_dir_name = os.path.basename(os.path.dirname(clips[0]))
            row = conn.execute(
                "SELECT streamer FROM jobs WHERE job_id = ?", (job_dir_name,)
            ).fetchone()
            if row and row["streamer"]:
                streamer_name = row["streamer"]
            conn.close()
        except Exception:
            pass
    if not streamer_name:
        streamer_name = "Streamer"

    # ── Print config ──
    print(f"\n{'═'*70}")
    print(f"  {BOLD}SPEAKER DIARIZATION TEST{RESET}")
    print(f"{'═'*70}")
    print(f"  Device:      {BOLD}{args.device}{RESET}"
          f"{'  (MPS available: ' + str(torch.backends.mps.is_available()) + ')' if args.device == 'mps' else ''}")
    print(f"  Clips:       {len(clips)}")
    print(f"  Streamer:    {BOLD}{streamer_name}{RESET}")
    print(f"  Whisper:     {'✓' if args.whisper else '✗'}")
    print(f"  Voiceprint:  {'✓' if args.voiceprint else '✗'}"
          f"{'  (threshold: ' + str(args.threshold) + ')' if args.voiceprint else ''}")
    if args.whisper and not os.getenv("GROQ_API_KEY"):
        print(f"\n  {RED}⚠ GROQ_API_KEY not set — Whisper transcription will fail{RESET}")
        print(f"  {DIM}Set it in your .env or export GROQ_API_KEY=...{RESET}")

    # ── Load env vars ──
    if args.whisper:
        from dotenv import load_dotenv
        load_dotenv()

    # ── Process clips ──
    ref_embedding: np.ndarray | None = None
    results: list[dict] = []

    for i, clip_path in enumerate(clips):
        result = process_clip(
            clip_path, args.device, args.whisper, args.voiceprint,
            ref_embedding, streamer_name,
        )
        results.append(result)

        # Extract voiceprint from first clip's dominant speaker
        if args.voiceprint and ref_embedding is None and result.get("speakers"):
            dominant = result["speakers"][0]["id"]
            wav_path = clip_path.rsplit(".", 1)[0] + "_diarize.wav"

            # Re-extract WAV for voiceprint (was cleaned up)
            if extract_wav(clip_path, wav_path):
                diarize_segs, _ = run_diarization(wav_path, args.device)
                print(f"\n  {BOLD}Extracting reference voiceprint from {dominant}...{RESET}")
                ref_embedding = extract_voiceprint(wav_path, diarize_segs, dominant)
                if ref_embedding is not None:
                    print(f"  {GREEN}✓ Voiceprint extracted{RESET} "
                          f"({ref_embedding.shape[0]}-dim ECAPA-TDNN embedding)")
                    print(f"  {DIM}Assuming {dominant} = {streamer_name} "
                          f"(dominant speaker in first clip){RESET}")
                else:
                    print(f"  {RED}✗ Not enough audio for voiceprint{RESET}")
                try:
                    os.remove(wav_path)
                except OSError:
                    pass

    # ── Summary ──
    print(f"\n{'═'*70}")
    print(f"  {BOLD}SUMMARY{RESET}")
    print(f"{'═'*70}")

    valid = [r for r in results if "error" not in r]
    if not valid:
        print(f"  {RED}All clips failed{RESET}")
        return

    total_audio = sum(r["duration"] for r in valid)
    total_diarize = sum(r["diarize_time"] for r in valid)
    avg_speakers = sum(len(r["speakers"]) for r in valid) / len(valid)
    rtf = total_diarize / total_audio if total_audio > 0 else 0

    print(f"  Clips processed:    {len(valid)}")
    print(f"  Total audio:        {total_audio:.1f}s ({total_audio/60:.1f} min)")
    print(f"  Total diarization:  {total_diarize:.1f}s")
    print(f"  Avg per clip:       {total_diarize/len(valid):.2f}s")
    print(f"  Real-time factor:   {BOLD}{rtf:.4f}x{RESET} ({1/rtf:.0f}x faster than real-time)")
    print(f"  Avg speakers/clip:  {avg_speakers:.1f}")

    # Projection for full pipeline
    print(f"\n  {BOLD}Projection for 200 × 1min segments:{RESET}")
    est_time = 200 * 60 * rtf
    print(f"  Estimated time:     {est_time:.0f}s ({est_time/60:.1f} min)")
    print(f"  Cost:               {GREEN}$0 (local){RESET}")

    # Per-clip summary table
    print(f"\n  {'Clip':<30s} {'Duration':>8s} {'Diarize':>8s} {'RTF':>8s} {'Speakers':>8s}")
    print(f"  {'─'*30} {'─'*8} {'─'*8} {'─'*8} {'─'*8}")
    for r in valid:
        d_rtf = r["diarize_time"] / r["duration"] if r["duration"] > 0 else 0
        print(f"  {r['clip']:<30s} {r['duration']:>7.1f}s {r['diarize_time']:>7.2f}s "
              f"{d_rtf:>7.4f}x {len(r['speakers']):>8d}")

    print()


if __name__ == "__main__":
    main()
