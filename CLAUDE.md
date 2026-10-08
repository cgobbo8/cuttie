# Cuttie

Outil d'extraction automatique des moments forts de VODs Twitch. URL in -> clips horizontaux analyses et scores out. Editeur de clips integre avec export Remotion.

Tourne 100 % en local (cible : app desktop Windows pour un ami streamer) : pas de Docker, Redis ni S3/MinIO. L'API et le worker partagent un dossier de donnees (`CUTTIE_DATA_DIR`) et se parlent en HTTP sur 127.0.0.1.

## Stack

- **API** : AdonisJS 7 (TypeScript), SQLite (better-sqlite3), Transmit SSE en memoire
- **Worker** : Python 3.12, serveur FastAPI local (file de jobs en memoire), SQLite (WAL), uv
- **Frontend** : React 19, TypeScript 5.9, Tailwind CSS 4, Vite 8, React Router 7
- **Editor** : Remotion 4 (player + renderer), canvas editor custom
- **ML/Audio** : librosa (11025 Hz), PANNs CNN14 (AudioSet)
- **LLM** : Groq — Whisper large-v3-turbo (transcription), OpenRouter — Gemini 3 Flash Preview (audio + vision + analyse + scoring + correction transcription)
- **Video** : FFmpeg, OpenCV, yt-dlp
- **Storage** : disque local `<data dir>/storage/{clips,renders,assets}`, servi par l'API via URLs signees
- **Tests** : Vitest (frontend + backend unit/functional)

## Commandes

```bash
# Tout lancer en dev (API HMR + worker auto-reload + Vite, data dir partage <repo>/.data)
npm run dev                         # http://localhost:5173

# Mode "comme l'app desktop" : API compilee qui sert le front build + worker
npm start                           # npm start -- --build pour forcer le rebuild

# Tests
cd frontend && npx vitest           # frontend tests
cd backend && uv run pytest         # backend tests
cd api && node ace test             # API tests (.env.test : data dir jetable, sans auto-login)
```

## Variables d'environnement

Les cles API (Groq, OpenRouter, OpenAI optionnelle) se saisissent dans la page **Parametres** de l'app → `<data dir>/settings.json` (relu a chaud par le worker). En dev, le worker retombe sur `GROQ_API_KEY` / `OPENROUTER_API_KEY` de `backend/.env`.

Positionnees par les lanceurs (`scripts/dev.mjs`, `scripts/launcher.mjs`) :
- `CUTTIE_DATA_DIR` — dossier de donnees partage (defaut `<repo>/.data`)
- `CUTTIE_INTERNAL_SECRET` — secret partage API <-> worker (header `X-Cuttie-Secret`)
- `WORKER_URL` (API) / `CUTTIE_API_URL` + `CUTTIE_WORKER_PORT` (worker)
- `CUTTIE_AUTO_LOGIN` (defaut true), `FRONTEND_DIST` (API sert le front build)

