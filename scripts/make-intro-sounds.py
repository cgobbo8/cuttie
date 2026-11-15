#!/usr/bin/env python3
"""The sounds of the intros, made from nothing (sine waves, noise, filters): nobody's
recording is in them, so they can ship with the app and go on any platform.

    cd backend && uv run python ../scripts/make-intro-sounds.py
    node scripts/sync-remotion.mjs        # copies them to the server renderer

Writes frontend/public/sounds/intro-<id>.mp3 (44.1 kHz stereo, peak -3 dBFS). Each one is
timed on its intro (frontend/src/lib/intro/IntroCard.tsx): the hit of "boom" falls when the
logo lands, the drums of "drum" when the stickers of the title are slapped on.
"""

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy import signal

SR = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "public", "sounds")
rng = np.random.default_rng(7)


def t(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def place(track: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0) -> None:
    start = int(at * SR)
    end = min(len(track), start + len(sound))
    if end > start:
        track[start:end] += sound[: end - start] * gain


def band(x: np.ndarray, low: float, high: float) -> np.ndarray:
    sos = signal.butter(2, [low, high], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lowpass(x: np.ndarray, cut: float) -> np.ndarray:
    return signal.sosfilt(signal.butter(2, cut, btype="low", fs=SR, output="sos"), x)


def highpass(x: np.ndarray, cut: float) -> np.ndarray:
    return signal.sosfilt(signal.butter(2, cut, btype="high", fs=SR, output="sos"), x)


def sweep(seconds: float, f0: float, f1: float, shape: str = "up") -> np.ndarray:
    """Air moving past: noise through a band that slides from f0 to f1."""
    n = int(seconds * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    block = 512
    zi = None
    for i in range(0, n, block):
        k = (i + block / 2) / n
        f = f0 * (f1 / f0) ** k
        sos = signal.butter(2, [f * 0.7, min(f * 1.4, SR / 2 - 100)], btype="band", fs=SR, output="sos")
        if zi is None:
            zi = signal.sosfilt_zi(sos) * 0
        out[i : i + block], zi = signal.sosfilt(sos, noise[i : i + block], zi=zi)
    k = np.linspace(0, 1, n)
    env = {"up": k**2.2, "down": (1 - k) ** 1.6, "pass": np.sin(np.pi * k) ** 1.5}[shape]
    return out * env


def thud(seconds: float, f0: float, f1: float, decay: float) -> np.ndarray:
    """A low hit: a tone that falls fast, with a click on top."""
    x = t(seconds)
    freq = f1 + (f0 - f1) * np.exp(-x * 14)
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-x * decay)
    click = lowpass(rng.standard_normal(len(x)), 3500) * np.exp(-x * 90) * 0.5
    return np.tanh((tone + click) * 1.6)


def bell(seconds: float, freq: float, decay: float = 5.0) -> np.ndarray:
    """A struck bar: a tone and two partials that die faster."""
    x = t(seconds)
    return (
        np.sin(2 * np.pi * freq * x) * np.exp(-x * decay)
        + 0.45 * np.sin(2 * np.pi * freq * 2.76 * x) * np.exp(-x * decay * 2.2)
        + 0.25 * np.sin(2 * np.pi * freq * 5.4 * x) * np.exp(-x * decay * 3.5)
    )


def tom(freq: float) -> np.ndarray:
    x = t(0.32)
    f = freq * (1 + 0.6 * np.exp(-x * 30))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 13)
    skin = highpass(rng.standard_normal(len(x)), 1800) * np.exp(-x * 60) * 0.25
    return body + skin


def room(x: np.ndarray, seconds: float = 0.5, wet: float = 0.16) -> np.ndarray:
    """A little space around a dry sound."""
    n = int(seconds * SR)
    tail = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * (6.9 / seconds))
    tail = lowpass(tail, 5000)
    tail /= np.sqrt(np.sum(tail**2))
    return x + wet * signal.fftconvolve(x, tail)[: len(x)]


def follow(track: np.ndarray, hold: float) -> None:
    """The follow button is pressed 0.4 s before the video starts: a soft tick, then a small chime. Kept low: it is a detail."""
    at = hold - 0.4
    x = t(0.05)
    tick = np.sin(2 * np.pi * np.cumsum(900 + 700 * x / 0.05) / SR) * np.exp(-x * 70)
    place(track, tick, at, 0.2)
    place(track, bell(0.45, 1318.5, 10), at + 0.07, 0.11)
    place(track, bell(0.45, 1975.5, 12), at + 0.13, 0.07)


