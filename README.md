# Cuttie

Automatic highlight extraction from Twitch VODs. Paste a URL, get vertical clips (9:16) with facecam, subtitles, and a built-in editor.

## Features

- **Automatic analysis** — Audio energy, chat sentiment, emote bursts, and LLM scoring to find the best moments
- **Smart clipping** — Dynamic boundaries based on audio activity (RMS), not fixed durations
- **Vertical reframing** — 1080x1920 output with facecam detection, game crop, and blurred background
- **Karaoke subtitles** — Word-level Whisper timestamps + LLM correction, ASS karaoke with dominant color theming
- **Clip editor** — Canvas-based editor with layers (text, shapes, assets, chat overlay) and Remotion export
- **Multi-language UI** — French, English, Spanish (i18next)

## Architecture

```
┌────────────┐     ┌─────────────┐     ┌──────────────┐
│  Frontend   │────▶│  API         │────▶│  Worker       │
│  React 19   │     │  AdonisJS 7  │     │  Python/FastAPI│
│  Vite 8     │     │  Port 3333   │     │  Port 8000    │
└────────────┘     └──────┬──────┘     └───────┬──────┘
                          │                     │
                    ┌─────▼─────┐         ┌────▼────┐
                    │  SQLite    │         │  S3/Minio│
                    │  Redis     │         │  FFmpeg  │
                    └───────────┘         └─────────┘
```

| Layer | Stack | Role |
|-------|-------|------|
| **Frontend** | React 19, TypeScript, Tailwind 4, Remotion 4 | SPA, clip editor, real-time status via SSE |
| **API** | AdonisJS 7, SQLite, Redis | Auth (session + Google OAuth), job queue, SSE relay, Remotion rendering |
| **Worker** | Python 3.10+, FastAPI, librosa, PANNs, MediaPipe | VOD download, audio/chat analysis, scoring, clipping, subtitle generation, LLM analysis |
| **Infra** | Docker Compose (Redis + Minio) | Job queue (Redis lists), file storage (S3-compatible) |

## Prerequisites

- **Node.js** >= 20
- **Python** >= 3.10 + [uv](https://docs.astral.sh/uv/)
- **FFmpeg** (with libx264, libass)
- **Docker** (for Redis + Minio)
- **OpenAI API key** (Whisper + GPT)

## Quick Start

### 1. Infrastructure

```bash
docker compose up -d
```

This starts Redis (port 6379) and Minio (port 9000, console on 9001) with automatic bucket creation.

### 2. API (AdonisJS)

```bash
cd api
cp .env.example .env
# Edit .env: set APP_KEY (node ace generate:key), Google OAuth credentials
npm install
node ace migration:run
node ace db:seed    # creates admin@cuttie.com / admin
node ace serve --watch
```

### 3. Worker (Python)

```bash
cd backend
cp .env.example .env
# Edit .env: set OPENAI_API_KEY
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and log in with `admin@cuttie.com` / `admin`.

## Project Structure

```
cuttie/
├── api/                    # AdonisJS API (auth, jobs, renders, SSE)
│   ├── app/controllers/    # Route handlers
│   ├── app/models/         # Lucid ORM models (User, Job)
│   ├── app/services/       # S3, Redis SSE bus, Remotion renderer
│   ├── app/validators/     # VineJS request validation
│   ├── database/migrations/
│   ├── remotion/           # Server-side Remotion compositions
│   └── start/routes.ts
│
├── backend/                # Python worker (VOD analysis pipeline)
│   ├── app/main.py         # FastAPI app
│   ├── app/routers/        # HTTP endpoints (clips, assets)
│   ├── app/services/       # Pipeline steps (14 modules)
│   └── pyproject.toml
│
├── frontend/               # React SPA
│   ├── src/pages/          # Route pages (Home, Job, Edit, Exports, Profile)
│   ├── src/components/     # UI components + editor layers
│   ├── src/lib/            # API client, auth context, i18n, editor state
│   └── src/app.css         # Tailwind design tokens + animations
│
├── docker-compose.yml      # Redis + Minio
└── CLAUDE.md               # AI assistant context
```

## Analysis Pipeline

The worker processes VODs through 10 steps with resumable checkpoints:

1. **Download Audio** — yt-dlp extracts 11025Hz mono WAV
2. **Download Chat** — Twitch GQL API fetches all chat messages
3. **Analyze Audio** — librosa extracts RMS, spectral flux, pitch variance, onset, ZCR per 5s window
4. **Analyze Chat** — Message speed, emote density, caps ratio, burst detection, mood tagging
5. **Score** — Weighted composite score (10 signals) + peak detection → top 50 candidates
6. **Triage** — Whisper transcription + LLM light scoring → top 20
7. **Clip** — yt-dlp video download + FFmpeg extraction with dynamic RMS-based boundaries
8. **Vertical** — Parallel: subtitle generation (Whisper + LLM) then FFmpeg 9:16 render
9. **LLM Analysis** — Frame extraction + GPT-4.5 vision + narrative synthesis
10. **Done**

## Environment Variables

See `api/.env.example` and `backend/.env.example` for all required variables.

Key variables:
- `OPENAI_API_KEY` — Required for Whisper transcription and GPT analysis
- `APP_KEY` — AdonisJS encryption key (`node ace generate:key`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — For Google OAuth (optional)
- `S3_*` — Minio/S3 connection (defaults work with docker-compose)

## Testing

```bash
# Frontend unit tests
cd frontend && npx vitest

# Backend tests
cd backend && uv run pytest

# API functional tests
cd api && node ace test

# Type checking
cd frontend && npm run check
cd api && npm run typecheck
```

## Contributing

- **Code language**: English (variables, functions, comments)
- **UI language**: French (default), English, Spanish
- **Frontend**: React 19 functional components, TypeScript strict mode, Tailwind utility classes
- **Backend**: Python 3.10+ type hints, FastAPI, Pydantic v2
- **API**: AdonisJS conventions (controllers, models, validators, services)
- **Commits**: Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## License

Proprietary. All rights reserved.
