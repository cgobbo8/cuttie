/**
 * Starts the packaged-style Cuttie stack: the compiled API (which also serves
 * the built frontend) + the Python worker, sharing one data directory.
 *
 * Used by `npm start` (scripts/start.mjs) and meant to be reused by the
 * desktop shell. Everything listens on 127.0.0.1 only.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

/** A free TCP port on 127.0.0.1, preferring `preferred` when available. */
export async function freePort(preferred) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(null));
      server.listen(port, "127.0.0.1", () => {
        const { port: bound } = server.address();
        server.close(() => resolve(bound));
      });
    });
  return (preferred && (await tryPort(preferred))) || (await tryPort(0));
}

/** Per-install secret used to sign sessions and storage URLs (kept across restarts). */
function loadAppKey(dataDir) {
  const keyPath = path.join(dataDir, "app.key");
  if (existsSync(keyPath)) return readFileSync(keyPath, "utf-8").trim();
  const key = randomBytes(32).toString("base64url");
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

async function waitForHealth(url, { timeoutMs, isAlive }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive()) return false;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * @param {object} opts
 * @param {string} opts.root        repo (or app resources) root containing api/, backend/, frontend/dist
 * @param {string} opts.dataDir     data directory (DB, clips, settings)
 * @param {string} [opts.nodeBin]   node executable for the API (default: current node)
 * @param {string[]} [opts.workerCommand]  command that runs the worker (default: uv run python worker.py)
 * @param {(name: string, line: string) => void} [opts.onLog]
 * @returns {Promise<{ url: string, stop: () => Promise<void>, exited: Promise<string> }>}
 */
export async function startCuttie({
  root,
  dataDir,
  nodeBin = process.execPath,
  workerCommand = ["uv", "run", "--no-sync", "python", "worker.py"],
  env: extraEnv = {},
  onLog = (name, line) => console.log(`[${name}] ${line}`),
}) {
  mkdirSync(dataDir, { recursive: true });

  const apiPort = await freePort(3333);
  const workerPort = await freePort(3334);
  const secret = randomBytes(24).toString("hex");
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  const shared = {
    ...process.env,
    ...extraEnv,
    CUTTIE_DATA_DIR: dataDir,
    CUTTIE_INTERNAL_SECRET: secret,
  };

  const children = [];
  let exitedResolve;
  const exited = new Promise((resolve) => (exitedResolve = resolve));

  const launch = (name, command, args, options) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const forward = (chunk) =>
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLog(name, line));
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("exit", (code) => {
      child.exited = true;
      exitedResolve(`${name} exited (code ${code})`);
    });
    children.push(child);
    return child;
  };

  launch("worker", workerCommand[0], workerCommand.slice(1), {
    cwd: path.join(root, "backend"),
    env: {
      ...shared,
      CUTTIE_API_URL: apiUrl,
      CUTTIE_WORKER_PORT: String(workerPort),
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
    },
  });

  const api = launch("api", nodeBin, [path.join(root, "api", "build", "bin", "server.js")], {
    // cwd = api/ so the Remotion renderer finds ./remotion and ./public
    cwd: path.join(root, "api"),
    env: {
      ...shared,
      // Electron's binary behaves like plain node with this flag
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      TZ: "UTC",
      HOST: "127.0.0.1",
      PORT: String(apiPort),
      APP_KEY: loadAppKey(dataDir),
      APP_URL: apiUrl,
      LOG_LEVEL: "info",
      SESSION_DRIVER: "cookie",
      WORKER_URL: `http://127.0.0.1:${workerPort}`,
      FRONTEND_DIST: path.join(root, "frontend", "dist"),
    },
  });

  // Graceful stop, then force after a few seconds. On Windows, kill the whole
  // process tree (killing a parent there leaves its children running).
  const kill = (child, signal) => {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else {
      child.kill(signal);
    }
  };
  const stop = async () => {
    await Promise.all(
      children
        .filter((child) => !child.exited)
        .map(
          (child) =>
            new Promise((resolve) => {
              const timer = setTimeout(() => {
                kill(child, "SIGKILL");
                resolve();
              }, 5000);
              child.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
              kill(child, "SIGTERM");
            })
        )
    );
  };

  const ready = await waitForHealth(`${apiUrl}/api/app/info`, {
    timeoutMs: 120_000,
    isAlive: () => !api.exited,
  });
  if (!ready) {
    await stop();
    throw new Error("The API did not start");
  }

  return { url: apiUrl, stop, exited };
}