def boom() -> np.ndarray:
    """The logo falls (0.27 s): air rushing in, then a deep hit that rings out."""
    track = np.zeros(int(1.75 * SR))
    place(track, sweep(0.3, 300, 4500, "up"), 0.0, 0.55)
    place(track, thud(1.3, 150, 40, 3.2), 0.27, 1.0)
    place(track, band(rng.standard_normal(int(0.5 * SR)), 180, 2400) * np.exp(-t(0.5) * 9), 0.27, 0.5)
    place(track, bell(1.0, 392, 4.5), 0.47, 0.16)
    follow(track, 1.600)
    return room(track, 0.6, 0.2)


def swish() -> np.ndarray:
    """Three bands cross the screen, the logo rolls in, the title lands (0.9 s)."""
    track = np.zeros(int(2.0 * SR))
    for i, at in enumerate((0.0, 0.1, 0.2)):
        place(track, sweep(0.42, 500 + 250 * i, 5200 + 900 * i, "pass"), at, 0.5)
    place(track, sweep(0.5, 900, 2600, "pass"), 0.42, 0.3)
    for freq, at in ((659.3, 0.9), (987.8, 0.98), (1318.5, 1.06)):
        place(track, bell(0.9, freq, 6.5), at, 0.34)
    place(track, thud(0.3, 110, 60, 16), 0.9, 0.45)
    # The bands leave
    place(track, sweep(0.35, 3000, 600, "down"), 1.72, 0.35)
    follow(track, 1.800)
    return room(track, 0.4, 0.14)


def zap() -> np.ndarray:
    """A screen that misbehaves: bursts of a harsh tone, crackle, then it holds; a last stutter as it goes."""
    n = int(1.7 * SR)
    track = np.zeros(n)
    x = t(1.7)
    at = 0.0
    while at < 0.52:
        length = rng.uniform(0.018, 0.07)
        freq = rng.choice([110, 220, 330, 880, 1760, 2640])
        burst = np.sign(np.sin(2 * np.pi * freq * t(length)))
        # Crushed: held on a few samples
        hold = int(rng.integers(2, 9))
        burst = np.repeat(burst[::hold], hold)[: len(burst)] * rng.uniform(0.25, 0.6)
        place(track, burst, at)
        at += length + rng.uniform(0.0, 0.05)
    crackle = (rng.random(n) > 0.9985) * rng.uniform(-1, 1, n)
    track += lowpass(crackle, 6000) * 2.2 * (x < 0.6)
    place(track, thud(0.7, 130, 46, 6), 0.52, 0.9)
    hum = np.sin(2 * np.pi * 55 * x) * 0.1 * ((x > 0.55) & (x < 1.45))
    track += hum
    for at in (1.46, 1.52, 1.57):
        place(track, np.sign(np.sin(2 * np.pi * 440 * t(0.03))) * 0.4, at)
    follow(track, 1.500)
    return highpass(room(track, 0.25, 0.08), 30)


# Square waves sound louder than their peak says: brought down to sit with the others
TRIM = {"zap": 0.72}


def shine() -> np.ndarray:
    """A ring of light draws itself, the tube catches (0.8 s), a chord opens."""
    track = np.zeros(int(2.4 * SR))
    x = t(0.95)
    pad = sum(signal.sawtooth(2 * np.pi * f * x) for f in (110.0, 110.6, 164.8, 165.5, 220.3))
    pad = lowpass(pad, 900) * (x / 0.95) ** 1.8 * 0.1
    place(track, pad, 0.0)
    place(track, sweep(0.8, 1200, 7000, "up"), 0.0, 0.16)
    # The tube: a mains buzz that cuts in and out
    for at, length in ((0.8, 0.03), (0.87, 0.06), (0.97, 0.03)):
        place(track, np.sign(np.sin(2 * np.pi * 100 * t(length))) * 0.18 + np.sin(2 * np.pi * 50 * t(length)) * 0.2, at)
    for freq, at, gain in ((440.0, 1.07, 0.3), (554.4, 1.09, 0.26), (659.3, 1.11, 0.24), (830.6, 1.13, 0.2), (1318.5, 1.2, 0.12)):
        place(track, bell(1.25, freq, 2.6), at, gain)
    place(track, thud(0.5, 90, 45, 9), 1.07, 0.35)
    follow(track, 2.000)
    return room(track, 0.9, 0.24)


