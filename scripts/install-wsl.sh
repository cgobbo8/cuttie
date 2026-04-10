#!/bin/bash
# ─────────────────────────────────────────────────────────
# Cuttie — WSL2 Installation (run once)
#
# Prerequisites: WSL2 + Ubuntu installed on Windows
#   (Admin PowerShell: wsl --install -d Ubuntu-24.04)
#
# Usage:
#   git clone <repo> ~/cuttie
#   cd ~/cuttie && bash scripts/install-wsl.sh
# ─────────────────────────────────────────────────────────
set -e

CUTTIE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$HOME/cuttie-data"
BIN_DIR="$HOME/.local/bin"

echo ""
echo "  Cuttie — Installation"
echo "  ---------------------"
echo ""

# ── 1. System packages ──────────────────────────────────
echo "[1/7] Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg git curl redis-tools redis-server wslu > /dev/null 2>&1

# Don't auto-start Redis — we manage it in start.sh
if command -v systemctl &>/dev/null; then
    sudo systemctl stop redis-server 2>/dev/null || true
    sudo systemctl disable redis-server 2>/dev/null || true
fi
echo "      Done."

# ── 2. Node.js 22 ───────────────────────────────────────
if command -v node &>/dev/null && [ "$(node -v | cut -d. -f1 | tr -d v)" -ge 22 ]; then
    echo "[2/7] Node.js $(node -v) already installed."
else
    echo "[2/7] Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - > /dev/null 2>&1
    sudo apt-get install -y -qq nodejs > /dev/null 2>&1
    echo "      Installed Node.js $(node -v)."
fi

# ── 3. uv (Python package manager) ─────────────────────
if command -v uv &>/dev/null; then
    echo "[3/7] uv already installed."
else
    echo "[3/7] Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh > /dev/null 2>&1
    export PATH="$BIN_DIR:$PATH"
    echo "      Done."
fi

# ── 4. Minio + mc ──────────────────────────────────────
mkdir -p "$BIN_DIR" "$DATA_DIR"

if [ -f "$BIN_DIR/minio" ]; then
    echo "[4/7] Minio already installed."
else
    echo "[4/7] Downloading Minio server + client..."
    curl -sSLo "$BIN_DIR/minio" https://dl.min.io/server/minio/release/linux-amd64/minio
    chmod +x "$BIN_DIR/minio"
    curl -sSLo "$BIN_DIR/mc" https://dl.min.io/client/mc/release/linux-amd64/mc
    chmod +x "$BIN_DIR/mc"
    echo "      Done."
fi

# ── 5. Node dependencies ───────────────────────────────
echo "[5/7] Installing Node.js dependencies..."
cd "$CUTTIE_DIR"        && npm install --silent 2>/dev/null
cd "$CUTTIE_DIR/api"    && npm ci --silent 2>/dev/null
cd "$CUTTIE_DIR/frontend" && npm ci --silent 2>/dev/null
echo "      Done."

# ── 6. Python dependencies ─────────────────────────────
echo "[6/7] Installing Python dependencies (first run can take a few minutes)..."
cd "$CUTTIE_DIR/backend" && uv sync 2>&1 | tail -1
echo "      Done."

# ── 7. Configuration ───────────────────────────────────
echo "[7/7] Setting up configuration..."
cd "$CUTTIE_DIR"

if [ ! -f api/.env ]; then
    cp api/.env.example api/.env
    APP_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
    sed -i "s|^APP_KEY=.*|APP_KEY=$APP_KEY|" api/.env
    echo "      Created api/.env (APP_KEY auto-generated)"
else
    echo "      api/.env already exists, skipping."
fi

if [ ! -f backend/.env ]; then
    cp backend/.env.example backend/.env
    echo "      Created backend/.env"
else
    echo "      backend/.env already exists, skipping."
fi

# DB migrations
cd "$CUTTIE_DIR/api" && node ace migration:run --force > /dev/null 2>&1
echo "      Database ready."

# ── Create Windows desktop shortcut ────────────────────
WIN_DESKTOP="$(wslpath "$(wslvar USERPROFILE)")/Desktop"
if [ -d "$WIN_DESKTOP" ]; then
    cat > "$WIN_DESKTOP/Cuttie.bat" << ENDOFBAT
@echo off
title Cuttie
wsl -e bash -lc "cd '$CUTTIE_DIR' && bash scripts/start.sh"
pause
ENDOFBAT
    echo "      Desktop shortcut created."
fi

# ── Summary ─────────────────────────────────────────────
echo ""

if command -v nvidia-smi &>/dev/null; then
    GPU_NAME=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null)
    echo "  GPU: $GPU_NAME"
else
    echo "  GPU: not detected (will use CPU — slower)"
fi

echo ""
echo "  ---------------------"
echo "  Installation complete!"
echo ""
echo "  NEXT STEP: add your API keys in"
echo "    $CUTTIE_DIR/backend/.env"
echo ""
echo "  Then double-click 'Cuttie' on the Desktop!"
echo "  ---------------------"
echo ""
