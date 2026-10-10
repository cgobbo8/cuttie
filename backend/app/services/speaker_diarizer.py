"""Speaker diarization — who speaks when in a clip, with no account or API.

Silero VAD (shipped with faster-whisper) finds the speech; WeSpeaker ResNet34
(public ONNX model, CC-BY-4.0, 26 MB, downloaded once) turns every 1.5 s window
of it into a voice embedding; a cautious clustering groups them into a few
voices. The streamer's voice (voiceprint) is learned once per live: the voice
heard again in most of a dozen passages spread over it (other players come and
go, the streamer is always there). It names the "streamer" voice of each clip.

Tuned on 21 clips of a GTA RP live (other players heard through the game):
2.2 voices per clip on average, and 80 % of the words of sentences addressed
to the streamer by name land on another voice.

Runs on the candidates sent to the LLM (speaker-labeled transcript) and for the
subtitle colors (one per voice). Never fails a job: callers fall back to words
without speakers.
"""

import logging
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import torch

from app.services import paths
from app.services.transcript_format import format_labeled_transcript

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
WINDOW, HOP = 1.5, 0.75  # seconds: one voice embedding per window
CLUSTER_DISTANCE = 0.7  # first grouping (average linkage, cosine distance)
MERGE_SIMILARITY = 0.5  # voices whose centroids are this alike are one
MIN_VOICE_SECONDS = 2.0  # less speech than this is not a voice of its own
MAX_VOICES = 4
STREAMER_SIMILARITY = 0.3  # a voice this close to the voiceprint is the streamer's
STREAMER = "STREAMER"  # label of the streamer's voice, before naming
NEAREST_TURN_SECONDS = 1.0  # a word outside every turn joins the nearest one within this

VOICEPRINT_DURATION = 120  # seconds of reference audio (from the VOD start when no passages are given)
VOICE_REFERENCE_LEN = 20.0  # seconds per reference passage
VOICE_REFERENCE_COUNT = 12
VOICEPRINT_MATCH = 0.5  # the same voice, found again in another passage
DIARIZE_WORKERS = 3

EMBEDDER_REPO = "Wespeaker/wespeaker-voxceleb-resnet34-LM"
EMBEDDER_FILE = "voxceleb_resnet34_LM.onnx"
EMBEDDER_REVISION = "f0c48c298fd835726c27956a5d617bad7115627e"
EMBEDDING_DIM = 256

_embedder = None
_embedder_lock = threading.Lock()


def _get_embedder():
    """WeSpeaker ResNet34 on the CPU, downloaded once into <data>/models/wespeaker."""
    global _embedder
    with _embedder_lock:
        if _embedder is None:
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download

            t0 = time.time()
            path = hf_hub_download(
                EMBEDDER_REPO,
                EMBEDDER_FILE,
                revision=EMBEDDER_REVISION,
                local_dir=os.path.join(paths.DATA_DIR, "models", "wespeaker"),
            )
            _embedder = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
            logger.info(f"Speaker embedder loaded in {time.time() - t0:.1f}s")
    return _embedder


# ─── Audio helpers ───────────────────────────────────────────────────────────

def _load_wav(path: str) -> tuple[torch.Tensor, int]:
    """Load a WAV file as a mono (1, samples) float tensor at 16 kHz.

    Uses soundfile rather than torchaudio.load, which goes through torchcodec
    and needs FFmpeg shared libraries on Windows.
    """
    import soundfile as sf

    data, sr = sf.read(path, dtype="float32", always_2d=True)
    waveform = torch.from_numpy(data.T.copy())
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != SAMPLE_RATE:
        import torchaudio

        waveform = torchaudio.functional.resample(waveform, sr, SAMPLE_RATE)
        sr = SAMPLE_RATE
    return waveform, sr


def _extract_wav_segment(
    wav_path: str, start: float, end: float, output_path: str,
) -> bool:
    """Extract a 16kHz mono WAV segment from the full VOD audio."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(start),
                "-t", str(end - start),
                "-i", wav_path,
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


# ─── Voices ──────────────────────────────────────────────────────────────────

def _speech_regions(audio: np.ndarray) -> list[tuple[float, float]]:
    """Where someone speaks (seconds), split at pauses of 0.3 s."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    options = VadOptions(threshold=0.5, min_speech_duration_ms=250, min_silence_duration_ms=300, speech_pad_ms=100)
    return [(r["start"] / SAMPLE_RATE, r["end"] / SAMPLE_RATE) for r in get_speech_timestamps(audio, options, sampling_rate=SAMPLE_RATE)]


