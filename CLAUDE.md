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
│   │   │   ├── jobs_controller.ts            # CRUD jobs + SSE, selection (gardes/passes/trim), cam par live
│   │   │   ├── clips_controller.ts           # Download clips, edit-env, vignettes, fond floute 9:16
│   │   │   ├── brand_controller.ts           # Kit de marque, chaine Twitch, couleurs, webcam, recherche de chaine
│   │   │   ├── storage_controller.ts         # GET /api/storage/* (URLs signees, Range)
│   │   │   ├── app_controller.ts             # app info, parametres (cles API + verification, onboarded), diagnostic
│   │   │   ├── internal_controller.ts        # evenements de statut pousses par le worker
│   │   │   ├── spa_controller.ts             # sert frontend/dist (FRONTEND_DIST)
│   │   │   ├── renders_controller.ts         # Remotion renders
│   │   │   ├── assets_controller.ts          # Upload/serve assets
│   │   │   └── profile_controller.ts         # Profil utilisateur
│   │   ├── models/
│   │   │   ├── user.ts                       # User + auth + access tokens
│   │   │   └── job.ts                        # Job + JSON columns (hot_points, selection, timeline, facecam)
│   │   ├── middleware/                        # Auth, SSE auth, silent auth, JSON
│   │   ├── services/
│   │   │   ├── storage.ts                    # stockage local + URLs signees (ex-S3)
│   │   │   ├── data_paths.ts                 # layout du data dir partage
│   │   │   ├── worker_client.ts              # client HTTP du worker (jobs, cancel, words, facecam, palette)
│   │   │   ├── local_user.ts                 # utilisateur local + auto-login
│   │   │   ├── job_status_bus.ts             # evenements worker -> DB + Transmit SSE (statut, timeline, candidats)
│   │   │   ├── brand_kit.ts                  # kit de marque dans settings.json (couleurs, widget, sous-titres, webcam)
│   │   │   ├── facecam_resolver.ts           # quelle cam pour un live / visible dans un clip (voir "Webcam")
│   │   │   ├── edit_env_resolver.ts          # donnees editeur d'un clip (dims, cam, mots, chat)
│   │   │   ├── twitch.ts                     # GQL public Twitch : chaine, VODs, storyboards
│   │   │   ├── clip_variants.ts              # fond floute 9:16 pre-calcule (ffmpeg)
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
│   │   ├── main.py                            # serveur local : file de jobs, cancel, words, facecam (clips + VOD), palette, diagnostics
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
│   │       ├── facecam_detector.py            # YOLOv8 pose + accroche au cadre de la cam, visages par clip
│   │       ├── palette.py                     # couleurs du logo / de la banniere (roles accent, highlight, dark, light)
│   │       ├── timeline.py                    # analyse en direct : courbe d'energie, chat, candidats
│   │       ├── frame_extractor.py             # Extraction frames pour vision
│   │       ├── subtitle_generator.py          # Whisper word-level + LLM correction sous-titres
│   │       ├── paths.py                       # layout du data dir (CUTTIE_DATA_DIR)
│   │       ├── storage.py                     # stockage local (ex-S3)
│   │       ├── api_events.py                  # envoi ordonne des statuts a l'API
│   │       ├── settings.py                    # lecture settings.json (cles API)
│   │       ├── clip_tools.py                  # transcription a la demande + cam d'un live (clips) ou d'une VOD
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
        │   ├── WelcomePage.tsx                # Premier lancement /bienvenue (chaine, cles, webcam)
        │   ├── HomePage.tsx                   # Accueil : dernier live, lives de la chaine, coller un lien
        │   ├── ChannelPage.tsx                # Ma chaine : couleurs, widget, sous-titres, apercu
        │   ├── ProjectsPage.tsx               # Projets (cartes, ouvre l'etape en cours)
        │   ├── ProjectPage.tsx                # /:jobId — Analyse en direct puis Choisir
        │   ├── MontagePage.tsx                # /:jobId/montage — 6 modeles Remotion, cam par live
        │   ├── TemplateEditorPage.tsx         # /modeles/:id — editeur de modele simple (mise en page + reglages)
        │   ├── ExportStepPage.tsx             # /:jobId/export — exports du projet
        │   ├── ExportsPage.tsx                # Bibliotheque d'exports par live
        │   ├── SettingsPage.tsx               # Cles API, langue, diagnostic
        │   ├── RemotionEditPage.tsx           # Editeur avance (calques)
        │   ├── EditPage.tsx                   # Ancien editeur canvas (/:jobId/edit-old)
        │   └── LoginPage.tsx                  # Auth (mode non-local)
        ├── components/
        │   ├── Layout.tsx                     # Shell : fond floute (AppBackdrop) + TopBar
        │   ├── TopBar.tsx                     # Navigation flottante
        │   ├── welcome/                       # Etapes du premier lancement + mur de lives
        │   ├── project/                       # AnalysisView, MomentPlayer/List/Details, VodTimeline, Stepper, RenderCard
        │   ├── montage/                       # TemplateSketch (vignettes de modeles), CamSheet (cam d'un live)
        │   ├── KeyField.tsx                   # Champ de cle API verifie aupres du fournisseur
        │   ├── WebcamFrame.tsx                # Frame + rectangle de cam deplacable
        │   ├── SignaturePreview.tsx           # Apercu fixe du modele Signature
        │   ├── Toast.tsx                      # Systeme de notifications
        │   ├── ConfirmModal.tsx               # Dialog confirmation
        │   ├── ui/Tooltip.tsx                 # Radix tooltip wrapper
        │   ├── editor/                        # Canvas editor (layers, panels, viewport)
        │   └── remotion-editor/               # Remotion composition + layers
        └── lib/
            ├── api.ts                         # Client REST type-safe + SSE
            ├── AuthContext.tsx                 # Auth context + session
            ├── SettingsContext.tsx            # Parametres (cles, onboarded)
            ├── ChannelContext.tsx             # Kit de marque + chaine Twitch, couleur d'accent de l'app
            ├── BackdropContext.tsx            # Image floutee derriere l'app
            ├── TransmitContext.tsx            # SSE Transmit (un uid par flux)
            ├── templates.ts                   # 6 mises en page x reglages (look) -> calques ; modeles perso = base + look
            ├── moments.ts / renders.ts / projects.ts  # Logique pure des ecrans (testee)
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
                          + reperage de la webcam sur les clips (facecam.json v2 : cadre + visages par clip)
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
| `/api/jobs/{id}/selection`            | PATCH   | Token    | Garder / passer / trim un clip   |
| `/api/jobs/{id}/facecam`              | PUT     | Token    | Cam reglee a la main pour ce live|
| `/api/jobs/{id}/sse`                  | GET     | SSE Token| SSE temps reel                   |
| `/api/clips/{id}/{filename}`          | GET     | Token    | Telecharger un clip              |
| `/api/clips/{id}/{filename}/edit-env` | GET     | Token    | Donnees editeur                  |
| `/api/clips/{id}/{filename}/trim`     | POST    | Token    | Trim clip FFmpeg                 |
| `/api/clips/{id}/{filename}/thumb`    | GET     | Token    | Vignette (clip ou render)        |
| `/api/clips/{id}/{filename}/background` | GET   | Token    | Fond floute 9:16 du clip         |
| `/api/brand-kit`                      | GET/PUT | Token    | Kit de marque                    |
| `/api/brand-kit/detect-colors`        | POST    | Token    | Couleurs du logo -> kit          |
| `/api/brand-kit/detect-facecam`       | POST    | Token    | Cam sur le dernier live (non sauvee) |
| `/api/brand-kit/frame`                | GET     | Token    | Frame ou la cam a ete confirmee  |
| `/api/twitch/channel`                 | GET     | Token    | Chaine du kit + VODs + analyses  |
| `/api/twitch/lookup?login=`           | GET     | Token    | Chaine avant sauvegarde          |
| `/api/twitch/lookup/colors?login=`    | GET     | Token    | Couleurs avant sauvegarde        |
| `/api/twitch/vods/{id}/storyboard`    | GET     | Token    | Planches d'apercu d'une VOD      |
| `/api/renders`                        | GET     | Token    | Liste des exports                |
| `/api/renders`                        | POST    | Token    | Lancer un export Remotion        |
| `/api/renders/{id}`                   | GET     | Token    | Status d'un export               |
| `/api/assets`                         | GET     | Token    | Liste des assets                 |
| `/api/assets/upload`                  | POST    | Token    | Upload asset                     |
| `/api/app/info`                       | GET     | Public   | Mode local / auto-login          |
| `/api/settings`                       | GET/PUT | Token    | Cles API (masquees), onboarded   |
| `/api/settings/verify`                | POST    | Token    | Verifie une cle aupres du fournisseur |
| `/api/diagnostics`                    | GET     | Token    | GPU, ffmpeg, yt-dlp, cles, disque|
| `/api/storage/*`                      | GET     | Signee   | Fichiers stockes (Range)         |
| `/api/internal/worker-events`         | POST    | Secret   | Statuts pousses par le worker    |

