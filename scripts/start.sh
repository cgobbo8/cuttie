#!/bin/bash
# ─────────────────────────────────────────────────────────
# Cuttie — Launcher (called by Cuttie.bat on Windows)
#
# What it does:
#   1. git pull (auto-update)
#   2. Reinstall deps if lock files changed
#   3. Start Redis + Minio + API + Worker + Frontend
#   4. Open the browser
#   5. Clean shutdown on Ctrl+C / window close
# ─────────────────────────────────────────────────────────
set -e

cd "$(dirname "$0")/.."
ROOT=$(pwd)

export PATH="$HOME/.local/bin:$PATH"

echo ""
echo "  Cuttie"
echo "  ------"
echo ""

# ── Auto-update ─────────────────────────────────────────
BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
git pull --ff-only 2>/dev/null || true
AFTER=$(git rev-parse HEAD 2>/dev/null || echo "")

if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ]; then
    echo "  Updated: $(git log -1 --format='%s')"

    if git diff "$BEFORE" "$AFTER" --name-only | grep -qE "package-lock\.json|uv\.lock"; then
        echo "  Dependencies changed, reinstalling..."
        bash scripts/update.sh
    fi

    # Always run migrations after update (idempotent)
    cd "$ROOT/api" && node ace migration:run --force > /dev/null 2>&1 || true
    cd "$ROOT"
fi

# ── Start Redis ─────────────────────────────────────────
if redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "  Redis:    already running"
else
    redis-server --port 6379 --save "" --appendonly no --daemonize yes --loglevel warning
    echo "  Redis:    started"
fi

# ── Start Minio ─────────────────────────────────────────
if curl -sf http://localhost:9000/minio/health/ready > /dev/null 2>&1; then
    echo "  Minio:    already running"
else
    export MINIO_ROOT_USER=cuttie
    export MINIO_ROOT_PASSWORD=cuttieminio
    nohup "$HOME/.local/bin/minio" server "$HOME/cuttie-data" \
        --address :9000 --console-address :9001 > /dev/null 2>&1 &

    for _ in $(seq 1 15); do
        curl -sf http://localhost:9000/minio/health/ready > /dev/null 2>&1 && break
        sleep 1
    done
    echo "  Minio:    started"
fi

# Create bucket (idempotent, silent)
"$HOME/.local/bin/mc" alias set cuttie http://localhost:9000 cuttie cuttieminio > /dev/null 2>&1 || true
"$HOME/.local/bin/mc" mb --ignore-existing cuttie/cuttie > /dev/null 2>&1 || true
"$HOME/.local/bin/mc" anonymous set download cuttie/cuttie > /dev/null 2>&1 || true

# ── GPU info ────────────────────────────────────────────
if command -v nvidia-smi &>/dev/null; then
    GPU=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    echo "  GPU:      $GPU"
else
    echo "  GPU:      CPU mode"
fi

echo ""
echo "  http://localhost:5173"
echo ""

# ── Open browser (Windows) ─────────────────────────────
(sleep 5 && cmd.exe /c start http://localhost:5173 2>/dev/null) &

# ── Cleanup on exit ─────────────────────────────────────
cleanup() {
    echo ""
    echo "  Shutting down..."
    redis-cli shutdown nosave 2>/dev/null || true
    pkill -f "minio server.*cuttie-data" 2>/dev/null || true
    echo "  Bye!"
}
trap cleanup EXIT INT TERM

# ── Start app services ──────────────────────────────────
npx concurrently --kill-others-on-fail \
    -n api,worker,front \
    -c blue,yellow,green \
    "cd api && node ace serve --hmr" \
    "cd backend && uv run python worker.py" \
    "cd frontend && npm run dev"
