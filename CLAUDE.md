# Cuttie

Outil d'extraction automatique des moments forts de VODs Twitch. URL in -> clips horizontaux analyses et scores out. Editeur de clips integre avec export Remotion.

## Stack

- **API** : AdonisJS 7 (TypeScript), SQLite (better-sqlite3), Redis (SSE + sessions)
- **Worker** : Python 3.10+, FastAPI, SQLite (WAL), uv
- **Frontend** : React 19, TypeScript 5.9, Tailwind CSS 4, Vite 8, React Router 7
- **Editor** : Remotion 4 (player + renderer), canvas editor custom
- **ML/Audio** : librosa (11025 Hz), PANNs CNN14 (AudioSet)
- **LLM** : Groq — Whisper large-v3-turbo (transcription), Gemini Flash (vision, analyse, correction sous-titres)
- **Video** : FFmpeg, OpenCV, yt-dlp
- **Storage** : S3/Minio (clips, assets, renders)
- **Tests** : Vitest (frontend + backend unit/functional)

## Commandes

```bash
# API (AdonisJS)
cd api && node ace serve --watch    # dev (port 3333)
cd api && node ace build            # production

# Worker (Python)
cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm run dev          # dev (port 5173)
cd frontend && npm run build        # production

# Tests
cd frontend && npx vitest           # frontend tests
cd backend && uv run pytest         # backend tests
cd api && node ace test             # API tests

# Infrastructure
docker compose up -d                # Redis + Minio
```

## Variables d'environnement

Fichier `backend/.env` :
```
OPENAI_API_KEY=sk-proj-...
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=cuttie
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
CORS_ORIGINS=http://localhost:5173
TWITCH_CLIENT_ID=...
```

Fichier `api/.env` : voir `api/.env.example`

## Architecture

```
cuttie/
├── api/                               # AdonisJS — API principale, auth, SSE
│   ├── app/
│   │   ├── controllers/
│   │   │   ├── access_token_controller.ts    # Login/logout
│   │   │   ├── auth_me_controller.ts         # GET /auth/me
│   │   │   ├── google_auth_controller.ts     # OAuth Google
│   │   │   ├── jobs_controller.ts            # CRUD jobs + SSE
│   │   │   ├── clips_controller.ts           # Download clips + edit-env
│   │   │   ├── renders_controller.ts         # Remotion renders
│   │   │   ├── assets_controller.ts          # Upload/serve assets
│   │   │   └── profile_controller.ts         # Profil utilisateur
│   │   ├── models/
│   │   │   ├── user.ts                       # User + auth + access tokens
│   │   │   └── job.ts                        # Job + JSON columns
│   │   ├── middleware/                        # Auth, SSE auth, silent auth, JSON
│   │   ├── services/
│   │   │   ├── s3.ts                         # S3/Minio client
│   │   │   ├── job_status_bus.ts             # Redis pub/sub pour SSE
│   │   │   └── remotion_renderer.ts          # Bundle + render Remotion
│   │   ├── validators/user.ts                # VineJS validation
│   │   └── transformers/user_transformer.ts
│   ├── database/migrations/                   # 10 migrations SQLite
│   ├── remotion/                              # Compositions Remotion (server-side)
│   ├── config/                                # AdonisJS config (auth, cors, shield, etc.)
│   └── start/routes.ts                        # Routes centralisees
│
├── backend/                           # Python Worker — analyse VOD + generation clips
│   ├── app/
│   │   ├── main.py                            # FastAPI app + CORS
│   │   ├── routers/analyze.py                 # Endpoints clips, renders, assets
│   │   ├── models/schemas.py                  # Pydantic v2
│   │   └── services/
│   │       ├── pipeline.py                    # Orchestrateur (8 etapes)
│   │       ├── downloader.py                  # yt-dlp : audio WAV + chat Twitch GQL
│   │       ├── audio_analyzer.py              # librosa : RMS, flux, pitch, centroid, ZCR, onset
│   │       ├── audio_classifier.py            # PANNs CNN14 : events audio
│   │       ├── chat_analyzer.py               # Sentiment chat : vitesse, burst, emotes, mood
│   │       ├── scorer.py                      # Score composite + peak detection (scipy)
│   │       ├── triage.py                      # Whisper + LLM light scoring : 50 -> 20
│   │       ├── clipper.py                     # Extraction clips video
│   │       ├── frame_extractor.py             # Extraction frames pour vision
│   │       ├── vision_analyzer.py             # GPT-4.5 vision
│   │       ├── llm_analyzer.py                # Synthese narrative + scoring
│   │       ├── s3_storage.py                  # Upload S3/Minio
│   │       └── db.py                          # SQLite persistence (WAL)
│   ├── assets/fonts/LuckiestGuy-Regular.ttf
│   └── pyproject.toml
│
└── frontend/                          # React SPA
    └── src/
        ├── App.tsx                            # Router principal
        ├── main.tsx                           # Entry point + providers
        ├── app.css                            # Tailwind @theme + animations custom
        ├── pages/
        │   ├── HomePage.tsx                   # Liste des projets
        │   ├── LoginPage.tsx                  # Auth
        │   ├── JobPage.tsx                    # Detail job + hot points
        │   ├── EditPage.tsx                   # Editeur canvas
        │   ├── RemotionEditPage.tsx           # Editeur Remotion
        │   ├── ExportsPage.tsx                # Liste renders/exports
        │   └── ProfilePage.tsx                # Profil + langue
        ├── components/
        │   ├── Layout.tsx                     # Shell : sidebar + main
        │   ├── Sidebar.tsx                    # Navigation
        │   ├── HotPoints.tsx                  # Grille clips analysés
        │   ├── JobStatus.tsx                  # Progression job
        │   ├── NewProjectModal.tsx            # Modal creation projet
        │   ├── ClipEditor.tsx                 # Editeur clip inline
        │   ├── Toast.tsx                      # Systeme de notifications
        │   ├── ConfirmModal.tsx               # Dialog confirmation
        │   ├── ui/Tooltip.tsx                 # Radix tooltip wrapper
        │   ├── editor/                        # Canvas editor (layers, panels, viewport)
        │   └── remotion-editor/               # Remotion composition + layers
        └── lib/
            ├── api.ts                         # Client REST type-safe + SSE
            ├── AuthContext.tsx                 # Auth context + session
            ├── editorTypes.ts                 # Types editeur (layers, state)
            ├── editorThemes.ts                # Themes pre-definis
            ├── animations.ts                  # Animations Remotion
            └── i18n/index.ts                  # i18next (fr/en/es)
```