## Parcours

- Premier lancement `/bienvenue` (installation sans analyse ni `onboarded` dans settings.json) : chaine Twitch (lives + couleurs du logo), deux cles (verifiees aupres de Groq / OpenRouter), webcam reperee sur le dernier live pendant ce temps.
- Projet en 4 etapes : Analyse (en direct) -> Choisir (garder / passer / trim) -> Monter (6 modeles a la DA de la chaine) -> Exporter.
- Design : verre fonce pose sur du contenu floute (vignettes, frames), une seule couleur d'accent = couleur de la chaine.
- Modeles : les 6 mises en page + les modeles perso du streamer (`brand_kit.templates` : base + reglages cam / fond / sous-titres / widget / accroche), crees dans l'editeur simple ; l'editeur a calques reste le mode avance.

## Webcam

La position confirmee au premier lancement est un **repere**, pas une regle : la cam peut bouger d'un live a l'autre.
- Chaque analyse relocalise la cam sur ses clips (worker, fin de CLIPPING) -> `facecam.json` v2.
- `facecam_resolver.ts` : cam reglee a la main pour ce live (`jobs.facecam`) > repere si meme place (IoU >= 0.5) > position du live sinon (`moved`, signale dans Monter).
- Clip ou personne n'est dans la cam (mode realisateur, pause) -> monte sans cam, sauf « afficher quand meme ».

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
