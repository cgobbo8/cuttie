#!/usr/bin/env node

/**
 * Cross-platform Docker launcher with automatic NVIDIA GPU detection.
 * Works on Windows (PowerShell/CMD), macOS, and Linux.
 *
 * Usage:  node scripts/docker-up.mjs [up|down|logs|reset]
 */

import { execSync } from "node:child_process";

const action = process.argv[2] || "up";

// Detect NVIDIA GPU on the host (nvidia-smi is in PATH on all platforms)
let hasGpu = false;
try {
  execSync("nvidia-smi", { stdio: "ignore", timeout: 5000 });
  hasGpu = true;
} catch {
  // No NVIDIA GPU or drivers not installed
}

const files = hasGpu
  ? "-f docker-compose.yml -f docker-compose.gpu.yml"
  : "-f docker-compose.yml";

const commands = {
  up: `docker compose ${files} --profile app up -d --build`,
  down: `docker compose ${files} --profile app down`,
  logs: `docker compose ${files} --profile app logs -f`,
  reset: `docker compose ${files} --profile app down -v && docker compose ${files} --profile app up -d --build`,
};

const cmd = commands[action];
if (!cmd) {
  console.error(`Unknown action: ${action}. Use: up, down, logs, reset`);
  process.exit(1);
}

if (hasGpu) {
  console.log("NVIDIA GPU detected — starting with GPU passthrough");
} else {
  console.log("No NVIDIA GPU — starting in CPU mode");
}

try {
  execSync(cmd, { stdio: "inherit" });
} catch (err) {
  process.exit(err.status ?? 1);
}
