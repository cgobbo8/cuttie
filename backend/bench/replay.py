"""Replay the per-candidate LLM analysis with another model, on the exact inputs
a pipeline run recorded (same prompt, audio and frames), through the app's own
call and parsing code.

    cd backend
    uv run python -m bench.replay --model qwen/qwen3.8-omni-flash --vod 2886567499 --budget 1.5
"""

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from bench.common import BENCH, Usage, meter_openrouter, run_dir, setup


def replay_path(model: str, vod: str, source: str) -> Path:
    return BENCH / "replays" / source / model.replace("/", "__").replace(":", "_") / f"{vod}.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--vod", required=True)
    ap.add_argument("--source", default="now/run1", help="recorded run to replay (version/label)")
    ap.add_argument("--budget", type=float, default=2.0, help="stop starting new calls past this many dollars")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0, help="probe: only the first N candidates (kept apart from real replays)")
    args = ap.parse_args()

    version, label = args.source.split("/")
    fixtures = run_dir(version, args.vod, label) / "fixtures"
    if not fixtures.exists():
        raise SystemExit(f"no recorded run at {fixtures}: run bench.run_pipeline first")
    out = replay_path(args.model, args.vod, args.source.replace("/", "-") + (f"-probe{args.limit}" if args.limit else ""))
    if out.exists():
        print(f"already done: {out}")
        return

    setup(BENCH / "data" / "replay")
    from app.services import llm_analyzer

    usage = Usage()
    meter_openrouter(llm_analyzer, usage)
    llm_analyzer.LLM_MODEL = args.model

    def one(fx: Path) -> dict:
        meta = json.loads((fx / "meta.json").read_text(encoding="utf-8"))
        base = {"idx": meta["idx"], "start": meta.get("start"), "end": meta.get("end"), "heuristic": meta.get("heuristic"), "keyword": meta.get("keyword")}
        if usage.total_cost >= args.budget:
            return {**base, "error": "budget"}
        frames = [{"path": str(fx / "frames" / f["file"]), "time": f["time"]} for f in meta.get("frames", [])]
        audio = fx / "audio.mp3"
        usage.reset_thread()
        t0 = time.time()
        try:
            llm, clip_name = llm_analyzer._call_unified_llm(frames, (fx / "prompt.txt").read_text(encoding="utf-8"), str(audio) if audio.exists() else None, meta.get("duration"))
        except Exception as e:
            return {**base, "error": f"{type(e).__name__}: {str(e)[:300]}", "seconds": round(time.time() - t0, 2), "usage": usage.last()}
        return {**base, "seconds": round(time.time() - t0, 2), "clip_name": clip_name, "llm": llm.model_dump(exclude={"transcript"}), "usage": usage.last()}

    dirs = sorted(d for d in fixtures.iterdir() if (d / "meta.json").exists())
    if args.limit:
        dirs = dirs[: args.limit]
    t0 = time.time()
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for fut in as_completed([pool.submit(one, d) for d in dirs]):
            results.append(fut.result())
    results.sort(key=lambda r: r["idx"])
    failed = sum(1 for r in results if "error" in r)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"model": args.model, "vod": args.vod, "source": args.source, "seconds": round(time.time() - t0, 1), "cost": round(usage.total_cost, 4), "failed": failed, "results": results}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    print(f"{args.model} on {args.vod}: {len(results) - failed}/{len(results)} answered, ${usage.total_cost:.3f}, {time.time() - t0:.0f}s -> {out}")


if __name__ == "__main__":
    main()
