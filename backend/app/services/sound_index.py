"""What is heard along the whole live, second by second: what a search can
look for when words are not enough ("the moments when it kicks off").

PANNs CNN14 (AudioSet's 527 classes) listens to 2 s windows every second; of
those classes, the ones that mean something in a stream are kept, grouped
under names a search can ask for (gunfire, crash, scream, siren...), with how
loud each second is. About 1 MB per live, kept next to its transcript.
Half a minute of GPU for a 5-hour live.

The classes misfire (an engine backfiring reads as gunfire): this index finds
where to look, it doesn't say what happened. Whoever uses it has to check, by
reading what is said there or by listening.
"""

import csv
import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.services.paths import transcript_dir

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 2.0
HOP_SECONDS = 1.0
BATCH = 64
VERSION = 1

# Sounds a streamer would look for, and the AudioSet classes that make each
GROUPS: dict[str, list[str]] = {
    "gunfire": ["Gunshot, gunfire", "Machine gun", "Fusillade", "Artillery fire", "Cap gun"],
    "explosion": ["Explosion", "Boom", "Burst, pop", "Eruption", "Fireworks", "Firecracker"],
    "crash": ["Smash, crash", "Shatter", "Breaking", "Bang", "Slam", "Thump, thud", "Whack, thwack", "Slap, smack", "Glass"],
    "scream": ["Screaming", "Shout", "Yell", "Battle cry", "Children shouting", "Whoop", "Bellow"],
    "laughter": ["Laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"],
    "crying": ["Crying, sobbing", "Whimper", "Wail, moan"],
    "gasp": ["Gasp", "Sigh"],
    "whisper": ["Whispering"],
    "siren": ["Siren", "Police car (siren)", "Ambulance (siren)", "Fire engine, fire truck (siren)", "Emergency vehicle", "Civil defense siren"],
    "alarm": ["Alarm", "Car alarm", "Smoke detector, smoke alarm", "Buzzer", "Alarm clock"],
    "engine": ["Engine", "Accelerating, revving, vroom", "Motorcycle", "Race car, auto racing", "Engine starting", "Car passing by"],
    "skid": ["Tire squeal", "Skidding"],
    "horn": ["Vehicle horn, car horn, honking"],
    "aircraft": ["Helicopter", "Aircraft", "Fixed-wing aircraft, airplane"],
    "music": ["Music", "Singing", "Musical instrument"],
    "applause": ["Applause", "Cheering", "Clapping", "Crowd"],
    "animal": ["Roar", "Roaring cats (lions, tigers)", "Growling", "Bark", "Meow", "Howl"],
    "phone": ["Telephone", "Telephone bell ringing", "Ringtone"],
    "water": ["Water", "Splash, splatter"],
    "fire": ["Fire", "Crackle"],
    "footsteps": ["Walk, footsteps", "Run"],
    "silence": ["Silence"],
    "speech": ["Speech"],
}

_LABELS = Path(__file__).resolve().parents[2] / "assets" / "panns" / "class_labels_indices.csv"


def _class_indexes() -> dict[str, list[int]]:
    with open(_LABELS, encoding="utf-8") as f:
        index = {row["display_name"]: int(row["index"]) for row in csv.DictReader(f)}
    return {group: [index[name] for name in names if name in index] for group, names in GROUPS.items()}


def index_path(job_id: str) -> str:
    return os.path.join(transcript_dir(job_id), "sound.npz")


def hms(seconds: float) -> str:
    s = int(max(0.0, seconds))
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}"


