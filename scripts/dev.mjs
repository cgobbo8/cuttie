#!/usr/bin/env node

/**
 * Dev launcher — API (HMR) + Python worker (auto-restart) + Vite, no Docker.
 *
 * All three share one data directory (default: <repo>/.data) and a random
 * secret for API <-> worker calls, generated for each run.
 *
 * Usage:  npm run dev            (from the repo root)
 * Env:    CUTTIE_DATA_DIR        override the data directory
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import concurrently from "concurrently";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_PORT = 3333;
const WORKER_PORT = 3334;

const shared = {
  CUTTIE_DATA_DIR: process.env.CUTTIE_DATA_DIR || path.join(root, ".data"),
  CUTTIE_INTERNAL_SECRET: randomBytes(24).toString("hex"),
};

console.log(`\n  Cuttie dev — data dir: ${shared.CUTTIE_DATA_DIR}\n  App: http://localhost:5173\n`);

const { result } = concurrently(
  [
    {
      name: "api",
      command: "node ace serve --hmr",
      cwd: path.join(root, "api"),
      prefixColor: "blue",
      // HOST pinned to IPv4: with "localhost", Node may bind ::1 only after a restart,
      // and the worker / Vite proxy / signed URLs all target 127.0.0.1
      env: { ...shared, HOST: "127.0.0.1", PORT: String(API_PORT), WORKER_URL: `http://127.0.0.1:${WORKER_PORT}` },
    },
    {
      name: "worker",
      command: "uv run watchmedo auto-restart --directory=./app --pattern=*.py --recursive -- python worker.py",
      cwd: path.join(root, "backend"),
      prefixColor: "yellow",
      env: {
        ...shared,
        CUTTIE_API_URL: `http://127.0.0.1:${API_PORT}`,
        CUTTIE_WORKER_PORT: String(WORKER_PORT),
        PYTHONUTF8: "1",
      },
    },
    {
      name: "front",
      command: "npm run dev",
      cwd: path.join(root, "frontend"),
      prefixColor: "green",
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
  { killOthersOn: ["failure"] }
);

result.catch(() => process.exit(1));
