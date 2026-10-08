"""Compare pipeline versions and models on the benchmark VODs.

    cd backend
    uv run python -m bench.report            # markdown on stdout, summary in .data/bench/report.json

Outside truth: the clips viewers made on each VOD (Twitch). A system "finds" a
viewer clip when one of its picks covers at least half of it. Human labels,
when present (.data/bench/labels/<vod>.json: {"<start>-<end>": "good"|"meh"|"bad"}),
add precision on the picks.
"""

import json
import statistics
from pathlib import Path

from bench.common import BENCH, VODS, viewer_clips

TOP_N = 20
HEURISTIC_WEIGHT, LLM_WEIGHT = 0.2, 0.8  # same blend as the pipeline


def covers(window: tuple[float, float], clip: dict) -> bool:
    inter = min(window[1], clip["end"]) - max(window[0], clip["start"])
    return inter >= 0.5 * (clip["end"] - clip["start"])


def picks_from_run(result: dict) -> list[dict]:
    """The clips a pipeline run kept, with their VOD windows, best first."""
    picks = []
    for hp in result.get("detected", []):
        t = hp["timestamp_seconds"]
        # Before the fix, detected clips had no window of their own: cut 2 min before / 5 s after
        start, end = (hp["clip_start"], hp["clip_end"]) if result["version"] == "now" and hp.get("clip_start") is not None else (t - 120, t + 5)
        picks.append({"start": start, "end": end, "score": 1.0, "detected": True, "name": hp.get("clip_name")})
    for hp in result.get("kept", []):
        start = hp.get("clip_start") if hp.get("clip_start") is not None else hp["timestamp_seconds"] - 30
        end = hp.get("clip_end") if hp.get("clip_end") is not None else hp["timestamp_seconds"] + 30
        picks.append({"start": start, "end": end, "score": hp.get("final_score") or 0, "detected": False, "name": hp.get("clip_name")})
    return picks


