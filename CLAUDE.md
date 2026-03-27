# Cuttie

Outil d'extraction automatique des moments forts de VODs Twitch. URL in -> clips verticaux (9:16) avec facecam + sous-titres out.

## Stack

- **Backend** : Python 3.10+, FastAPI, SQLite (WAL), uv
- **Frontend** : Svelte 5, TypeScript, Tailwind CSS 4, Vite 8
- **ML/Audio** : librosa (11025 Hz), PANNs CNN14 (AudioSet), MediaPipe (face detection)
- **LLM** : OpenAI — Whisper (transcription), GPT-4.5 (analyse), gpt-4o-mini (correction sous-titres)
- **Video** : FFmpeg, OpenCV, yt-dlp

## Commandes

```bash
# Backend
cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend && npm run dev     # dev (port 5173)
cd frontend && npm run build   # production
```

## Variables d'environnement

Fichier `backend/.env` :
```
OPENAI_API_KEY=sk-proj-...
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=cuttie
S3_ACCESS_KEY=cuttie
S3_SECRET_KEY=cuttieminio
```

Fichier `api/.env` (S3 identique + variables AdonisJS + Google OAuth)

## Architecture

```
cuttie/
├── backend/
│   ├── app/
│   │   ├── main.py                   # FastAPI app + CORS
│   │   ├── routers/
│   │   │   └── analyze.py            # POST /api/analyze, GET /api/jobs, etc.
│   │   ├── models/
│   │   │   └── schemas.py            # Pydantic v2 : JobStatus, HotPoint, SignalBreakdown, LlmAnalysis
│   │   └── services/
│   │       ├── pipeline.py           # Orchestrateur principal (10 etapes)
│   │       ├── downloader.py         # yt-dlp : audio WAV + chat Twitch GQL
│   │       ├── audio_analyzer.py     # librosa : RMS, flux, pitch, centroid, ZCR, onset
│   │       ├── audio_classifier.py   # PANNs CNN14 : events audio (cris, rires, explosions)
│   │       ├── chat_analyzer.py      # Sentiment chat : vitesse, burst, emotes, mood (hype/fun/rip)
│   │       ├── scorer.py             # Score composite + peak detection (scipy)
│   │       ├── triage.py             # Whisper + LLM light scoring : 50 candidats -> 20
│   │       ├── clipper.py            # Extraction clips video (bornes dynamiques RMS)
│   │       ├── vertical_clipper.py   # Generation 9:16 : facecam + game + sous-titres
│   │       ├── facecam_detector.py   # MediaPipe + Canny + HoughLinesP
│   │       ├── subtitle_generator.py # Whisper words -> LLM rewrite -> ASS karaoke
│   │       ├── frame_extractor.py    # Extraction frames pour vision
│   │       ├── vision_analyzer.py    # GPT-4.5 vision sur frames
│   │       ├── llm_analyzer.py       # Analyse complete : vision + synthese + scoring
│   │       └── db.py                 # SQLite persistence (WAL, busy_timeout=5s)
│   ├── assets/fonts/
│   │   └── LuckiestGuy-Regular.ttf   # Font sous-titres
│   ├── pyproject.toml
│   ├── cuttie.db                      # SQLite auto-cree au premier lancement
│   ├── clips/                         # Clips generes par job
│   └── data/                          # Fichiers temporaires (audio, frames)
│
└── frontend/
    └── src/
        ├── App.svelte                 # Composant racine (SPA)
        ├── lib/
        │   ├── api.ts                 # Client REST type-safe
        │   └── components/
        │       ├── UrlForm.svelte     # Input URL
        │       ├── JobStatus.svelte   # Barre de progression + polling 2s
        │       ├── HotPoints.svelte   # Grille resultats (videos, signaux, timeline)
        │       └── JobList.svelte     # Historique des analyses
        └── app.css                    # Tailwind + styles custom
```

## Pipeline (10 etapes)

```
1. DOWNLOADING_AUDIO   -> yt-dlp : audio 11025Hz mono WAV
2. DOWNLOADING_CHAT    -> Twitch GQL : messages chat
3. ANALYZING_AUDIO     -> librosa : features par fenetres de 5s (hop 2.5s)
4. ANALYZING_CHAT      -> Sentiment, emotes, burst detection
5. SCORING             -> Score composite pondere + peak detection -> top 50
6. TRIAGE              -> Whisper segments + LLM light scoring -> top 20
7. CLIPPING            -> yt-dlp video + FFmpeg extraction (bornes dynamiques RMS)
8. VERTICAL            -> 2 phases paralleles :
                          Phase 1 : Whisper + LLM rewrite + ASS (5 workers API-bound)
                          Phase 2 : FFmpeg render 1080x1920 (3 workers CPU-bound)
9. LLM_ANALYSIS        -> Frames + GPT-4.5 vision + synthese narrative
10. DONE
```

Checkpoints resumables : CLIPPING, VERTICAL, TRANSCRIBING, LLM_ANALYSIS.

## Scoring

**Score heuristique** (normalisation baseline-relative, median/P95) :
- RMS 18%, chat_speed 18%, spectral_flux 12%, onset 10%, pitch_var 10%
- chat_burst 10%, emote_density 8%, caps_ratio 7%, centroid 5%, zcr 2%

**Score final** : `0.3 * heuristique + 0.7 * LLM virality`

## Layout vertical (1080x1920)

```
┌──────────────────┐
│   (blurred bg)   │
│  ┌────────────┐  │
│  │  facecam   │  │  560px, top center, border-radius 20px
│  └────────────┘  │
│                  │
│  ┌────────────┐  │
│  │   game     │  │  70% hauteur, centre
│  │  (cropped) │  │
│  └────────────┘  │
│  (bande floue)   │  marge bottom 60px
└──────────────────┘
```

## Detection facecam

1. MediaPipe face detection sur 5 frames par clip
2. Median des positions sur tous les clips, filtrage outliers (>2x largeur face)
3. Carte d'edges persistantes (Canny sur 20+ frames, seuil >50%)
4. HoughLinesP -> bordures de l'overlay (lignes droites persistantes)
5. Snap aux bords du frame si <8%, inner crop 5px

## Sous-titres

- Whisper word-level timestamps -> LLM rewrite (gpt-4o-mini, correction francais)
- ASS karaoke (\kf tags) : remplissage progressif mot par mot
- Couleur remplissage : blanc legerement teinte vers la couleur dominante du clip
- Couleur base : couleur dominante (k-means sur 3 frames)
- Font : Luckiest Guy, bold, uppercase, outline noire

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

## Conventions

- Langue du code : anglais (variables, fonctions, commentaires techniques)
- Langue du contenu/UI : francais
- Pas de tests unitaires pour le moment (MVP)
- Logs via `logging` standard Python
- Frontend : Svelte 5 runes ($state, $derived, $effect)
- Gestion deps backend : uv
- Gestion deps frontend : npm