def _windows(regions: list[tuple[float, float]]) -> list[tuple[float, float, int]]:
    """1.5 s windows every 0.75 s over each speech region: (start, end, region index)."""
    out: list[tuple[float, float, int]] = []
    for ri, (a, b) in enumerate(regions):
        if b - a < 0.5:
            continue
        if b - a <= WINDOW:
            out.append((a, b, ri))
            continue
        t = a
        while t + WINDOW <= b:
            out.append((t, t + WINDOW, ri))
            t += HOP
        if out[-1][1] < b - 0.25:
            out.append((b - WINDOW, b, ri))
    return out


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def _embed(audio: np.ndarray, windows: list[tuple[float, float, int]]) -> np.ndarray:
    """One unit-length voice embedding per window."""
    import torchaudio.compliance.kaldi as kaldi

    session = _get_embedder()
    feats = []
    for a, b, _ in windows:
        chunk = torch.from_numpy(audio[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)].copy()).unsqueeze(0) * (1 << 15)
        f = kaldi.fbank(chunk, num_mel_bins=80, frame_length=25, frame_shift=10, dither=0.0,
                        sample_frequency=SAMPLE_RATE, window_type="hamming", use_energy=False)
        feats.append((f - f.mean(dim=0)).numpy())
    out = np.zeros((len(windows), EMBEDDING_DIM), dtype=np.float32)
    # Batched by length (all full windows share theirs)
    by_length: dict[int, list[int]] = {}
    for i, f in enumerate(feats):
        by_length.setdefault(f.shape[0], []).append(i)
    for indexes in by_length.values():
        for s in range(0, len(indexes), 32):
            part = indexes[s : s + 32]
            out[part] = session.run(["embs"], {"feats": np.stack([feats[i] for i in part])})[0]
    return _unit(out)


def _smooth(embeddings: np.ndarray, windows: list[tuple[float, float, int]]) -> np.ndarray:
    """Each window averaged with its neighbours in the same speech region (steadier voices)."""
    out = embeddings.copy()
    for i in range(len(windows)):
        group = [embeddings[i]] + [embeddings[j] for j in (i - 1, i + 1) if 0 <= j < len(windows) and windows[j][2] == windows[i][2]]
        out[i] = np.mean(group, axis=0)
    return _unit(out)


def _cluster(embeddings: np.ndarray, windows: list[tuple[float, float, int]]) -> np.ndarray:
    """A voice label per window: few voices, each with enough speech, no flicker."""
    labels = np.zeros(len(embeddings), dtype=int)
    if len(embeddings) < 2:
        return labels
    from sklearn.cluster import AgglomerativeClustering

    labels = AgglomerativeClustering(
        n_clusters=None, metric="cosine", linkage="average", distance_threshold=CLUSTER_DISTANCE,
    ).fit_predict(embeddings)
    seconds = np.array([b - a for a, b, _ in windows]) * HOP / WINDOW  # windows overlap by half

    def centroids() -> tuple[list[int], np.ndarray]:
        keys = sorted(set(labels.tolist()))
        return keys, _unit(np.array([embeddings[labels == k].mean(axis=0) for k in keys]))

    # Merge the two closest voices while they're alike, or while there are too many
    while True:
        keys, c = centroids()
        if len(keys) < 2:
            break
        sim = c @ c.T
        np.fill_diagonal(sim, -1.0)
        i, j = np.unravel_index(int(np.argmax(sim)), sim.shape)
        if sim[i, j] < MERGE_SIMILARITY and len(keys) <= MAX_VOICES:
            break
        labels[labels == keys[j]] = keys[i]
    # Too little speech for a voice of its own: to the closest one
    while True:
        keys, c = centroids()
        small = [k for k in keys if seconds[labels == k].sum() < MIN_VOICE_SECONDS]
        if len(keys) < 2 or not small:
            break
        k = min(small, key=lambda q: seconds[labels == q].sum())
        ck = c[keys.index(k)]
        labels[labels == k] = max((q for q in keys if q != k), key=lambda q: float(c[keys.index(q)] @ ck))
    # A lone window between two of another voice, in one breath: that voice
    for i in range(1, len(labels) - 1):
        if labels[i - 1] == labels[i + 1] != labels[i] and windows[i - 1][2] == windows[i][2] == windows[i + 1][2]:
            labels[i] = labels[i - 1]
    return labels


