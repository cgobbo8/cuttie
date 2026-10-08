"""Run one version of the analysis pipeline on a VOD, in isolation, and record
what the LLM saw for every candidate it rated (prompt, audio, frames) and what
it answered, so other models can be replayed on exactly the same inputs.

    cd backend
    uv run python -m bench.run_pipeline --version now --vod 2886567499
    uv run python -m bench.run_pipeline --version before --vod 2886567499   # code of BEFORE_COMMIT

No clip is cut (the benchmark only needs the picks and their windows) and no
project shows up in the app.
"""

import argparse
import json
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

from bench.common import BENCH, REPO, Usage, meter_openrouter, run_dir, setup, viewer_clips

# Last worker code before the 2026-10-08 pipeline fixes (16 kHz PANNs, chat lag, AI cut...)
BEFORE_COMMIT = "58d74af"


def code_dir(version: str) -> Path:
    if version == "now":
        return REPO / "backend"
    tree = BENCH / f"code-{version}"
    if not tree.exists():
        subprocess.run(["git", "-C", str(REPO), "worktree", "add", "--detach", str(tree), BEFORE_COMMIT], check=True, capture_output=True)
    return tree / "backend"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", choices=["now", "before"], default="now")
    ap.add_argument("--vod", required=True)
    ap.add_argument("--label", default="run1", help="several runs of the same version measure the LLM's own randomness")
    ap.add_argument("--model", default=None, help="LLM for the per-candidate analysis (default: the app's)")
    args = ap.parse_args()

    out = run_dir(args.version, args.vod, args.label)
    if (out / "result.json").exists():
        print(f"already done: {out}")
        return
    fixtures = out / "fixtures"
    fixtures.mkdir(parents=True, exist_ok=True)
    setup(BENCH / "data" / f"{args.version}-{args.label}-{args.vod}", code_dir(args.version))

    # The worker code of the chosen version, imported only now
    from app.services import db, llm_analyzer, pipeline

    usage = Usage()
    meter_openrouter(llm_analyzer, usage)
    if args.model:
        llm_analyzer.LLM_MODEL = args.model
    model = llm_analyzer.LLM_MODEL

    # Candidate windows by index (the audio segment seg_<idx>.mp3 tells which one the LLM rates)
    windows: dict[int, dict] = {}
    real_transcribe = llm_analyzer._transcribe_candidates

    def transcribe(wav_path, candidates, *rest, **kw):
        for idx, hp in candidates:
            windows[idx] = {
                "idx": idx,
                "start": hp.clip_start,
                "end": hp.clip_end,
                "peak": hp.timestamp_seconds,
                "heuristic": hp.score,
                "signals": hp.signals.model_dump(),
            }
        return real_transcribe(wav_path, candidates, *rest, **kw)

    llm_analyzer._transcribe_candidates = transcribe

    content: dict[int, float] = {}
    real_context = llm_analyzer.gather_vod_context

    def context(job_id, transcripts, hot_points, vod_meta):
        vod_context, scores = real_context(job_id, transcripts, hot_points, vod_meta)
        content.update(scores)
        return vod_context, scores

    llm_analyzer.gather_vod_context = context

    real_call = llm_analyzer._call_unified_llm

    def record(frames, prompt, audio_path=None, duration=None):
        m = re.search(r"seg_(\d+)\.mp3$", audio_path or "")
        idx = int(m.group(1)) if m else len(list(fixtures.iterdir())) + 1000
        fx = fixtures / f"{idx:03d}"
        (fx / "frames").mkdir(parents=True, exist_ok=True)
        if audio_path:
            shutil.copy(audio_path, fx / "audio.mp3")
        saved = []
        for i, f in enumerate(frames):
            name = f"{i:02d}.jpg"
            try:
                shutil.copy(f["path"], fx / "frames" / name)
                saved.append({"file": name, "time": f["time"]})
            except OSError:
                pass
        (fx / "prompt.txt").write_text(prompt, encoding="utf-8")
        meta = {**windows.get(idx, {"idx": idx}), "duration": duration, "frames": saved, "keyword": '"Clip" said on stream' in prompt}
        (fx / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
        usage.reset_thread()
        t0 = time.time()
        try:
            llm, clip_name = real_call(frames, prompt, audio_path, duration)
        except Exception as e:
            (fx / "output.json").write_text(json.dumps({"model": model, "error": str(e)[:500], "usage": usage.last()}, ensure_ascii=False, indent=1), encoding="utf-8")
            raise
        (fx / "output.json").write_text(
            json.dumps({"model": model, "seconds": round(time.time() - t0, 2), "clip_name": clip_name, "llm": llm.model_dump(), "usage": usage.last()}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        return llm, clip_name

    llm_analyzer._call_unified_llm = record

    # The picks, with their windows, as the pipeline hands them to clipping
    picked: dict = {}
    real_analyze = pipeline.analyze_candidates

    def analyze(*a, **kw):
        result = real_analyze(*a, **kw)
        kept, detected = result[0], result[1]
        picked["kept"] = [hp.model_dump() for hp in kept]
        picked["detected"] = [hp.model_dump() for hp in detected]
        return result

    pipeline.analyze_candidates = analyze
    pipeline._run_clipping_only = lambda *a, **kw: None  # no clip files: the windows are enough

    job_id = str(uuid.uuid4())
    url = f"https://www.twitch.tv/videos/{args.vod}"
    db.init_db()
    db.create_job(job_id, url)
    t0 = time.time()
    pipeline.run_pipeline_sync(job_id, url)
    job = db.get_job(job_id)
    if job is None or job.status != "DONE" or "kept" not in picked:
        raise SystemExit(f"pipeline failed: {job.status if job else '?'} {job.error if job else ''}")

    (out / "result.json").write_text(
        json.dumps(
            {
                "version": args.version,
                "commit": BEFORE_COMMIT if args.version == "before" else subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
                "vod": args.vod,
                "model": model,
                "seconds": round(time.time() - t0, 1),
                "llm_cost": round(usage.total_cost, 4),
                "llm_calls": usage.calls,
                "step_timings": {k: v.model_dump() for k, v in (job.step_timings or {}).items()},
                **picked,
            },
            ensure_ascii=False,
            indent=1,
        ),
        encoding="utf-8",
    )
    # Every candidate the scorer proposed (before the pre-filter keeps ~50 for the LLM)
    (out / "candidates.json").write_text(
        json.dumps([{**w, "content": content.get(i)} for i, w in sorted(windows.items())], ensure_ascii=False, indent=1), encoding="utf-8"
    )
    viewer_clips(args.vod)
    print(f"done in {time.time() - t0:.0f}s, LLM {usage.calls} calls ${usage.total_cost:.3f} -> {out}")


if __name__ == "__main__":
    main()
