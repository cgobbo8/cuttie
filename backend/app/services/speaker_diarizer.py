"""Speaker diarization — identifies WHO speaks WHEN in audio segments.

Uses pyannote.audio community-1 for diarization and ECAPA-TDNN (SpeechBrain)
for voiceprint extraction / speaker identification.

Designed to run on the top 50 candidates AFTER blended re-ranking, just before
the per-clip LLM analysis. Adds speaker labels to Whisper transcripts so the
LLM can understand conversation dynamics.

Pipeline:
1. Extract streamer voiceprint from first 2 min of VOD (one-time)
2. For each candidate segment: diarize → assign speakers to Whisper words
3. Label the streamer via cosine similarity against voiceprint
"""

import logging
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import torch

from app.services.device import get_device

logger = logging.getLogger(__name__)

# ─── Lazy singletons ────────────────────────────────────────────────────────

_pipeline = None
_classifier = None

VOICEPRINT_THRESHOLD = 0.55  # cosine similarity to match streamer
VOICEPRINT_DURATION = 120  # seconds from VOD start for reference extraction
DIARIZE_WORKERS = 3  # parallel diarization workers (GPU-bound)


def _get_pipeline():
    """Lazy-load pyannote diarization pipeline."""
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    from pyannote.audio import Pipeline

    t0 = time.time()
    _pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-community-1")
    device = get_device()
    _pipeline.to(device)
    logger.info(f"pyannote pipeline loaded on {device} in {time.time()-t0:.1f}s")
    return _pipeline


def _get_classifier():
    """Lazy-load ECAPA-TDNN speaker encoder (always on CPU — fast enough)."""
    global _classifier
    if _classifier is not None:
        return _classifier

    from speechbrain.inference.speaker import EncoderClassifier

    t0 = time.time()
    _classifier = EncoderClassifier.from_hparams(
        source="speechbrain/spkrec-ecapa-voxceleb",
        run_opts={"device": "cpu"},
    )
    logger.info(f"ECAPA-TDNN classifier loaded in {time.time()-t0:.1f}s")
    return _classifier


# ─── Audio helpers ───────────────────────────────────────────────────────────