def _name_voices(embeddings: np.ndarray, labels: np.ndarray, voiceprint: np.ndarray | None) -> dict[int, str]:
    """STREAMER for the voice closest to the voiceprint (when close enough), SPEAKER_01... for
    the others by speaking time."""
    keys = sorted(set(labels.tolist()), key=lambda k: -int((labels == k).sum()))
    streamer = None
    if voiceprint is not None and voiceprint.shape == (EMBEDDING_DIM,):
        vp = _unit(voiceprint.astype(np.float32))
        sims = {k: float(_unit(embeddings[labels == k].mean(axis=0)) @ vp) for k in keys}
        best = max(sims, key=sims.get)
        if sims[best] >= STREAMER_SIMILARITY:
            streamer = best
    names: dict[int, str] = {}
    n = 1
    for k in keys:
        if k == streamer:
            names[k] = STREAMER
        else:
            names[k] = f"SPEAKER_{n:02d}"
            n += 1
    return names


def _segments(windows: list[tuple[float, float, int]], voices: list[str], regions: list[tuple[float, float]]) -> list[dict]:
    """Speech regions cut into turns: every 0.1 s goes to the voice of the nearest window."""
    centers = np.array([(a + b) / 2 for a, b, _ in windows])
    segments: list[dict] = []
    for a, b in regions:
        t = a
        while t < b - 1e-6:
            step = min(0.1, b - t)
            voice = voices[int(np.argmin(np.abs(centers - (t + step / 2))))]
            if segments and segments[-1]["speaker"] == voice and abs(segments[-1]["end"] - t) < 1e-6:
                segments[-1]["end"] = t + step
            else:
                segments.append({"speaker": voice, "start": t, "end": t + step})
            t += step
    return segments


def _voices_of(audio: np.ndarray) -> tuple[list[tuple[float, float]], list[tuple[float, float, int]], np.ndarray, np.ndarray]:
    regions = _speech_regions(audio)
    windows = _windows(regions)
    if not windows:
        return regions, windows, np.zeros((0, EMBEDDING_DIM), dtype=np.float32), np.zeros(0, dtype=int)
    embeddings = _smooth(_embed(audio, windows), windows)
    return regions, windows, embeddings, _cluster(embeddings, windows)


# ─── Voiceprint ──────────────────────────────────────────────────────────────

def pick_voice_reference(classification: list[dict], duration: float) -> list[float]:
    """Starts of a few speech-dense passages spread over the VOD, to learn the
    streamer's voice from. Not the VOD start: it's often a "starting soon"
    screen with music. `classification` comes from classify_audio (5 s windows).
    """
    if not classification:
        return []
    times = np.array([w["time"] for w in classification], dtype=float)
    voice = np.array([w["speech_presence"] - 0.5 * w.get("game_audio", 0.0) for w in classification], dtype=float)
    per = max(1, int(round(VOICE_REFERENCE_LEN / max(times[1] - times[0], 1.0)))) if len(times) > 1 else 1
    if len(voice) < per:
        return []
    # Mean over each 30 s passage starting at every window
    passage = np.convolve(voice, np.ones(per) / per, mode="valid")
    skip = 180.0 if duration > 900 else 0.0
    order = np.argsort(passage)[::-1]
    picked: list[float] = []
    spacing = max(VOICE_REFERENCE_LEN, min(300.0, duration / (VOICE_REFERENCE_COUNT * 2)))
    for i in order:
        t = float(times[i])
        if t < skip or passage[i] < 0.3:
            continue
        if all(abs(t - p) >= spacing for p in picked):
            picked.append(t)
        if len(picked) == VOICE_REFERENCE_COUNT:
            break
    return sorted(picked)


