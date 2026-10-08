#!/usr/bin/env node

/**
 * Production-like local run, as the friend's desktop app will do it:
 * compiled API serving the built frontend + the Python worker, one URL.
 *
 * Usage:  npm start              (builds frontend/API the first time)
 *         npm start -- --build   (force a rebuild)
 *         npm start -- --no-open (don't open the browser)
 * Env:    CUTTIE_DATA_DIR        data directory (default: <repo>/.data)
 */

import { spawnSync, spawn } from "node:child_process";
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startCuttie } from "./launcher.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--build");
const isWindows = process.platform === "win32";

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}  (${path.relative(root, cwd) || "."})`);
  const res = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

if (force || !existsSync(path.join(root, "frontend", "dist", "index.html"))) {
  run("npm", ["run", "build"], path.join(root, "frontend"));
}
if (force || !existsSync(path.join(root, "api", "build", "bin", "server.js"))) {
  run("node", ["ace", "build"], path.join(root, "api"));
}

// The compiled API reuses api/node_modules instead of a separate production install
const buildModules = path.join(root, "api", "build", "node_modules");
if (!existsSync(buildModules) && !lstatSync(buildModules, { throwIfNoEntry: false })) {
  symlinkSync(path.join(root, "api", "node_modules"), buildModules, "junction");
}

const dataDir = process.env.CUTTIE_DATA_DIR || path.join(root, ".data");
console.log(`\n  Starting Cuttie — data dir: ${dataDir}`);

const app = await startCuttie({ root, dataDir });
console.log(`\n  Cuttie is running: ${app.url}\n  (Ctrl+C to quit)\n`);

if (!process.argv.includes("--no-open")) {
  const opener = isWindows ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const openerArgs = isWindows ? ["/c", "start", "", app.url] : [app.url];
  spawn(opener, openerArgs, { stdio: "ignore", detached: true }).unref();
}

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.error(`\n  ${await app.exited} — shutting down`);
await app.stop();
process.exit(1);