def _extract_wav_segment(
    wav_path: str, start: float, end: float, output_path: str,
) -> bool:
    """Extract a 16kHz mono WAV segment from the full VOD audio."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", wav_path,
                "-ss", str(start),
                "-t", str(end - start),
                "-ac", "1", "-ar", "16000",
                "-loglevel", "error",
                output_path,
            ],
            check=True, capture_output=True, timeout=15,
        )
        return os.path.isfile(output_path)
    except Exception as e:
        logger.warning(f"Failed to extract WAV segment: {e}")
        return False


# ─── Voiceprint ──────────────────────────────────────────────────────────────

def extract_voiceprint(wav_path: str, duration: float = VOICEPRINT_DURATION) -> np.ndarray | None:
    """Extract streamer voiceprint from the beginning of the VOD.

    Strategy: diarize first 2 min, find dominant speaker, extract their
    embedding. The dominant speaker at VOD start is almost always the streamer.

    Returns 192-dim ECAPA-TDNN embedding, or None on failure.
    """
    import torchaudio

    t0 = time.time()
    logger.info("Extracting streamer voiceprint from VOD start...")

    # Extract first N seconds as 16kHz WAV
    ref_path = wav_path + ".voiceprint_ref.wav"
    try:
        if not _extract_wav_segment(wav_path, 0, duration, ref_path):
            logger.warning("Failed to extract reference audio for voiceprint")
            return None

        # Diarize reference segment
        pipeline = _get_pipeline()
        output = pipeline(ref_path)
        annotation = getattr(output, "exclusive_speaker_diarization", None)
        if annotation is None:
            annotation = getattr(output, "speaker_diarization", output)

        # Find dominant speaker
        speaker_durations: dict[str, float] = {}
        speaker_segments: dict[str, list[tuple[float, float]]] = {}
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            dur = turn.end - turn.start
            speaker_durations[speaker] = speaker_durations.get(speaker, 0) + dur
            speaker_segments.setdefault(speaker, []).append((turn.start, turn.end))

        if not speaker_durations:
            logger.warning("No speakers found in VOD start — cannot create voiceprint")
            return None

        dominant = max(speaker_durations, key=speaker_durations.get)
        dominant_dur = speaker_durations[dominant]
        logger.info(
            f"Dominant speaker in VOD start: {dominant} ({dominant_dur:.1f}s / "
            f"{len(speaker_durations)} speakers)"
        )

        # Load audio and extract embedding from dominant speaker's segments
        waveform, sr = torchaudio.load(ref_path)
        if sr != 16000:
            waveform = torchaudio.functional.resample(waveform, sr, 16000)
            sr = 16000

        chunks = []
        total = 0.0
        for seg_start, seg_end in speaker_segments[dominant]:
            s, e = int(seg_start * sr), int(seg_end * sr)
            if e > waveform.shape[1]:
                e = waveform.shape[1]
            chunks.append(waveform[:, s:e])
            total += seg_end - seg_start
            if total >= 30:  # 30s of clean speech is plenty
                break

        if not chunks or total < 3:
            logger.warning(f"Not enough speech from dominant speaker ({total:.1f}s)")
            return None

        audio = torch.cat(chunks, dim=1)
        classifier = _get_classifier()
        embedding = classifier.encode_batch(audio)
        emb = embedding.squeeze().cpu().numpy()

        elapsed = time.time() - t0
        logger.info(f"Voiceprint extracted: {emb.shape[0]}-dim in {elapsed:.1f}s")
        return emb

    except Exception as e:
        logger.error(f"Voiceprint extraction failed: {e}")
        return None
    finally:
        if os.path.isfile(ref_path):
            os.remove(ref_path)


# ─── Segment diarization ────────────────────────────────────────────────────

def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / norm) if norm > 0 else 0.0


def diarize_segment(
    seg_wav: str,
) -> list[dict]:
    """Diarize a pre-extracted WAV file.

    Uses non-exclusive diarization (speaker_diarization) which allows
    overlapping speech — detects more speakers than exclusive mode.
    Word assignment handles overlaps via temporal majority.

    Returns list of {"speaker": str, "start": float, "end": float} where
    timestamps are relative to the segment start.
    """
    try:
        pipeline = _get_pipeline()
        output = pipeline(seg_wav)
        # Non-exclusive: keeps overlapping speech, detects more speakers
        annotation = getattr(output, "speaker_diarization", None)
        if annotation is None:
            annotation = output

        segments = []
        for turn, _, speaker in annotation.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": turn.start,
                "end": turn.end,
            })
        return segments

    except Exception as e:
        logger.warning(f"Diarization failed for {seg_wav}: {e}")
        return []


MERGE_SIMILARITY = 0.75  # cosine similarity above this → same person


def _extract_speaker_embedding(
    waveform: "torch.Tensor",
    sr: int,
    diarize_segments: list[dict],
    speaker_id: str,
    max_seconds: float = 15,
) -> np.ndarray | None:
    """Extract ECAPA-TDNN embedding for a single speaker from their segments."""
    chunks = []
    total = 0.0
    for seg in diarize_segments:
        if seg["speaker"] != speaker_id:
            continue
        s, e = int(seg["start"] * sr), int(seg["end"] * sr)
        if e > waveform.shape[1]:
            e = waveform.shape[1]
        if e <= s:
            continue
        chunks.append(waveform[:, s:e])
        total += seg["end"] - seg["start"]
        if total >= max_seconds:
            break

    if not chunks or total < 0.5:
        return None

    audio = torch.cat(chunks, dim=1)
    classifier = _get_classifier()
    emb = classifier.encode_batch(audio).squeeze().cpu().numpy()
    return emb


def _merge_similar_speakers(
    diarize_segments: list[dict],
    waveform: "torch.Tensor",
    sr: int,
) -> list[dict]:
    """Merge speakers with similar voice embeddings within a segment.

    pyannote sometimes splits one person into multiple speaker IDs.
    We compute ECAPA-TDNN embeddings for each speaker and merge those
    with cosine similarity > MERGE_SIMILARITY.

    Returns segments with merged speaker labels.
    """
    # Get unique speakers
    speaker_ids = list({seg["speaker"] for seg in diarize_segments})
    if len(speaker_ids) <= 1:
        return diarize_segments

    # Extract embeddings
    embeddings: dict[str, np.ndarray] = {}
    for spk in speaker_ids:
        emb = _extract_speaker_embedding(waveform, sr, diarize_segments, spk)
        if emb is not None:
            embeddings[spk] = emb

    if len(embeddings) <= 1:
        return diarize_segments

    # Build merge map: find pairs with high similarity
    merge_to: dict[str, str] = {spk: spk for spk in speaker_ids}
    emb_items = list(embeddings.items())

    for i in range(len(emb_items)):
        for j in range(i + 1, len(emb_items)):
            spk_a, emb_a = emb_items[i]
            spk_b, emb_b = emb_items[j]
            sim = _cosine_similarity(emb_a, emb_b)
            if sim >= MERGE_SIMILARITY:
                # Merge the smaller speaker into the larger one
                dur_a = sum(s["end"] - s["start"] for s in diarize_segments if s["speaker"] == spk_a)
                dur_b = sum(s["end"] - s["start"] for s in diarize_segments if s["speaker"] == spk_b)
                if dur_a >= dur_b:
                    merge_to[spk_b] = merge_to[spk_a]
                else:
                    merge_to[spk_a] = merge_to[spk_b]

    # Resolve transitive merges (A→B, B→C → A→C)
    changed = True
    while changed:
        changed = False
        for spk in merge_to:
            target = merge_to[spk]
            if merge_to[target] != target:
                merge_to[spk] = merge_to[target]
                changed = True

    # Check if any merges happened
    if all(merge_to[spk] == spk for spk in speaker_ids):
        return diarize_segments

    merged_count = len(speaker_ids) - len(set(merge_to.values()))
    logger.debug(f"Merged {merged_count} fragmented speakers: {merge_to}")

    return [
        {**seg, "speaker": merge_to.get(seg["speaker"], seg["speaker"])}
        for seg in diarize_segments
    ]


def identify_speakers(
    waveform: "torch.Tensor",
    sr: int,
    diarize_segments: list[dict],
    voiceprint: np.ndarray | None,
    streamer_name: str = "Streamer",
) -> dict[str, str]:
    """Merge fragmented speakers, then identify the streamer.

    1. Merge speakers with similar ECAPA-TDNN embeddings (fixes pyannote
       splitting one person into multiple IDs)
    2. Match against voiceprint to label the streamer

    Args:
        waveform: Pre-loaded audio tensor (1, samples) at given sr
        sr: Sample rate (should be 16000)
        diarize_segments: Output from diarize_segment (MODIFIED in-place with merged labels)
        voiceprint: Streamer embedding (or None for dominant-speaker heuristic)
        streamer_name: Display name for the streamer

    Returns {speaker_id: display_name} mapping.
    """
    # Step 1: Merge fragmented speakers
    merged = _merge_similar_speakers(diarize_segments, waveform, sr)
    # Update segments in-place so callers see merged labels
    diarize_segments.clear()
    diarize_segments.extend(merged)

    # Gather unique speakers and durations (post-merge)
    speaker_durations: dict[str, float] = {}
    for seg in diarize_segments:
        dur = seg["end"] - seg["start"]
        speaker_durations[seg["speaker"]] = speaker_durations.get(seg["speaker"], 0) + dur

    if not speaker_durations:
        return {}

    speakers = sorted(speaker_durations.keys(), key=lambda s: -speaker_durations[s])
    names: dict[str, str] = {}

    # Single speaker → always the streamer
    if len(speakers) == 1:
        names[speakers[0]] = streamer_name
        return names

    # No voiceprint → dominant speaker heuristic
    if voiceprint is None:
        names[speakers[0]] = streamer_name
        for spk in speakers[1:]:
            names[spk] = spk
        return names

    # Step 2: Match against voiceprint
    try:
        best_sim = -1.0
        best_spk = None

        for spk in speakers:
            emb = _extract_speaker_embedding(waveform, sr, diarize_segments, spk)
            if emb is None:
                names[spk] = spk
                continue

            sim = _cosine_similarity(voiceprint, emb)

            if sim > best_sim:
                best_sim = sim
                best_spk = spk

            if sim >= VOICEPRINT_THRESHOLD:
                names[spk] = streamer_name
            else:
                names[spk] = spk

        # If no speaker reached threshold, assign streamer to best match
        streamer_found = any(n == streamer_name for n in names.values())
        if not streamer_found and best_spk is not None:
            names[best_spk] = streamer_name

        return names

    except Exception as e:
        logger.warning(f"Speaker identification failed: {e}")
        names[speakers[0]] = streamer_name
        for spk in speakers[1:]:
            names[spk] = spk
        return names


# ─── Whisper word assignment ────────────────────────────────────────────────

def assign_speakers_to_words(
    words: list[dict],
    diarize_segments: list[dict],
    speaker_names: dict[str, str],
) -> list[dict]:
    """Assign a named speaker to each Whisper word via temporal overlap.

    Returns words with added "speaker" key (display name).
    """
    if not diarize_segments:
        return words

    labeled = []
    for w in words:
        w_start, w_end = w["start"], w["end"]
        best_speaker = None
        best_overlap = 0.0

        for seg in diarize_segments:
            overlap = max(0, min(w_end, seg["end"]) - max(w_start, seg["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = seg["speaker"]

        name = speaker_names.get(best_speaker, best_speaker) if best_speaker else None
        labeled.append({**w, "speaker": name})

    return labeled


def format_labeled_transcript(labeled_words: list[dict]) -> str:
    """Format speaker-labeled words into a readable transcript for LLM.

    Groups consecutive words by the same speaker into lines:
      [0.0s] Streamer: Hey chat, let's go
      [2.1s] SPEAKER_01: bro that was insane
    """
    if not labeled_words:
        return ""

    lines = []
    current_speaker = None
    current_words: list[str] = []
    current_start = 0.0

    for w in labeled_words:
        spk = w.get("speaker")
        if spk != current_speaker:
            if current_words:
                lines.append(f"[{current_start:.1f}s] {current_speaker}: {' '.join(current_words)}")
            current_speaker = spk
            current_words = [w["word"]]
            current_start = w["start"]
        else:
            current_words.append(w["word"])

    if current_words:
        lines.append(f"[{current_start:.1f}s] {current_speaker}: {' '.join(current_words)}")

    return "\n".join(lines)


# ─── Batch processing for pipeline ──────────────────────────────────────────

def diarize_candidates(
    wav_path: str,
    candidates: list[tuple[int, "HotPoint"]],
    voiceprint: np.ndarray | None,
    streamer_name: str,
    vod_duration: float,
    job_id: str,
    whisper_words: dict[int, list[dict]],
) -> tuple[dict[int, str], dict[int, list[dict]]]:
    """Diarize and produce speaker-labeled transcripts for a batch of candidates.

    Args:
        wav_path: Full VOD WAV path
        candidates: [(index, HotPoint)] — the top 50 to diarize
        voiceprint: Streamer embedding (or None)
        streamer_name: Display name for the streamer
        vod_duration: Total VOD duration
        job_id: For logging
        whisper_words: {candidate_idx: [{"word", "start", "end"}]} from Whisper

    Returns:
        (transcripts, labeled_words) where:
        - transcripts: {idx: formatted_transcript_string} for LLM prompts
        - labeled_words: {idx: [{"word", "start", "end", "speaker"}]} for subtitles
    """
    from app.services.clipper import CLIP_HALF_DURATION

    work_dir = os.path.join("diarize_tmp", job_id)
    os.makedirs(work_dir, exist_ok=True)

    total = len(candidates)
    logger.info(f"[{job_id[:8]}] Diarizing {total} candidates...")
    t0 = time.time()

    # Warm up the pipeline (load once before parallel calls)
    _get_pipeline()
    _get_classifier()

    import torchaudio
    import threading

    transcripts: dict[int, str] = {}
    all_labeled_words: dict[int, list[dict]] = {}
    # Lock ONLY for pyannote GPU calls — identification runs on CPU without lock
    _gpu_lock = threading.Lock()

    def _process_one(idx: int, hp) -> tuple[int, str, list[dict]]:
        # Determine segment bounds
        if hp.clip_start is not None and hp.clip_end is not None:
            start, end = hp.clip_start, hp.clip_end
        else:
            start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
            end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)

        words = whisper_words.get(idx, [])
        seg_wav = os.path.join(work_dir, f"diarize_{idx:03d}.wav")

        try:
            # 1. Extract WAV once (reused for both diarization + identification)
            if not _extract_wav_segment(wav_path, start, end, seg_wav):
                plain = " ".join(w["word"] for w in words) if words else ""
                return idx, plain, words

            # 2. Diarize — GPU, needs lock
            with _gpu_lock:
                segments = diarize_segment(seg_wav)

            if not segments:
                plain = " ".join(w["word"] for w in words) if words else ""
                return idx, plain, words

            # 3. Identify speakers — CPU only, no lock needed
            #    Load the WAV for embedding extraction (reuse the same file)
            waveform, sr = torchaudio.load(seg_wav)
            if sr != 16000:
                waveform = torchaudio.functional.resample(waveform, sr, 16000)
                sr = 16000

            speaker_names = identify_speakers(
                waveform, sr, segments, voiceprint, streamer_name,
            )

            # 4. Assign speakers to Whisper words
            if words:
                labeled = assign_speakers_to_words(words, segments, speaker_names)
                transcript = format_labeled_transcript(labeled)
                return idx, transcript, labeled
            else:
                lines = []
                for seg in segments:
                    name = speaker_names.get(seg["speaker"], seg["speaker"])
                    lines.append(f"[{seg['start']:.1f}s-{seg['end']:.1f}s] {name}: (speech)")
                return idx, "\n".join(lines), []

        except Exception as e:
            logger.warning(f"Diarization failed for candidate {idx}: {e}")
            plain = " ".join(w["word"] for w in words) if words else ""
            return idx, plain, words
        finally:
            if os.path.isfile(seg_wav):
                os.remove(seg_wav)

    # Parallel: while one thread runs identification (CPU), another can diarize (GPU)
    with ThreadPoolExecutor(max_workers=DIARIZE_WORKERS) as executor:
        futures = {
            executor.submit(_process_one, idx, hp): idx
            for idx, hp in candidates
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            try:
                idx, transcript, labeled = future.result()
                transcripts[idx] = transcript
                if labeled:
                    all_labeled_words[idx] = labeled
            except Exception as e:
                idx = futures[future]
                logger.error(f"Diarization failed for candidate {idx}: {e}")
                words = whisper_words.get(idx, [])
                transcripts[idx] = " ".join(w["word"] for w in words) if words else ""

            if done % 10 == 0 or done == total:
                logger.info(f"[{job_id[:8]}] Diarization: {done}/{total}")

    # Cleanup
    try:
        import shutil
        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass

    elapsed = time.time() - t0
    non_empty = sum(1 for t in transcripts.values() if t)
    logger.info(
        f"[{job_id[:8]}] Diarization complete: {non_empty}/{total} "
        f"with speech in {elapsed:.1f}s"
    )
    return transcripts, all_labeled_words