def extract_voiceprint(wav_path: str, duration: float = VOICEPRINT_DURATION, starts: list[float] | None = None) -> np.ndarray | None:
    """The streamer's voice: of the voices in a few passages spread over the VOD
    (`starts`, see pick_voice_reference), the one found again in the most
    passages. Without passages, the first 2 minutes. Returns a unit embedding, or None.
    """
    t0 = time.time()
    if starts:
        spans = [(s, s + VOICE_REFERENCE_LEN) for s in starts]
    else:
        spans = [(t, t + VOICE_REFERENCE_LEN) for t in np.arange(0.0, duration, VOICE_REFERENCE_LEN)]
    centroids: list[np.ndarray] = []
    seconds: list[float] = []
    passage: list[int] = []
    for i, (a, b) in enumerate(spans):
        ref_path = f"{wav_path}.voiceprint_ref_{i}.wav"
        try:
            if not _extract_wav_segment(wav_path, a, b, ref_path):
                continue
            audio = _load_wav(ref_path)[0].squeeze(0).numpy()
            _, windows, embeddings, labels = _voices_of(audio)
            spoken = np.array([w[1] - w[0] for w in windows]) * HOP / WINDOW
            for k in set(labels.tolist()):
                if spoken[labels == k].sum() >= MIN_VOICE_SECONDS:
                    centroids.append(_unit(embeddings[labels == k].mean(axis=0)))
                    seconds.append(float(spoken[labels == k].sum()))
                    passage.append(i)
        except Exception as e:
            logger.warning(f"Voiceprint passage {i} failed: {e}")
        finally:
            if os.path.isfile(ref_path):
                os.remove(ref_path)
    if not centroids:
        logger.warning("No voice found for a voiceprint")
        return None

    c = np.array(centroids)
    sim = c @ c.T
    owners = np.array(passage)
    # How many other passages each voice is heard again in (ties: the one who talks most)
    support = [len(set(owners[sim[i] >= VOICEPRINT_MATCH].tolist()) - {owners[i]}) for i in range(len(c))]
    best = max(range(len(c)), key=lambda i: (support[i], seconds[i]))
    # Its closest voice in each passage where it's heard
    members: dict[int, int] = {}
    for i in np.flatnonzero(sim[best] >= VOICEPRINT_MATCH):
        p = int(owners[i])
        if p not in members or sim[best, i] > sim[best, members[p]]:
            members[p] = int(i)
    weights = np.array([seconds[i] for i in members.values()])
    voiceprint = _unit((c[list(members.values())] * weights[:, None]).sum(axis=0))
    logger.info(
        f"Voiceprint: a voice heard in {len(members)}/{len(set(passage))} passages "
        f"({len(c)} voices in all), {time.time() - t0:.1f}s"
    )
    return voiceprint


# ─── Clip diarization ────────────────────────────────────────────────────────

def diarize_segment(seg_wav: str, voiceprint: np.ndarray | None = None) -> list[dict]:
    """Diarize a pre-extracted WAV file (see diarize_waveform)."""
    try:
        waveform, sr = _load_wav(seg_wav)
    except Exception as e:
        logger.warning(f"Could not load {seg_wav} for diarization: {e}")
        return []
    return diarize_waveform(waveform, sr, voiceprint)


def diarize_waveform(waveform: "torch.Tensor", sr: int, voiceprint: np.ndarray | None = None) -> list[dict]:
    """Who speaks when in a mono 16 kHz waveform: [{"speaker", "start", "end"}]
    (seconds from its start). The streamer's voice is STREAMER when a voiceprint
    recognizes it, the others SPEAKER_01, SPEAKER_02..."""
    try:
        audio = waveform.squeeze(0).numpy().astype(np.float32)
        regions, windows, embeddings, labels = _voices_of(audio)
        if not windows:
            return []
        names = _name_voices(embeddings, labels, voiceprint)
        return _segments(windows, [names[int(k)] for k in labels], regions)
    except Exception as e:
        logger.warning(f"Diarization failed: {e}")
        return []


