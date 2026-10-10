"""Who speaks when: voices grouped cautiously, the streamer recognized by his voiceprint."""

import numpy as np
import torch

from app.services import speaker_diarizer as sd

RNG = np.random.default_rng(7)


def _voice() -> np.ndarray:
    v = RNG.standard_normal(sd.EMBEDDING_DIM)
    return v / np.linalg.norm(v)


def _windows(counts: list[int]) -> list[tuple[float, float, int]]:
    """`counts[r]` full windows in speech region r, regions 2 s apart."""
    out, t = [], 0.0
    for r, n in enumerate(counts):
        for i in range(n):
            out.append((t + i * sd.HOP, t + i * sd.HOP + sd.WINDOW, r))
        t += (n + 1) * sd.HOP + 2.0
    return out


def _embeddings(voices: list[np.ndarray], noise: float = 0.3) -> np.ndarray:
    e = np.array([v + noise * RNG.standard_normal(sd.EMBEDDING_DIM) / np.sqrt(sd.EMBEDDING_DIM) * 4 for v in voices])
    return e / np.linalg.norm(e, axis=1, keepdims=True)


def test_windows_cover_the_speech():
    wins = sd._windows([(0.0, 0.3), (1.0, 2.2), (3.0, 6.0)])
    assert all(r != 0 for *_, r in wins)  # a breath, not a voice
    assert (1.0, 2.2, 1) in wins  # short region: one window
    long = [w for w in wins if w[2] == 2]
    assert long[0][0] == 3.0 and long[-1][1] == 6.0
    assert all(abs((b - a) - sd.WINDOW) < 1e-9 for a, b, _ in long)


def test_two_voices_stay_two():
    a, b = _voice(), _voice()
    wins = _windows([10, 10])
    labels = sd._cluster(_embeddings([a] * 10 + [b] * 10), wins)
    assert len(set(labels[:10])) == 1 and len(set(labels[10:])) == 1
    assert labels[0] != labels[10]


def test_one_voice_is_one():
    a = _voice()
    labels = sd._cluster(_embeddings([a] * 16), _windows([8, 8]))
    assert len(set(labels)) == 1


def test_a_few_words_from_someone_else_are_not_a_voice():
    a, b = _voice(), _voice()
    # 1.5 s of another voice in its own breath: below MIN_VOICE_SECONDS
    labels = sd._cluster(_embeddings([a] * 20 + [b] * 2), _windows([20, 2]))
    assert len(set(labels)) == 1


def test_never_more_than_four_voices():
    voices = [_voice() for _ in range(6)]
    labels = sd._cluster(_embeddings([v for v in voices for _ in range(6)]), _windows([6] * 6))
    assert len(set(labels)) <= sd.MAX_VOICES


def test_the_voiceprint_names_the_streamer():
    a, b = _voice(), _voice()
    e = _embeddings([a] * 10 + [b] * 14)
    labels = sd._cluster(e, _windows([10, 14]))
    names = sd._name_voices(e, labels, a)
    assert names[int(labels[0])] == sd.STREAMER
    assert names[int(labels[-1])] == "SPEAKER_01"
    # Someone else's voiceprint: the streamer isn't heard here
    assert sd.STREAMER not in sd._name_voices(e, labels, _voice()).values()
    # An old voiceprint from another model (192 values): ignored
    assert sd.STREAMER not in sd._name_voices(e, labels, np.ones(192)).values()


def test_diarize_and_label_the_words(monkeypatch):
    a, b = _voice(), _voice()
    regions = [(0.0, 6.0), (7.0, 13.0)]
    monkeypatch.setattr(sd, "_speech_regions", lambda audio: regions)
    monkeypatch.setattr(sd, "_embed", lambda audio, wins: _embeddings([a if w[2] == 0 else b for w in wins]))

    segments = sd.diarize_waveform(torch.zeros(1, 16000 * 14), 16000, voiceprint=a)
    assert {s["speaker"] for s in segments} == {sd.STREAMER, "SPEAKER_01"}
    names = sd.identify_speakers(None, 16000, segments, a, "Maurice")
    words = [{"word": "salut", "start": 1.0, "end": 1.4}, {"word": "yo", "start": 8.0, "end": 8.3}]
    assert [w["speaker"] for w in sd.assign_speakers_to_words(words, segments, names)] == ["Maurice", "SPEAKER_01"]


def test_a_word_just_outside_a_turn_joins_the_nearest_one():
    segments = [{"speaker": "A", "start": 1.0, "end": 3.0}, {"speaker": "B", "start": 6.0, "end": 8.0}]
    words = [
        {"word": "voilà", "start": 0.5, "end": 0.9},  # 0.1 s before A
        {"word": "quoi", "start": 5.2, "end": 5.5},  # 0.5 s before B
        {"word": "hein", "start": 10.0, "end": 10.3},  # 2 s after B: nobody
    ]
    labeled = sd.assign_speakers_to_words(words, segments, {"A": "Maurice", "B": "SPEAKER_01"})
    assert [w["speaker"] for w in labeled] == ["Maurice", "SPEAKER_01", None]


def test_naming_keeps_the_segments():
    # The segments used to be wiped when no voices were merged
    segments = [{"speaker": "SPEAKER_01", "start": 0.0, "end": 2.0}, {"speaker": "SPEAKER_02", "start": 2.0, "end": 3.0}]
    names = sd.identify_speakers(None, 16000, segments, None, "Maurice")
    assert len(segments) == 2
    # No voiceprint: the one who talks most is the streamer
    assert names == {"SPEAKER_01": "Maurice", "SPEAKER_02": "SPEAKER_02"}
    # A voiceprint that recognized nobody: the streamer isn't heard
    assert "Maurice" not in sd.identify_speakers(None, 16000, segments, np.ones(256), "Maurice").values()


def test_the_voiceprint_is_the_voice_heard_across_the_live(monkeypatch):
    streamer = _voice()
    guests = [_voice() for _ in range(6)]
    passage = iter(range(6))

    def voices_of(audio):
        # Each passage: the streamer a little, a different guest a lot
        guest = guests[next(passage)]
        wins = _windows([6, 12])
        e = _embeddings([streamer] * 6 + [guest] * 12)
        return [], wins, e, np.array([0] * 6 + [1] * 12)

    monkeypatch.setattr(sd, "_extract_wav_segment", lambda *args: True)
    monkeypatch.setattr(sd, "_load_wav", lambda path: (torch.zeros(1, 16000), 16000))
    monkeypatch.setattr(sd, "_voices_of", voices_of)

    voiceprint = sd.extract_voiceprint("live.wav", starts=[0, 600, 1200, 1800, 2400, 3000])
    assert voiceprint is not None
    assert float(voiceprint @ streamer) > 0.9
    assert all(float(voiceprint @ g) < 0.5 for g in guests)
