#!/usr/bin/env node

/**
 * Stages what the installer ships, in desktop/stage (electron-builder's extraResources):
 *   app/  api (compiled, production node_modules, Remotion sources and browser),
 *         frontend/dist, backend (sources + uv.lock: Python and its modules are
 *         installed on first launch, see main.mjs), scripts/launcher.mjs
 *   bin/  node (this very Node: better-sqlite3 is installed for it), uv, ffmpeg + ffprobe
 *
 * Run it on the platform you build for (CI: windows-latest): node_modules are
 * per platform. Windows gets a pinned FFmpeg build; elsewhere (to try the
 * packaged app locally) uv and ffmpeg are copied from the PATH.
 *
 * Usage: node scripts/stage.mjs [--skip-build]   (--skip-build: reuse frontend/dist and api/build)
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(desktop, "..");
const stage = path.join(desktop, "stage");
const cache = path.join(desktop, ".cache");
const isWindows = process.platform === "win32";
const exe = (name) => (isWindows ? `${name}.exe` : name);

// Gyan's "essentials" build (x264, mp3lame, opus...), mirrored on GitHub
const FFMPEG = {
  version: "8.1.2",
  url: "https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-essentials_build.zip",
  sha256: "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec",
};

function run(command, args, cwd) {
  console.log(`\n> ${path.basename(command)} ${args.join(" ")}  (${path.relative(repo, cwd) || "."})`);
  // npm is a .cmd on Windows: only through the shell (no quoting needed for its arguments here)
  const res = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows && command === "npm" });
  if (res.status !== 0) throw new Error(`${path.basename(command)} ${args.join(" ")} failed (${res.status})`);
}

const node = process.execPath;

function onPath(name) {
  const exts = isWindows ? (process.env.PATHEXT ?? ".EXE").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      if (existsSync(file) && statSync(file).isFile()) return file;
    }
  }
  throw new Error(`${name} not found on the PATH`);
}

function copy(from, to, filter = () => true) {
  cpSync(from, to, { recursive: true, dereference: false, filter: (src) => filter(src, path.basename(src)) });
}

function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += sizeOf(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

async function download(url, sha256, file) {
  if (existsSync(file) && createHash("sha256").update(readFileSync(file)).digest("hex") === sha256) return;
  console.log(`\n> download ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(data).digest("hex");
  if (got !== sha256) throw new Error(`${url}: sha256 ${got}, expected ${sha256}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

/* ── Build ────────────────────────────────────────────────────────────────── */

if (!process.argv.includes("--skip-build")) {
  run("npm", ["run", "build"], path.join(repo, "frontend"));
  run(node, ["ace", "build"], path.join(repo, "api"));
}

rmSync(stage, { recursive: true, force: true });
const app = path.join(stage, "app");
const bin = path.join(stage, "bin");
mkdirSync(bin, { recursive: true });

/* ── API: compiled code, production modules (one level up, so the Remotion
      sources resolve them too), Remotion sources and its headless browser ── */

const api = path.join(app, "api");
// api/build/node_modules may be the junction `npm start` makes to api/node_modules
copy(path.join(repo, "api", "build"), path.join(api, "build"), (src, name) => !(name === "node_modules" && path.dirname(src) === path.join(repo, "api", "build")) && !name.startsWith(".env"));
for (const file of ["package.json", "package-lock.json"]) cpSync(path.join(repo, "api", file), path.join(api, file));
copy(path.join(repo, "api", "remotion"), path.join(api, "remotion"));
copy(path.join(repo, "api", "public"), path.join(api, "public"));
run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], api);
// Downloaded now rather than on the first export (lands in node_modules/.remotion)
run(node, ["--input-type=module", "-e", "const { ensureBrowser } = await import('@remotion/renderer'); await ensureBrowser();"], api);

/* ── Frontend, backend sources, launcher ─────────────────────────────────── */

copy(path.join(repo, "frontend", "dist"), path.join(app, "frontend", "dist"));

const backend = path.join(app, "backend");
copy(path.join(repo, "backend", "app"), path.join(backend, "app"), (_src, name) => name !== "__pycache__" && !name.endsWith(".pyc"));
copy(path.join(repo, "backend", "assets"), path.join(backend, "assets"));
for (const file of ["worker.py", "pyproject.toml", "uv.lock", ".python-version", "README.md", "yolov8n-pose.pt"]) {
  cpSync(path.join(repo, "backend", file), path.join(backend, file));
}

cpSync(path.join(repo, "scripts", "launcher.mjs"), path.join(app, "scripts", "launcher.mjs"));

/* ── Tools ────────────────────────────────────────────────────────────────── */

// The files themselves, not the links a package manager may have put on the PATH
const tool = (from, name) => copyFileSync(realpathSync(from), path.join(bin, exe(name)));
tool(node, "node");
tool(onPath("uv"), "uv");

if (isWindows) {
  const zip = path.join(cache, `ffmpeg-${FFMPEG.version}.zip`);
  await download(FFMPEG.url, FFMPEG.sha256, zip);
  const unpacked = path.join(cache, `ffmpeg-${FFMPEG.version}`);
  rmSync(unpacked, { recursive: true, force: true });
  mkdirSync(unpacked, { recursive: true });
  // Windows' own tar reads zip files (not Git's GNU tar, which may come first on the PATH)
  run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", zip, "-C", unpacked], cache);
  const [folder] = readdirSync(unpacked);
  for (const name of ["ffmpeg", "ffprobe"]) tool(path.join(unpacked, folder, "bin", exe(name)), name);

  // The Visual C++ runtime (app-local, as Microsoft allows): PyTorch and numba
  // need it and a fresh Windows doesn't have it. The worker adds this folder
  // to its DLL search (CUTTIE_DLL_DIRS, see main.mjs and backend/worker.py)
  const system32 = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  const msvc = path.join(bin, "msvc");
  mkdirSync(msvc, { recursive: true });
  const required = ["vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll"];
  const optional = ["msvcp140_1.dll", "msvcp140_2.dll", "msvcp140_atomic_wait.dll", "msvcp140_codecvt_ids.dll", "concrt140.dll", "vcomp140.dll"];
  for (const dll of [...required, ...optional]) {
    const from = path.join(system32, dll);
    if (existsSync(from)) copyFileSync(from, path.join(msvc, dll));
    else if (required.includes(dll)) throw new Error(`${dll} not found in ${system32}: install the Visual C++ Redistributable on the build machine`);
  }
} else {
  // Local test of the packaged app only: this machine's ffmpeg
  for (const name of ["ffmpeg", "ffprobe"]) tool(onPath(name), name);
}

/* ── Checks ───────────────────────────────────────────────────────────────── */

const leaks = [];
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(full);
    else if (/^\.env($|\.)/.test(entry.name) && entry.name !== ".env.example") leaks.push(full);
  }
};
scan(stage);
if (leaks.length) throw new Error(`Secrets must not ship: ${leaks.join(", ")}`);

const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
console.log(`\nStaged in ${path.relative(repo, stage)}:`);
for (const part of ["app/api/node_modules", "app/api/build", "app/frontend", "app/backend", "bin"]) {
  console.log(`  ${part.padEnd(22)} ${mb(sizeOf(path.join(stage, part)))}`);
}
console.log(`  ${"total".padEnd(22)} ${mb(sizeOf(stage))}`);
