# Cuttie

Automatic highlight extraction from Twitch VODs. Paste a URL, get vertical clips (9:16) with facecam, subtitles, and a built-in editor.

## Features

- **Automatic analysis** — Audio energy, chat sentiment, emote bursts, and LLM scoring to find the best moments
- **Smart clipping** — Dynamic boundaries based on audio activity (RMS), not fixed durations
- **Vertical exports** — 1080x1920 editor templates with facecam detection, game crop, and blurred background
- **Karaoke subtitles** — Word-level Whisper timestamps with per-speaker colors
- **Clip editor** — Canvas-based editor with layers (text, shapes, assets, chat overlay) and Remotion export
- **Multi-language UI** — French, English, Spanish (i18next)

## Architecture

Cuttie runs entirely on the user's machine (no Docker, no Redis, no S3):

```
 Browser / desktop window
          │  http://127.0.0.1:3333
┌─────────▼──────────┐   HTTP (shared secret)   ┌──────────────────────┐
│  API — AdonisJS 7  │ ───────── jobs ────────▶ │  Worker — Python      │
│  serves the SPA,   │ ◀──── status events ──── │  FastAPI on 127.0.0.1 │
│  SSE, Remotion     │                          │  analysis pipeline    │
└─────────┬──────────┘                          └──────────┬───────────┘
          └──────────────┬─────────────────────────────────┘
                 CUTTIE_DATA_DIR (shared folder)
        api.sqlite3 · worker.sqlite3 · settings.json · storage/{clips,renders,assets}
```

| Layer | Stack | Role |
|-------|-------|------|
| **Frontend** | React 19, TypeScript, Tailwind 4, Remotion 4 | SPA, clip editor, settings/diagnostics, real-time status via SSE |
| **API** | AdonisJS 7, SQLite | Local auto-login, jobs, signed file URLs, SSE relay, Remotion rendering |
| **Worker** | Python 3.12, FastAPI, librosa, PANNs, pyannote | VOD download, audio/chat analysis, scoring, LLM analysis, clipping |

API keys (Groq, OpenRouter) are entered in the app's Settings page and stored in `<data dir>/settings.json`.

## Prerequisites

- **Node.js** >= 22
- **[uv](https://docs.astral.sh/uv/)** (installs Python 3.12 and the worker dependencies)
- **FFmpeg** on the `PATH`

## Quick Start

```bash
npm install                        # root launcher deps
(cd api && npm install)
(cd frontend && npm install)
(cd backend && uv sync)
cp api/.env.example api/.env       # then set APP_KEY: cd api && node ace generate:key

npm run dev     # API (HMR) + worker (auto-reload) + Vite → http://localhost:5173
npm start       # production-like: compiled API serving the built SPA + worker
```

Both launchers share `<repo>/.data` by default (override with `CUTTIE_DATA_DIR`). There is no login screen: requests from the app on this machine are signed in as the local user.

## Project Structure

```
cuttie/
├── api/                    # AdonisJS API (jobs, renders, storage, SSE, settings)
│   ├── app/controllers/    # Route handlers
│   ├── app/services/       # storage (signed URLs), worker client, job status bus, Remotion renderer
│   ├── database/migrations/
│   ├── remotion/           # Server-side Remotion compositions
│   └── start/routes.ts
│
├── backend/                # Python worker (VOD analysis pipeline)
│   ├── app/main.py         # Local HTTP server: job queue, editor helpers, diagnostics
│   ├── app/services/       # Pipeline steps
│   └── pyproject.toml
│
├── frontend/               # React SPA
│   ├── src/pages/          # Route pages (Home, Job, Edit, Exports, Settings)
│   ├── src/components/     # UI components + editor layers
│   └── src/lib/            # API client, contexts, i18n, editor state
│
├── scripts/                # dev.mjs, start.mjs, launcher.mjs
└── CLAUDE.md               # AI assistant context
```

## Analysis Pipeline

1. **Download** — VOD metadata, audio-only stream (yt-dlp) and chat replay (Twitch GQL), in parallel
2. **Analyze audio** — librosa features (RMS, flux, onset, pitch, centroid, ZCR) + PANNs audio events
3. **Analyze chat** — message speed, bursts, emotes, caps, mood
4. **Score** — weighted composite + peak detection → top 200 candidates
5. **Analyze candidates** — Whisper transcription, VOD context, blended re-rank, frames + speaker diarization, one multimodal LLM call per candidate → top 20
6. **Clip** — FFmpeg stream copy of the selected moments into storage

## Environment Variables

See `api/.env.example` and `backend/.env.example`. The launchers set the runtime ones
(`CUTTIE_DATA_DIR`, `CUTTIE_INTERNAL_SECRET`, ports); in dev, the worker also falls back to
`GROQ_API_KEY` / `OPENROUTER_API_KEY` from `backend/.env`.

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
- **Backend**: Python 3.12 type hints, FastAPI, Pydantic v2
- **API**: AdonisJS conventions (controllers, models, validators, services)
- **Commits**: Conventional commits (`feat:`, `fix:`, `chore:`, etc.)

## License

Proprietary. All rights reserved.
