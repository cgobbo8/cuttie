#!/usr/bin/env python3
"""Puts the background musics where the app reads them: api/public/musics/<id>.mp3.

    cd backend && uv run python ../scripts/make-musics.py ~/Downloads/cuttie-musics            # copy them in (128 kb/s)
    cd backend && uv run python ../scripts/make-musics.py ~/Downloads/cuttie-musics --measure  # and print what is measured
    cd backend && uv run python ../scripts/make-musics.py --listen                             # what the AI hears in each (paid: about 0.001 $ a track)
    cd backend && uv run python ../scripts/make-musics.py --listen --only trap,sneaky          # the same for these tracks only

The folder holds the tracks as downloaded; frontend/src/lib/music/catalogue.json says which
file is which track (and what each one is: its kinds, what it sounds like). `--measure`
prints, for each, the tempo, the loudness and where it is in full swing: the numbers the
catalogue keeps (`bpm`, `lufs`, `start`).
"""

import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOGUE = os.path.join(HERE, "..", "frontend", "src", "lib", "music", "catalogue.json")
OUT = os.path.join(HERE, "..", "api", "public", "musics")


def measure(path: str) -> dict:
    import librosa
    import numpy as np

    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 512
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    per_second = sr / hop
    window = int(per_second)
    # How loud each second-long stretch is: "in full swing" is near the loudest tenth of them
    energy = np.convolve(rms**2, np.ones(window) / window, mode="valid")
    full = np.percentile(energy, 90)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
    beat_times = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    onsets = librosa.onset.onset_detect(y=y, sr=sr, hop_length=hop, units="time")
    if energy[: max(1, int(0.5 * per_second))].mean() >= 0.5 * full:
        start = max(0.0, float(onsets[0]) - 0.02) if len(onsets) else 0.0
    else:
        at = int(np.argmax(energy >= 0.8 * full)) / per_second
        start = max(0.0, float(beat_times[np.abs(beat_times - at).argmin()]) - 0.02) if len(beat_times) else at
    printed = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    lufs = float(re.findall(r"I:\s+(-?\d+(?:\.\d+)?) LUFS", printed)[-1])
    return {"seconds": round(len(y) / sr, 1), "bpm": round(float(np.atleast_1d(tempo)[0])), "start": round(start, 2), "lufs": lufs}


def listen(tracks: list[dict]) -> int:
    """What a model that hears says of each track already in the app: printed as JSON, to write the catalogue from."""
    sys.path.insert(0, os.path.join(HERE, "..", "backend"))
    from app.services import music_library

    heard, cost = {}, 0.0
    for track in tracks:
        path = os.path.join(OUT, f"{track['id']}.mp3")
        if not os.path.isfile(path):
            print(f"missing: {track['id']}.mp3", file=sys.stderr)
            continue
        said = music_library.listen(path, track, "fr", hint=track["file"])
        cost += said.pop("cost")
        heard[track["id"]] = said
        print(f"{track['id']:10s} {said['genre']:22s} {', '.join(said['kinds']):24s} {said['description']}", file=sys.stderr, flush=True)
    print(json.dumps(heard, ensure_ascii=False, indent=1))
    print(f"~{cost:.4f} $ for {len(heard)} tracks", file=sys.stderr)
    return 0


def main(argv: list[str]) -> int:
    with open(CATALOGUE, encoding="utf-8") as f:
        tracks = json.load(f)["tracks"]
    if "--only" in argv:
        wanted = set(argv[argv.index("--only") + 1].split(","))
        tracks = [track for track in tracks if track["id"] in wanted]
        argv = [arg for i, arg in enumerate(argv) if arg != "--only" and argv[i - 1] != "--only"]
    if "--listen" in argv:
        return listen(tracks)
    if len(argv) < 2:
        print(__doc__)
        return 2
    folder = os.path.expanduser(argv[1])
    os.makedirs(OUT, exist_ok=True)
    for track in tracks:
        source = os.path.join(folder, track["file"])
        if not os.path.isfile(source):
            print(f"missing: {track['file']}")
            continue
        target = os.path.join(OUT, f"{track['id']}.mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", source, "-map", "0:a:0", "-map_metadata", "-1", "-ac", "2", "-ar", "44100", "-codec:a", "libmp3lame", "-b:a", "128k", target], check=True)
        line = f"{track['id']:10s} {os.path.getsize(target) / 1e6:.1f} MB"
        if "--measure" in argv:
            line += f"  {measure(source)}"
        print(line, flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
