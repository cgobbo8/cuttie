"""Blind human labels for the benchmark: only the clips the systems disagree on,
shuffled, without scores or system names.

    cd backend
    uv run python -m bench.labels prepare          # picks the clips to judge, cuts them from the VODs
    uv run python -m bench.labels serve            # http://localhost:8765 — G good / B meh / X bad

Labels land in .data/bench/labels/<vod>.json, which bench.report reads.
"""

import argparse
import json
import random
import subprocess
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from bench.common import BENCH, VODS, setup
from bench.report import load_fixture_rows, picks_from_run, rank_candidates

LABELS = BENCH / "labels"
MEDIA = LABELS / "media"


def _same(a: dict, b: dict) -> bool:
    inter = min(a["end"], b["end"]) - max(a["start"], b["start"])
    return inter >= 0.5 * min(a["end"] - a["start"], b["end"] - b["start"])


def system_picks(vod: str) -> dict[str, list[dict]]:
    """Every system's picks on a VOD: pipeline runs and model replays."""
    systems: dict[str, list[dict]] = {}
    for run in (BENCH / "runs").glob(f"*/*/{vod}"):
        if (run / "result.json").exists():
            systems[f"pipeline {run.parent.parent.name}/{run.parent.name}"] = picks_from_run(json.loads((run / "result.json").read_text(encoding="utf-8")))
    for replay in (BENCH / "replays").glob(f"*/*/{vod}.json"):
        if "-probe" in replay.parent.parent.name:
            continue
        data = json.loads(replay.read_text(encoding="utf-8"))
        systems[f"model {data['model']}"] = rank_candidates(data["results"])[0]
    return systems