def rush() -> np.ndarray:
    """Speed lines burst out, the logo rushes in: air and a tone that climb, then the title slams down (0.4 s)."""
    track = np.zeros(int(1.75 * SR))
    place(track, sweep(0.42, 250, 6500, "up"), 0.0, 0.6)
    x = t(0.4)
    climb = np.sin(2 * np.pi * np.cumsum(180 * (7.5 ** (x / 0.4))) / SR) * (x / 0.4) ** 2
    place(track, lowpass(climb, 5000), 0.0, 0.22)
    place(track, thud(1.0, 170, 44, 4.5), 0.4, 1.0)
    crash = highpass(rng.standard_normal(int(0.9 * SR)), 3500) * np.exp(-t(0.9) * 6)
    place(track, crash, 0.4, 0.3)
    # The lines rush away as the video starts
    place(track, sweep(0.3, 1500, 7000, "up"), 1.5, 0.3)
    follow(track, 1.533)
    return room(track, 0.5, 0.16)


def drum() -> np.ndarray:
    """Stickers slapped on a wall: a clap for the logo (0.2 s), a drum for each line of the title, air as they fly off."""
    track = np.zeros(int(2.2 * SR))
    clap = band(rng.standard_normal(int(0.25 * SR)), 900, 6000) * np.exp(-t(0.25) * 22)
    place(track, clap, 0.2, 0.8)
    place(track, thud(0.4, 130, 55, 11), 0.2, 0.6)
    for freq, at in ((98, 0.47), (123, 0.63), (147, 0.8), (196, 0.97)):
        place(track, tom(freq), at, 0.8)
    place(track, bell(0.7, 587.3, 6.5), 1.07, 0.22)
    place(track, sweep(0.4, 700, 5200, "up"), 1.78, 0.45)
    follow(track, 1.800)
    return room(track, 0.35, 0.14)


def clash() -> np.ndarray:
    """Two halves slam together (0.33 s): air from both sides, metal on metal, then the screen pulls apart."""
    track = np.zeros(int(2.15 * SR))
    place(track, sweep(0.36, 400, 3800, "up"), 0.0, 0.5)
    place(track, sweep(0.36, 5200, 900, "up"), 0.0, 0.35)
    x = t(1.1)
    # Struck metal: partials that don't line up, the high ones gone first
    clang = sum(np.sin(2 * np.pi * f * x) * np.exp(-x * d) * g for f, d, g in ((523, 5, 1.0), (811, 7, 0.7), (1317, 10, 0.55), (2093, 14, 0.4), (3271, 20, 0.3)))
    place(track, clang, 0.33, 0.3)
    place(track, thud(0.9, 150, 42, 5), 0.33, 1.0)
    place(track, band(rng.standard_normal(int(0.2 * SR)), 1500, 7000) * np.exp(-t(0.2) * 30), 0.33, 0.5)
    place(track, sweep(0.5, 600, 4200, "pass"), 1.62, 0.45)
    follow(track, 1.667)
    return room(track, 0.55, 0.18)


def square(freq: float, seconds: float) -> np.ndarray:
    """An old console's voice: a square wave with a short tail."""
    x = t(seconds)
    return np.sign(np.sin(2 * np.pi * freq * x)) * np.minimum(1, (seconds - x) / 0.02)


def coin() -> np.ndarray:
    """An arcade screen: the tube thumps on, blips as the logo comes block by block, a coin drops (0.87 s), the tube goes out."""
    track = np.zeros(int(2.25 * SR))
    place(track, thud(0.35, 90, 50, 14), 0.0, 0.7)
    x = t(0.25)
    place(track, np.sin(2 * np.pi * np.cumsum(2000 + 9000 * x / 0.25) / SR) * (1 - x / 0.25) * 0.5, 0.0, 0.12)
    for i in range(9):
        place(track, square(float(rng.choice([392, 523, 659, 784, 1047])), 0.035), 0.2 + i * 0.06, 0.13)
    place(track, square(987.8, 0.07), 0.87, 0.28)
    place(track, square(1318.5, 0.32) * np.exp(-t(0.32) * 5), 0.94, 0.28)
    # Out: a tone that falls away as the picture shrinks to a dot
    x = t(0.22)
    place(track, np.sin(2 * np.pi * np.cumsum(700 * np.exp(-x * 12) + 50) / SR) * np.exp(-x * 9), 1.87, 0.55)
    follow(track, 1.867)
    return lowpass(room(track, 0.3, 0.1), 9000)