## Pipeline (7 etapes)

```
1. DOWNLOADING_AUDIO   -> yt-dlp : audio 11025Hz mono WAV
2. DOWNLOADING_CHAT    -> Twitch GQL : messages chat
3. ANALYZING_AUDIO     -> librosa : features par fenetres de 5s (hop 2.5s)
4. ANALYZING_CHAT      -> Sentiment, emotes, burst detection
5. SCORING             -> Score composite pondere + peak detection -> top 50
6. ANALYZING_CLIPS     -> Pour chaque candidat (sans download video) :
                          - Whisper transcription (segment audio depuis WAV)
                          - 6 frames extraites par ffmpeg seek sur URL VOD
                          - 1 appel LLM unifie (frames + transcript + chat)
                          -> Re-rank par final_score, garde top 20
7. CLIPPING            -> yt-dlp video + FFmpeg extraction (bornes dynamiques RMS)
                          uniquement pour les 20 candidats gardes
8. DONE
```

Checkpoints resumables : CLIPPING, LLM_ANALYSIS.

## Scoring

**Score heuristique** (normalisation baseline-relative, median/P95) :
- RMS 18%, chat_speed 18%, spectral_flux 12%, onset 10%, pitch_var 10%
- chat_burst 10%, emote_density 8%, caps_ratio 7%, centroid 5%, zcr 2%

**Score final** : `0.4 * heuristique + 0.6 * LLM virality`

## Authentification

- Auth token-based via AdonisJS (`@adonisjs/auth` access tokens)
- Google OAuth via `@adonisjs/ally`
- User par defaut : `admin@cuttie.com` / `admin`
- Tous les endpoints API sont proteges (sauf login et OAuth)
- SSE : token passe en query param `?token=xxx` (EventSource ne supporte pas les headers)
- `user_id` (nullable) sur tables `jobs` et `renders` — filtre par ownership
- Le Python worker ne connait pas les users (il fait des UPDATE, jamais de INSERT sur jobs)

## API

| Endpoint                              | Methode | Auth     | Description                      |
|---------------------------------------|---------|----------|----------------------------------|
| `/api/auth/login`                     | POST    | Public   | Login email/password             |
| `/api/auth/logout`                    | DELETE  | Token    | Logout (supprime le token)       |
| `/api/auth/me`                        | GET     | Token    | User courant                     |
| `/api/auth/google/redirect`           | GET     | Public   | Demarre le flow OAuth Google     |
| `/api/auth/google/callback`           | GET     | Public   | Callback OAuth Google            |
| `/api/analyze`                        | POST    | Token    | Soumettre une URL Twitch         |
| `/api/jobs`                           | GET     | Token    | Lister les analyses (du user)    |
| `/api/jobs/{id}`                      | GET     | Token    | Status + hot points d'un job     |
| `/api/jobs/{id}/retry`                | POST    | Token    | Relancer depuis un checkpoint    |
| `/api/jobs/{id}/sse`                  | GET     | SSE Token| SSE temps reel                   |
| `/api/clips/{id}/{filename}`          | GET     | Token    | Telecharger un clip              |
| `/api/clips/{id}/{filename}/edit-env` | GET     | Token    | Donnees editeur                  |
| `/api/clips/{id}/{filename}/trim`     | POST    | Token    | Trim clip FFmpeg                 |
| `/api/renders`                        | GET     | Token    | Liste des exports                |
| `/api/renders`                        | POST    | Token    | Lancer un export Remotion        |
| `/api/renders/{id}`                   | GET     | Token    | Status d'un export               |
| `/api/assets`                         | GET     | Token    | Liste des assets                 |
| `/api/assets/upload`                  | POST    | Token    | Upload asset                     |

## Conventions

- Langue du code : anglais (variables, fonctions, commentaires techniques)
- Langue du contenu/UI : francais
- Tests : Vitest (unit + functional), pytest (backend)
- Logs via `logging` standard Python
- Frontend : React 19 (hooks, context, React Router 7)
- Composants : functional components + TypeScript interfaces Props
- State : React Context (auth, toast) + custom hooks (useEditorState)
- i18n : i18next avec fr/en/es
- Gestion deps backend : uv
- Gestion deps frontend : npm
- Gestion deps API : npm