def prepare(vods: list[str], max_per_vod: int) -> None:
    setup(BENCH / "data" / "labels")
    from app.services.frame_extractor import get_vod_direct_url

    queue = []
    for vod in vods:
        systems = system_picks(vod)
        if len(systems) < 2:
            continue
        unique: list[dict] = []
        for name, picks in systems.items():
            for p in picks:
                if p.get("start") is None:
                    continue
                match = next((u for u in unique if _same(u, p)), None)
                if match:
                    match["systems"].add(name)
                else:
                    unique.append({"start": round(p["start"], 1), "end": round(p["end"], 1), "systems": {name}})
        # Clips every system picked don't tell them apart
        disputed = [u for u in unique if len(u["systems"]) < len(systems)]
        random.Random(vod).shuffle(disputed)
        disputed = disputed[:max_per_vod]
        url = get_vod_direct_url(f"https://www.twitch.tv/videos/{vod}", max_height=720)
        (MEDIA / vod).mkdir(parents=True, exist_ok=True)

        def cut(item: dict) -> dict:
            out = MEDIA / vod / f"{item['start']}-{item['end']}.mp4"
            if not out.exists():
                subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(item["start"]), "-i", url, "-t", str(item["end"] - item["start"]), "-c", "copy", str(out)],
                    check=False,
                    timeout=180,
                )
            return {"vod": vod, "start": item["start"], "end": item["end"], "file": f"media/{vod}/{out.name}"}

        with ThreadPoolExecutor(max_workers=4) as pool:
            queue += [q for q in pool.map(cut, disputed) if (LABELS / q["file"]).exists()]
        print(f"{vod}: {len(disputed)} disputed clips of {len(unique)} ({len(systems)} systems)")
    random.Random(42).shuffle(queue)
    LABELS.mkdir(parents=True, exist_ok=True)
    (LABELS / "queue.json").write_text(json.dumps(queue, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(queue)} clips to judge -> uv run python -m bench.labels serve")


PAGE = """<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notation des clips</title>
<style>
:root{--bg:#0e0f12;--card:#17191e;--ink:#f2f2f0;--ink2:#a6a8ad;--good:#42bf85;--meh:#e8b04b;--bad:#e2604f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,sans-serif;display:flex;justify-content:center}
main{width:min(960px,100%);padding:24px 16px}h1{font-size:20px;margin:0 0 4px}p{color:var(--ink2);margin:0 0 16px}
video{width:100%;aspect-ratio:16/9;background:#000;border-radius:14px}
.bar{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}.bar button{flex:1;min-width:150px;height:52px;border-radius:12px;border:1px solid #ffffff22;background:var(--card);color:var(--ink);font-size:15px;font-weight:600;cursor:pointer}
.bar button:hover{background:#ffffff14}.g{box-shadow:inset 0 -3px 0 var(--good)}.m{box-shadow:inset 0 -3px 0 var(--meh)}.x{box-shadow:inset 0 -3px 0 var(--bad)}
kbd{font:12px ui-monospace,monospace;padding:2px 6px;border-radius:5px;background:#ffffff1a;margin-left:6px}
.progress{height:6px;border-radius:3px;background:#ffffff14;margin:14px 0}.progress span{display:block;height:100%;border-radius:3px;background:var(--good)}
</style></head><body><main>
<h1>Est-ce que tu garderais ce clip ?</h1>
<p>Note le moment, pas la coupe : le clip contient de la marge avant et après. Aucun score ni modèle n'est affiché.</p>
<video id="v" controls autoplay></video>
<div class="progress"><span id="p"></span></div><p id="info"></p>
<div class="bar"><button class="g" onclick="rate('good')">Bon clip<kbd>G</kbd></button><button class="m" onclick="rate('meh')">Bof<kbd>B</kbd></button><button class="x" onclick="rate('bad')">Non<kbd>X</kbd></button><button onclick="back()">Précédent<kbd>←</kbd></button></div>
<script>
let queue=[],done={},i=0;
async function load(){queue=await (await fetch('queue.json')).json();done=await (await fetch('/done')).json();i=queue.findIndex(q=>!done[q.vod+'/'+q.start+'-'+q.end]);if(i<0)i=queue.length;show()}
function show(){const n=Object.keys(done).length;document.getElementById('p').style.width=(100*n/Math.max(queue.length,1))+'%';
 if(i>=queue.length){document.getElementById('info').textContent='Terminé : '+n+' clips notés. Merci !';document.getElementById('v').removeAttribute('src');return}
 const q=queue[i];document.getElementById('v').src=q.file;document.getElementById('info').textContent='Clip '+(i+1)+' sur '+queue.length+' — '+n+' notés'}
async function rate(r){if(i>=queue.length)return;const q=queue[i];await fetch('/label',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({vod:q.vod,key:q.start+'-'+q.end,label:r})});done[q.vod+'/'+q.start+'-'+q.end]=r;i++;show()}
function back(){if(i>0){i--;show()}}
addEventListener('keydown',e=>{const k=e.key.toLowerCase();if(k==='g')rate('good');else if(k==='b')rate('meh');else if(k==='x')rate('bad');else if(e.key==='ArrowLeft')back()});
load();
</script></main></body></html>"""


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(LABELS), **kw)

    def log_message(self, *a) -> None:
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = PAGE.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/done":
            done = {}
            for f in LABELS.glob("*.json"):
                if f.name != "queue.json":
                    done.update({f"{f.stem}/{k}": v for k, v in json.loads(f.read_text(encoding="utf-8")).items()})
            body = json.dumps(done).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/label":
            self.send_error(404)
            return
        data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        if data.get("vod") not in VODS or data.get("label") not in ("good", "meh", "bad"):
            self.send_error(400)
            return
        f = LABELS / f"{data['vod']}.json"
        labels = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
        labels[str(data["key"])] = data["label"]
        f.write_text(json.dumps(labels, ensure_ascii=False, indent=1), encoding="utf-8")
        self.send_response(204)
        self.end_headers()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["prepare", "serve"])
    ap.add_argument("--vods", nargs="*", default=list(VODS))
    ap.add_argument("--max-per-vod", type=int, default=25)
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    if args.action == "prepare":
        prepare(args.vods, args.max_per_vod)
    else:
        print(f"http://localhost:{args.port}")
        ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