def sting() -> np.ndarray:
    """A news ident: three notes stabbed out as the banner slams across, a drum under the last, a chord held while the title opens."""
    track = np.zeros(int(2.2 * SR))

    def brass(freq: float, seconds: float) -> np.ndarray:
        x = t(seconds)
        tone = sum(signal.sawtooth(2 * np.pi * freq * detune * x) for detune in (1.0, 1.006, 0.5))
        return lowpass(tone, 2600) * np.minimum(1, x / 0.012) * np.exp(-x * (2.2 / seconds))

    for freq, at, length in ((392.0, 0.27, 0.13), (523.3, 0.4, 0.13), (659.3, 0.53, 0.9)):
        place(track, brass(freq, length), at, 0.34)
    for freq in (261.6, 392.0):
        place(track, brass(freq, 0.9), 0.53, 0.2)
    place(track, thud(0.8, 120, 55, 6), 0.53, 0.55)
    place(track, sweep(0.3, 500, 4500, "up"), 0.0, 0.4)
    # The set lifts away
    place(track, sweep(0.4, 900, 5200, "up"), 1.78, 0.4)
    follow(track, 1.8)
    return room(track, 0.5, 0.16)


def glass() -> np.ndarray:
    """The logo hits the screen, which cracks (0.27 s); then the whole screen falls in pieces (1.67 s)."""
    track = np.zeros(int(2.3 * SR))
    place(track, sweep(0.28, 300, 4200, "up"), 0.0, 0.5)
    place(track, thud(1.0, 150, 42, 4.5), 0.27, 0.75)
    crack = highpass(rng.standard_normal(int(0.12 * SR)), 4000) * np.exp(-t(0.12) * 45)
    place(track, crack, 0.27, 0.6)
    place(track, crack[::-1] * 0.4, 0.4, 0.5)

    def shard(freq: float) -> np.ndarray:
        x = t(0.4)
        return (np.sin(2 * np.pi * freq * x) + 0.5 * np.sin(2 * np.pi * freq * 2.41 * x)) * np.exp(-x * rng.uniform(12, 30))

    # Glass: many small bright rings, none at the same time or the same pitch
    for _ in range(26):
        place(track, shard(rng.uniform(2200, 7500)), 1.67 + rng.uniform(0, 0.32), rng.uniform(0.1, 0.26))
    place(track, highpass(rng.standard_normal(int(0.35 * SR)), 3000) * np.exp(-t(0.35) * 11), 1.67, 0.5)
    place(track, thud(0.4, 110, 50, 12), 1.67, 0.6)
    follow(track, 1.667)
    return room(track, 0.4, 0.14)


def beep() -> np.ndarray:
    """A film leader: a beep for 3, for 2, for 1 (every 0.3 s), then the logo and the title hit (0.9 s)."""
    track = np.zeros(int(2.5 * SR))
    x = t(0.09)
    tone = np.sin(2 * np.pi * 1000 * x) * np.minimum(1, np.minimum(x, 0.09 - x) / 0.006)
    for at in (0.0, 0.3, 0.6):
        place(track, tone, at, 0.42)
    # The projector running under the count
    flick = lowpass(rng.standard_normal(int(0.9 * SR)), 1800) * (0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 24 * t(0.9)))) * 0.05
    place(track, flick, 0.0)
    place(track, np.sin(2 * np.pi * 2000 * t(0.22)) * np.exp(-t(0.22) * 9), 0.9, 0.3)
    place(track, thud(1.1, 160, 42, 4), 0.9, 1.0)
    place(track, highpass(rng.standard_normal(int(0.8 * SR)), 3500) * np.exp(-t(0.8) * 6), 0.9, 0.28)
    place(track, bell(1.0, 523.3, 4), 0.95, 0.14)
    place(track, sweep(0.3, 1200, 6500, "up"), 1.95, 0.3)
    follow(track, 2.0)
    return room(track, 0.5, 0.16)


SOUNDS = {"boom": boom, "swish": swish, "zap": zap, "shine": shine, "rush": rush, "drum": drum, "clash": clash, "coin": coin, "sting": sting, "glass": glass, "beep": beep}


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    for name, make in SOUNDS.items():
        mono = make()
        # A little width: the right ear hears it a hair later
        delay = int(0.0004 * SR)
        stereo = np.stack([mono, np.concatenate([np.zeros(delay), mono[:-delay]])], axis=1)
        fade = int(0.03 * SR)
        stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
        stereo *= 10 ** (-3 / 20) / np.max(np.abs(stereo)) * TRIM.get(name, 1.0)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        with wave.open(path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((stereo * 32767).astype("<i2").tobytes())
        target = os.path.join(OUT, f"intro-{name}.mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-codec:a", "libmp3lame", "-b:a", "160k", target], check=True)
        os.unlink(path)
        print(f"{name}: {len(mono) / SR:.2f} s -> {os.path.relpath(target)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
