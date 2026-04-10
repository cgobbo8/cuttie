#!/bin/bash
# ─────────────────────────────────────────────────────────
# Cuttie — Reinstall dependencies after a git pull
# Called automatically by start.sh when lock files change
# ─────────────────────────────────────────────────────────
set -e

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

echo "  Updating Node dependencies..."
npm install --silent 2>/dev/null
cd api && npm ci --silent 2>/dev/null && cd ..
cd frontend && npm ci --silent 2>/dev/null && cd ..

echo "  Updating Python dependencies..."
cd backend && uv sync 2>&1 | tail -1 && cd ..

echo "  Dependencies updated."