@dataclass
class SoundIndex:
    """Each group's score (0-1) and the loudness (dB) of every second of the live."""

    groups: list[str]
    scores: np.ndarray  # [seconds, groups]
    loud: np.ndarray  # [seconds], dB
    hop: float = HOP_SECONDS

    @property
    def seconds(self) -> float:
        return len(self.loud) * self.hop

    def _column(self, group: str) -> np.ndarray:
        return self.scores[:, self.groups.index(group)].astype(np.float32)

    def peaks(self, group: str, limit: int = 20, floor: float = 0.15, apart: float = 15.0) -> list[dict]:
        """The strongest distinct moments of a sound: when, how sure (0-1), how long it lasts."""
        if group not in self.groups:
            return []
        return _peaks(self._column(group), self.hop, limit, floor, apart)

    def _speaking(self) -> np.ndarray:
        return self._column("speech") > 0.5

    def raised_voices(self, limit: int = 20, apart: float = 20.0) -> list[dict]:
        """When people speak much louder than they usually do in this live (dB over their usual level)."""
        speaking = self._speaking()
        if speaking.sum() < 30:
            return []
        usual = float(np.median(self.loud[speaking]))
        over = np.where(speaking, self.loud - usual, 0.0).astype(np.float32)
        return [{**p, "over_db": round(p.pop("score"), 1)} for p in _peaks(_smooth(over, 3), self.hop, limit, 6.0, apart)]

    def loudest(self, limit: int = 20, apart: float = 20.0) -> list[dict]:
        """The loudest moments of the live, whatever makes the noise (dB over the usual level)."""
        usual = float(np.median(self.loud))
        over = (self.loud - usual).astype(np.float32)
        return [{**p, "over_db": round(p.pop("score"), 1)} for p in _peaks(_smooth(over, 3), self.hop, limit, 6.0, apart)]

    def quiet(self, limit: int = 20, least: float = 8.0) -> list[dict]:
        """Stretches where nobody speaks for at least `least` seconds, the longest first."""
        speaking = self._speaking()
        runs: list[dict] = []
        start = None
        for i, talks in enumerate([*speaking, True]):
            if not talks and start is None:
                start = i
            elif talks and start is not None:
                if (i - start) * self.hop >= least:
                    runs.append({"time": start * self.hop, "seconds": round((i - start) * self.hop, 1)})
                start = None
        return sorted(runs, key=lambda r: -r["seconds"])[:limit]

    def heard(self, start: float, end: float) -> dict:
        """What is heard between `start` and `end`: the sounds that stand out, and how loud it is next to usual."""
        a, b = int(max(0.0, start) / self.hop), max(int(end / self.hop), int(start / self.hop) + 1)
        window = self.scores[a:b].astype(np.float32)
        if len(window) == 0:
            return {"sounds": {}, "over_db": 0.0}
        strongest = window.max(axis=0)
        sounds = {g: round(float(strongest[i]), 2) for i, g in enumerate(self.groups) if strongest[i] >= 0.12 and g != "speech"}
        speech = float(window[:, self.groups.index("speech")].mean())
        return {
            "sounds": dict(sorted(sounds.items(), key=lambda kv: -kv[1])),
            "speech_share": round(speech, 2),
            "over_db": round(float(self.loud[a:b].max() - np.median(self.loud)), 1),
        }


def _smooth(values: np.ndarray, width: int) -> np.ndarray:
    return np.convolve(values, np.ones(width, dtype=np.float32) / width, mode="same")


def _peaks(values: np.ndarray, hop: float, limit: int, floor: float, apart: float) -> list[dict]:
    """Strongest values first, each at least `apart` seconds from the ones already taken;
    `seconds`: how long the sound stays over half its peak around it."""
    order = np.argsort(-values)
    taken: list[int] = []
    gap = int(apart / hop)
    for i in order:
        if values[i] < floor or len(taken) >= limit:
            break
        if all(abs(int(i) - j) > gap for j in taken):
            taken.append(int(i))
    out = []
    for i in taken:
        half = max(floor, values[i] * 0.5)
        a = b = i
        while a > 0 and values[a - 1] >= half:
            a -= 1
        while b < len(values) - 1 and values[b + 1] >= half:
            b += 1
        out.append({"time": a * hop, "at": hms(a * hop), "seconds": round((b - a + 1) * hop, 1), "score": round(float(values[i]), 2)})
    return out


def build(wav_path: str, job_id: str) -> SoundIndex:
    """Listen to the whole live (its 16 kHz WAV) and keep what is heard next to its transcript."""
    import librosa

    from app.services import audio_classifier

    t0 = time.time()
    y, sr = librosa.load(wav_path, sr=audio_classifier.PANNS_SR, mono=True)
    net, _device = audio_classifier._get_model()
    window, hop = int(WINDOW_SECONDS * sr), int(HOP_SECONDS * sr)
    starts = list(range(0, max(1, len(y) - window + 1), hop))
    classes = _class_indexes()
    groups = list(GROUPS)
    scores = np.zeros((len(starts), len(groups)), dtype=np.float16)
    loud = np.zeros(len(starts), dtype=np.float32)
    for b in range(0, len(starts), BATCH):
        chunk = [np.pad(y[s : s + window], (0, max(0, window - len(y[s : s + window])))).astype(np.float32) for s in starts[b : b + BATCH]]
        # The model as it is now: it moves to the CPU by itself when the GPU's memory runs out
        net, device = audio_classifier._model or (net, _device)
        probs = audio_classifier._infer(net, device, chunk)
        for g, name in enumerate(groups):
            if classes[name]:
                scores[b : b + len(chunk), g] = probs[:, classes[name]].max(axis=1)
        loud[b : b + len(chunk)] = [20 * np.log10(max(1e-6, float(np.sqrt(np.mean(c**2))))) for c in chunk]
    index = SoundIndex(groups, scores, loud)
    os.makedirs(os.path.dirname(index_path(job_id)), exist_ok=True)
    np.savez_compressed(index_path(job_id), version=VERSION, groups=np.array(groups), scores=scores, loud=loud, hop=HOP_SECONDS)
    logger.info(f"[{job_id[:8]}] Sound index: {len(starts)} s of live heard in {time.time() - t0:.0f} s")
    return index


def load(job_id: str) -> SoundIndex | None:
    """The live's sound index, None when it was never made (analyses from before it existed)."""
    try:
        with np.load(index_path(job_id), allow_pickle=False) as data:
            if int(data["version"]) != VERSION:
                return None
            return SoundIndex([str(g) for g in data["groups"]], data["scores"], data["loud"], float(data["hop"]))
    except (OSError, ValueError, KeyError):
        return None