Fichier `api/.env` : voir `api/.env.example` (APP_KEY en dev ; l'app packagee genere `<data dir>/app.key`).

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
│   │   │   ├── storage_controller.ts         # GET /api/storage/* (URLs signees, Range)
│   │   │   ├── app_controller.ts             # app info, parametres (cles API), diagnostic
│   │   │   ├── internal_controller.ts        # evenements de statut pousses par le worker
│   │   │   ├── spa_controller.ts             # sert frontend/dist (FRONTEND_DIST)
│   │   │   ├── renders_controller.ts         # Remotion renders
│   │   │   ├── assets_controller.ts          # Upload/serve assets
│   │   │   └── profile_controller.ts         # Profil utilisateur
│   │   ├── models/
│   │   │   ├── user.ts                       # User + auth + access tokens
│   │   │   └── job.ts                        # Job + JSON columns
│   │   ├── middleware/                        # Auth, SSE auth, silent auth, JSON
│   │   ├── services/
│   │   │   ├── storage.ts                    # stockage local + URLs signees (ex-S3)
│   │   │   ├── data_paths.ts                 # layout du data dir partage
│   │   │   ├── worker_client.ts              # client HTTP du worker (jobs, cancel, words, facecam)
│   │   │   ├── local_user.ts                 # utilisateur local + auto-login
│   │   │   ├── job_status_bus.ts             # evenements worker -> DB + Transmit SSE
│   │   │   └── remotion_renderer.ts          # Bundle + render Remotion
│   │   ├── validators/user.ts                # VineJS validation
│   │   └── transformers/user_transformer.ts
│   ├── database/migrations/                   # migrations SQLite (lancees au boot par start/local_app.ts)
│   ├── remotion/                              # Compositions Remotion (server-side)
│   ├── config/                                # AdonisJS config (auth, cors, shield, etc.)
│   └── start/routes.ts                        # Routes centralisees
│
├── backend/                           # Python Worker — analyse VOD + generation clips
│   ├── worker.py                              # point d'entree (uvicorn sur 127.0.0.1)
│   ├── app/
│   │   ├── main.py                            # serveur local : file de jobs, cancel, words, facecam, diagnostics
│   │   ├── models/schemas.py                  # Pydantic v2
│   │   └── services/
│   │       ├── pipeline.py                    # Orchestrateur (6 etapes)
│   │       ├── downloader.py                  # yt-dlp : audio WAV + chat Twitch GQL
│   │       ├── audio_analyzer.py              # librosa : RMS, flux, pitch, centroid, ZCR, onset
│   │       ├── audio_classifier.py            # PANNs CNN14 : events audio
│   │       ├── chat_analyzer.py               # Sentiment chat : vitesse, burst, emotes, mood
│   │       ├── scorer.py                      # Score composite + peak detection (scipy)
│   │       ├── llm_analyzer.py                # Whisper + frames + LLM unifie (scoring + analyse)
│   │       ├── speaker_diarizer.py            # pyannote diarization + ECAPA-TDNN voiceprint
│   │       ├── clipper.py                     # Extraction clips video
│   │       ├── frame_extractor.py             # Extraction frames pour vision
│   │       ├── subtitle_generator.py          # Whisper word-level + LLM correction sous-titres
│   │       ├── paths.py                       # layout du data dir (CUTTIE_DATA_DIR)
│   │       ├── storage.py                     # stockage local (ex-S3)
│   │       ├── api_events.py                  # envoi ordonne des statuts a l'API
│   │       ├── settings.py                    # lecture settings.json (cles API)
│   │       ├── clip_tools.py                  # transcription a la demande + facecam (editeur)
│   │       ├── openai_client.py               # Clients multi-provider (Groq, OpenRouter)
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

## Pipeline (6 etapes)

```
1. DOWNLOADING_AUDIO   -> Metadata + audio 16 kHz mono WAV + chat Twitch GQL (en parallele)
2. ANALYZING_AUDIO     -> librosa features (5s/2.5s hop) + PANNs CNN14 classification (en parallele)
3. ANALYZING_CHAT      -> Sentiment, emotes, burst detection
4. SCORING             -> Score composite pondere + peak detection -> top 200
5. ANALYZING_CLIPS     -> Pour chaque candidat (sans download video) :
                          a. Whisper transcription (200 segments audio depuis WAV)
                          b. Clip keyword detection ("clip", "clippe", etc.)
                          c. VOD context gathering (1 appel LLM text-only) :
                             - Lit les 200 transcripts chronologiquement
                             - Produit contexte VOD (narrative, phases, protagonistes, themes)
                             - Produit content_score par segment (heat map)
                             - Sauvegarde vod_context en base
                          d. Re-rank blende (50% heuristique + 50% content_score) -> top 50
                          e. En parallele :
                             - 6 frames par candidat via ffmpeg seek sur URL VOD directe
                             - Speaker diarization (pyannote community-1 MPS) + voiceprint ECAPA-TDNN
                               → transcript avec labels speakers ([Streamer]: ..., [SPEAKER_01]: ...)
                          f. 1 appel LLM multimodal par candidat (audio + frames + speaker transcript + chat + vod_context)
                          -> Re-rank par final_score, garde top 20
6. CLIPPING            -> yt-dlp video + FFmpeg extraction (bornes dynamiques RMS)
                          uniquement pour les 20 candidats gardes
-> DONE
```

Checkpoints resumables : CLIPPING, LLM_ANALYSIS.

## Scoring

**Score heuristique** (normalisation baseline-relative, median/P95) :
- RMS 18%, chat_speed 18%, spectral_flux 12%, onset 10%, pitch_var 10%
- chat_burst 10%, emote_density 8%, caps_ratio 7%, centroid 5%, zcr 2%

**Pre-filtre** : `0.5 * heuristique + 0.5 * content_score_LLM` (+ bonus/malus content gems/false positives)

**Score final** : `0.2 * heuristique + 0.8 * LLM virality`

## Authentification

- App locale mono-utilisateur : les requetes venant de l'app sur cette machine (IP loopback, Host loopback, `Sec-Fetch-Site` same-origin/none) sont connectees automatiquement a l'utilisateur local (`local@cuttie.app`, permission `*`) — pas d'ecran de login. Desactivable avec `CUTTIE_AUTO_LOGIN=false` (cas des tests).
- Auth session cookie AdonisJS conservee (login email/password, Google OAuth) pour le mode non-local
- Fichiers (clips, renders, assets) servis via `/api/storage/*` avec URLs signees HMAC(APP_KEY) a duree limitee (pas de session requise pour `<video>` / Remotion)
- Worker <-> API : header `X-Cuttie-Secret` (secret genere a chaque lancement)
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
| `/api/app/info`                       | GET     | Public   | Mode local / auto-login          |
| `/api/settings`                       | GET/PUT | Token    | Cles API (masquees en lecture)   |
| `/api/diagnostics`                    | GET     | Token    | GPU, ffmpeg, yt-dlp, cles, disque|
| `/api/storage/*`                      | GET     | Signee   | Fichiers stockes (Range)         |
| `/api/internal/worker-events`         | POST    | Secret   | Statuts pousses par le worker    |

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
