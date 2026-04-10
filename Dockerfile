# ─────────────────────────────────────────────────────────────────
# Cuttie — Multi-runtime dev image (Python 3.12 + Node 22)
# Used by: api & worker services in docker-compose.yml
# ─────────────────────────────────────────────────────────────────

FROM node:22-slim    AS node-src
FROM ghcr.io/astral-sh/uv:latest AS uv-src

FROM python:3.12-slim

# ── Copy Node.js from official image ─────────────────────────────
COPY --from=node-src /usr/local/bin/node /usr/local/bin/
COPY --from=node-src /usr/local/include/node /usr/local/include/node
COPY --from=node-src /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# ── Copy uv (Python package manager) ────────────────────────────
COPY --from=uv-src /uv /uvx /usr/local/bin/

# ── System dependencies ──────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    git \
    build-essential \
    chromium \
    fonts-liberation \
    fonts-freefont-ttf \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# ── Environment ──────────────────────────────────────────────────
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1

WORKDIR /workspace

# ── Python dependencies (cached layer) ──────────────────────────
COPY backend/pyproject.toml backend/uv.lock backend/
RUN cd backend && uv sync --frozen --no-dev

# ── Node dependencies for API (cached layer) ────────────────────
COPY api/package.json api/package-lock.json api/
RUN cd api && npm ci