def identify_speakers(
    waveform: "torch.Tensor",
    sr: int,
    diarize_segments: list[dict],
    voiceprint: np.ndarray | None,
    streamer_name: str = "Streamer",
) -> dict[str, str]:
    """Display names of the voices: the streamer's name for the voice the
    voiceprint recognized; without a voiceprint, for the one who speaks most.
    With a voiceprint that recognized nobody, the streamer isn't heard here.
    (`waveform` and `sr` are kept for callers: the voices are already grouped.)
    """
    durations: dict[str, float] = {}
    for seg in diarize_segments:
        durations[seg["speaker"]] = durations.get(seg["speaker"], 0.0) + seg["end"] - seg["start"]
    if not durations:
        return {}
    names = {spk: spk for spk in durations}
    if STREAMER in names:
        names[STREAMER] = streamer_name
    elif voiceprint is None:
        names[max(durations, key=durations.get)] = streamer_name
    return names


# ─── Whisper word assignment ────────────────────────────────────────────────

def assign_speakers_to_words(
    words: list[dict],
    diarize_segments: list[dict],
    speaker_names: dict[str, str],
) -> list[dict]:
    """Assign a named speaker to each Whisper word via temporal overlap (a word
    just outside every turn, within a second: the nearest one).

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
        if best_speaker is None:
            gap, nearest = min(
                ((max(seg["start"] - w_end, w_start - seg["end"]), seg["speaker"]) for seg in diarize_segments),
                key=lambda g: g[0],
            )
            if gap <= NEAREST_TURN_SECONDS:
                best_speaker = nearest

        name = speaker_names.get(best_speaker, best_speaker) if best_speaker else None
        labeled.append({**w, "speaker": name})

    return labeled


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

    work_dir = paths.work_dir("diarize", job_id)
    os.makedirs(work_dir, exist_ok=True)

    total = len(candidates)
    logger.info(f"[{job_id[:8]}] Diarizing {total} candidates...")
    t0 = time.time()

    # Load (or download) the model once before the parallel calls; raises if it
    # can't be — the caller treats diarization as optional
    _get_embedder()

    transcripts: dict[int, str] = {}
    all_labeled_words: dict[int, list[dict]] = {}

    def _process_one(idx: int, hp) -> tuple[int, str, list[dict]]:
        if hp.clip_start is not None and hp.clip_end is not None:
            start, end = hp.clip_start, hp.clip_end
        else:
            start = max(0, hp.timestamp_seconds - CLIP_HALF_DURATION)
            end = min(vod_duration, hp.timestamp_seconds + CLIP_HALF_DURATION)

        words = whisper_words.get(idx, [])
        plain = " ".join(w["word"] for w in words) if words else ""
        seg_wav = os.path.join(work_dir, f"diarize_{idx:03d}.wav")

        try:
            if not _extract_wav_segment(wav_path, start, end, seg_wav):
                return idx, plain, words
            waveform, sr = _load_wav(seg_wav)
            segments = diarize_waveform(waveform, sr, voiceprint)
            if not segments:
                return idx, plain, words
            speaker_names = identify_speakers(waveform, sr, segments, voiceprint, streamer_name)
            if words:
                labeled = assign_speakers_to_words(words, segments, speaker_names)
                return idx, format_labeled_transcript(labeled), labeled
            lines = [
                f"[{seg['start']:.1f}s-{seg['end']:.1f}s] {speaker_names.get(seg['speaker'], seg['speaker'])}: (speech)"
                for seg in segments
            ]
            return idx, "\n".join(lines), []
        except Exception as e:
            logger.warning(f"Diarization failed for candidate {idx}: {e}")
            return idx, plain, words
        finally:
            if os.path.isfile(seg_wav):
                os.remove(seg_wav)

    with ThreadPoolExecutor(max_workers=DIARIZE_WORKERS) as executor:
        futures = {executor.submit(_process_one, idx, hp): idx for idx, hp in candidates}
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

    try:
        import shutil

        shutil.rmtree(work_dir, ignore_errors=True)
    except Exception:
        pass

    elapsed = time.time() - t0
    non_empty = sum(1 for t in transcripts.values() if t)
    logger.info(f"[{job_id[:8]}] Diarization complete: {non_empty}/{total} with speech in {elapsed:.1f}s")
    return transcripts, all_labeled_words