def rank_candidates(rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Rank rated candidates like the pipeline: real "clip" requests are kept,
    the rest is sorted by 0.2 heuristic + 0.8 virality. Returns (picks, all ranked)."""
    detected, normal = [], []
    for r in rows:
        llm = r.get("llm") or {}
        v = llm.get("virality_score") or 0.0
        item = {**r, "final": HEURISTIC_WEIGHT * (r.get("heuristic") or 0) + LLM_WEIGHT * v, "virality": v}
        if r.get("keyword") and llm.get("clip_request") is not False and "error" not in r:
            detected.append({**item, "detected": True})
        else:
            normal.append({**item, "detected": False})
    normal.sort(key=lambda x: -x["final"])
    return detected + normal[:TOP_N], detected + normal


def load_fixture_rows(run: Path) -> list[dict]:
    rows = []
    for fx in sorted((run / "fixtures").iterdir()):
        if not (fx / "meta.json").exists():
            continue
        meta = json.loads((fx / "meta.json").read_text(encoding="utf-8"))
        out = json.loads((fx / "output.json").read_text(encoding="utf-8")) if (fx / "output.json").exists() else {"error": "missing"}
        rows.append({"idx": meta["idx"], "start": meta.get("start"), "end": meta.get("end"), "heuristic": meta.get("heuristic"), "keyword": meta.get("keyword"), **out})
    return rows


def kendall(a: list[int], b: list[int]) -> float | None:
    """Rank agreement of two orderings of the same items (1 = same order)."""
    common = [x for x in a if x in set(b)]
    if len(common) < 3:
        return None
    pos = {x: i for i, x in enumerate(b)}
    conc = disc = 0
    for i in range(len(common)):
        for j in range(i + 1, len(common)):
            if pos[common[i]] < pos[common[j]]:
                conc += 1
            else:
                disc += 1
    return (conc - disc) / (conc + disc)


def system_metrics(name: str, vod: str, picks: list[dict], ranked: list[dict] | None, clips: list[dict], extra: dict) -> dict:
    found = [c for c in clips if any(covers((p["start"], p["end"]), c) for p in picks)]
    ranks = []
    if ranked:
        for c in clips:
            r = next((i + 1 for i, x in enumerate(ranked) if x.get("start") is not None and covers((x["start"], x["end"]), c)), None)
            ranks.append(r)
    labels_file = BENCH / "labels" / f"{vod}.json"
    precision = None
    if labels_file.exists():
        labels = json.loads(labels_file.read_text(encoding="utf-8"))
        judged = []
        for p in picks:
            for key, value in labels.items():
                a, b = map(float, key.split("-"))
                if min(p["end"], b) - max(p["start"], a) >= 0.5 * min(b - a, p["end"] - p["start"]):
                    judged.append(value)
                    break
        if judged:
            precision = {"good": judged.count("good"), "meh": judged.count("meh"), "bad": judged.count("bad"), "judged": len(judged)}
    return {"system": name, "vod": vod, "picks": len(picks), "viewer_clips": len(clips), "found": len(found), "ranks": ranks, "precision": precision, **extra}


def main() -> None:
    rows_out = []
    for vod in VODS:
        clips = viewer_clips(vod)
        runs = {f"{p.parent.parent.name}/{p.parent.name}": p for p in (BENCH / "runs").glob(f"*/*/{vod}") if (p / "result.json").exists()}
        if not runs:
            continue
        baseline_order = None
        for key, run in sorted(runs.items()):
            result = json.loads((run / "result.json").read_text(encoding="utf-8"))
            rows = load_fixture_rows(run)
            _, ranked = rank_candidates(rows)
            if key == "now/run1":
                baseline_order = [r["idx"] for r in ranked]
            viral = [r["virality"] for r in ranked if "error" not in r]
            rows_out.append(system_metrics(
                f"pipeline {key}", vod, picks_from_run(result), ranked, clips,
                {"cost": result.get("llm_cost"), "seconds": result.get("seconds"), "failed": sum(1 for r in rows if "error" in r), "rated": len(rows),
                 "spread": round(statistics.pstdev(viral), 3) if len(viral) > 1 else None, "distinct": len({round(v, 2) for v in viral})},
            ))
            if key == "now/run1":
                # The funnel: every scored candidate, then the ~50 the LLM rated (models only re-rank these)
                # The scorer's candidates are the same for every run of a version: take any that kept them
                scored = next((r / "candidates.json" for k, r in sorted(runs.items()) if k.startswith("now/") and (r / "candidates.json").exists()), None)
                if scored:
                    cands = [c for c in json.loads(scored.read_text(encoding="utf-8")) if c.get("start") is not None]
                    rows_out.append(system_metrics(f"funnel: all {len(cands)} scored candidates", vod, cands, None, clips, {}))
                rows_out.append(system_metrics("funnel: the ~50 rated by the LLM", vod, [r for r in rows if r.get("start") is not None], None, clips, {}))
        for replay in sorted((BENCH / "replays").glob(f"*/*/{vod}.json")):
            if "-probe" in replay.parent.parent.name:
                continue
            data = json.loads(replay.read_text(encoding="utf-8"))
            picks, ranked = rank_candidates(data["results"])
            ok = [r for r in data["results"] if "error" not in r]
            viral = [(r.get("llm") or {}).get("virality_score") or 0 for r in ok]
            seconds = [r["seconds"] for r in ok if r.get("seconds")]
            cuts = [r["llm"] for r in ok if (r.get("llm") or {}).get("cut_start") is not None]
            rows_out.append(system_metrics(
                f"model {data['model']}", vod, picks, ranked, clips,
                {"cost": data["cost"], "failed": data["failed"], "rated": len(data["results"]),
                 "spread": round(statistics.pstdev(viral), 3) if len(viral) > 1 else None, "distinct": len({round(v, 2) for v in viral}),
                 "latency": round(statistics.mean(seconds), 1) if seconds else None,
                 "cuts": len(cuts), "cut_len": round(statistics.mean(c["cut_end"] - c["cut_start"] for c in cuts), 1) if cuts else None,
                 "hooks": sum(1 for r in ok if (r.get("llm") or {}).get("hook")),
                 "tau_vs_baseline": round(kendall([r["idx"] for r in ranked], baseline_order), 2) if baseline_order else None,
                 "top_overlap": len({r["idx"] for r in picks} & set(baseline_order[:TOP_N])) if baseline_order else None},
            ))

    (BENCH / "report.json").write_text(json.dumps(rows_out, ensure_ascii=False, indent=1), encoding="utf-8")

    # Totals per system across VODs
    systems: dict[str, list[dict]] = {}
    for r in rows_out:
        systems.setdefault(r["system"], []).append(r)
    print(f"| system | VODs | viewer clips found | mean rank of viewer clips | cost/VOD | failed | spread | top-20 overlap vs current |")
    print("|---|---|---|---|---|---|---|---|")
    for name, rs in systems.items():
        found = sum(r["found"] for r in rs)
        total = sum(r["viewer_clips"] for r in rs)
        ranks = [x for r in rs for x in r["ranks"] if x]
        missing = sum(1 for r in rs for x in r["ranks"] if x is None)
        costs = [r["cost"] for r in rs if r.get("cost") is not None]
        spreads = [r["spread"] for r in rs if r.get("spread") is not None]
        overlaps = [r["top_overlap"] for r in rs if r.get("top_overlap") is not None]
        print(
            f"| {name} | {len(rs)} | {found}/{total} | {statistics.mean(ranks):.1f}{f' (+{missing} not rated)' if missing else ''} | "
            f"{f'${statistics.mean(costs):.2f}' if costs else '-'} | {sum(r.get('failed') or 0 for r in rs)} | "
            f"{f'{statistics.mean(spreads):.3f}' if spreads else '-'} | {f'{statistics.mean(overlaps):.1f}/20' if overlaps else '-'} |"
            if ranks else
            f"| {name} | {len(rs)} | {found}/{total} | - | {f'${statistics.mean(costs):.2f}' if costs else '-'} | {sum(r.get('failed') or 0 for r in rs)} | "
            f"{f'{statistics.mean(spreads):.3f}' if spreads else '-'} | {f'{statistics.mean(overlaps):.1f}/20' if overlaps else '-'} |"
        )


if __name__ == "__main__":
    main()
