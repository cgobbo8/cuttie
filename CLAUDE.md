# Cuttie

Outil d'extraction automatique des moments forts de VODs Twitch. URL in -> clips horizontaux analyses et scores out. Editeur de clips integre avec export Remotion.

Tourne 100 % en local (cible : app desktop Windows pour un ami streamer) : pas de Docker, Redis ni S3/MinIO. L'API et le worker partagent un dossier de donnees (`CUTTIE_DATA_DIR`) et se parlent en HTTP sur 127.0.0.1.

## Stack

- **API** : AdonisJS 7 (TypeScript), SQLite (better-sqlite3), Transmit SSE en memoire
- **Worker** : Python 3.12, serveur FastAPI local (file de jobs en memoire), SQLite (WAL), uv
- **Frontend** : React 19, TypeScript 5.9, Tailwind CSS 4, Vite 8, React Router 7
- **Editor** : Remotion 4 (player + renderer), canvas editor custom
- **ML/Audio** : librosa (11025 Hz), PANNs CNN14 (AudioSet) — 358 Mo telecharges au demarrage du worker (`panns_files.py` : Zenodo puis miroir Hugging Face, SHA-256 verifie, reprise) ; facultatif : s'il manque, l'analyse continue sans rires / cris (notice `audio_events`)
- **Transcription** : Whisper large-v3 turbo ; en « auto », le plus rapide : Groq si sa cle est la (un live de 7 h en 25 s, ~0,04 $/h), sinon en local quand la machine est rapide (mlx-whisper sur puce Apple, faster-whisper sur NVIDIA), sinon OpenRouter — `transcriber.py`, bascule sur OpenRouter si le moteur choisi coince (limite horaire du Groq gratuit comprise)
- **LLM** : OpenRouter — Gemini 3 Flash Preview (audio + vision + analyse + scoring) ; recherche dans le live : GPT-6 Luna avec des outils (repli : Claude Haiku 5.5), Gemini 3.1 Flash Lite pour ecouter un passage ; plan d'une video decrite : GPT-6.1 Terra (voir « Recherche par l'IA »)
- **Video** : FFmpeg, OpenCV, yt-dlp
- **Storage** : disque local `<data dir>/storage/{clips,renders,assets}`, servi par l'API via URLs signees
- **Tests** : Vitest (frontend + backend unit/functional)

## Commandes

```bash
# Tout lancer en dev (API HMR + worker auto-reload + Vite, data dir partage <repo>/.data)
npm run dev                         # http://localhost:5173

# Mode "comme l'app desktop" : API compilee qui sert le front build + worker
npm start                           # npm start -- --build pour forcer le rebuild

# App desktop (Electron, voir desktop/README.md)
cd desktop && npm run dev           # coque Electron sur le depot (apres un npm start)
cd desktop && npm run pack          # app empaquetee pour cet OS ; Cuttie --smoke-test=full --smoke-report=r.json

# Tests
cd frontend && npx vitest           # frontend tests
cd backend && uv run pytest         # backend tests
cd api && node ace test             # API tests (.env.test : data dir jetable, sans auto-login)
```

## Variables d'environnement

Les cles API (OpenRouter obligatoire, Groq et OpenAI facultatives) et le moteur de transcription (`transcription` : auto | groq | openrouter | local) se reglent dans la page **Parametres** de l'app → `<data dir>/settings.json` (relu a chaud par le worker). En dev, le worker retombe sur `GROQ_API_KEY` / `OPENROUTER_API_KEY` de `backend/.env`. Le modele Whisper local (1,5 Go) se telecharge dans `<data dir>/models/whisper`.

Positionnees par les lanceurs (`scripts/dev.mjs`, `scripts/launcher.mjs`) :
- `CUTTIE_DATA_DIR` — dossier de donnees partage (defaut `<repo>/.data`)
- `CUTTIE_INTERNAL_SECRET` — secret partage API <-> worker (header `X-Cuttie-Secret`)
- `WORKER_URL` (API) / `CUTTIE_API_URL` + `CUTTIE_WORKER_PORT` (worker)
- `CUTTIE_AUTO_LOGIN` (defaut true), `FRONTEND_DIST` (API sert le front build)
- `CUTTIE_APP_VERSION` (version de l'app desktop, dans l'export des journaux), `CUTTIE_CLEANUP_DAYS` (menage par defaut : 30 dans l'app installee, rien en dev)
- `CUTTIE_LLM_CMD` (dev seulement) : commande qui lit une invite sur stdin et ecrit la reponse, a la place d'OpenRouter pour les appels texte de `llm_text.py` (recherche IA, plan, montage IA) — ex. `claude -p --model sonnet --tools ""` — pour tester sans depenser de credits. Une commande ne peut pas appeler d'outils : avec elle, la recherche et le plan lisent tout le transcript en une fois (l'ancienne methode)
- `CUTTIE_SEARCH_MODEL`, `CUTTIE_SEARCH_FALLBACK`, `CUTTIE_EARS_MODEL`, `CUTTIE_EYES_MODEL`, `CUTTIE_PLAN_MODEL` : modeles de la recherche dans le live (celui qui cherche, celui qui prend le relais, celui qui ecoute, celui qui regarde les passages pour choisir leur modele, celui qui construit une video decrite) ; `CUTTIE_SEARCH_MAX_COST` / `CUTTIE_PLAN_MAX_COST` : plafond d'une question (0,05 $) et d'une video decrite (0,12 $)

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
│   │   │   ├── support_controller.ts         # journaux : taille, vider, export .zip (periode, cles masquees), erreurs de la page
│   │   │   ├── disk_controller.ts            # espace disque, menage des anciens clips, liberer / recuperer un projet
│   │   │   ├── internal_controller.ts        # evenements de statut pousses par le worker
│   │   │   ├── spa_controller.ts             # sert frontend/dist (FRONTEND_DIST)
│   │   │   ├── renders_controller.ts         # Remotion renders (un clip, ou un montage de plusieurs morceaux)
│   │   │   ├── compilations_controller.ts    # recherche dans le live, plan de video par l'IA, compilations, decoupe des passages
│   │   │   ├── assets_controller.ts          # Upload/serve assets
│   │   │   └── profile_controller.ts         # Profil utilisateur
│   │   ├── models/
│   │   │   ├── user.ts                       # User + auth + access tokens
│   │   │   └── job.ts                        # Job + JSON columns (hot_points, selection, timeline, facecam)
│   │   ├── middleware/                        # Auth, SSE auth, silent auth, JSON
│   │   ├── services/
│   │   │   ├── storage.ts                    # stockage local + URLs signees (ex-S3)
│   │   │   ├── data_paths.ts                 # layout du data dir partage
│   │   │   ├── worker_client.ts              # client HTTP du worker (jobs, cancel, words, facecam, palette, recherche, passages)
│   │   │   ├── local_user.ts                 # utilisateur local + auto-login
│   │   │   ├── job_status_bus.ts             # evenements worker -> DB + Transmit SSE (statut, timeline, candidats)
│   │   │   ├── brand_kit.ts                  # kit de marque dans settings.json (couleurs, widget, sous-titres, webcam)
│   │   │   ├── facecam_resolver.ts           # quelle cam pour un live / visible dans un clip (voir "Webcam")
│   │   │   ├── edit_env_resolver.ts          # donnees editeur d'un clip (dims, cam, mots, chat)
│   │   │   ├── twitch.ts                     # GQL public Twitch : chaine, VODs, storyboards
│   │   │   ├── clip_variants.ts              # fond floute 9:16 pre-calcule (ffmpeg)
│   │   │   ├── clip_extend.ts                # +30 s sur un cote de la coupe (le fichier grandit si besoin)
│   │   │   ├── clip_pieces.ts                # un clip coupe en plusieurs morceaux (selection[clip].segments)
│   │   │   ├── compilations.ts               # compilations (jobs.compilations) : parties, passages, leurs clips piece_<id>.mp4
│   │   │   ├── compilation_flat.ts           # une compilation collee en un seul clip (flat_<id>_<signature>.mp4, ses mots, son chat) pour l'editeur a calques
│   │   │   ├── worker_failure.ts             # refus du worker -> reponses de l'API (pas de transcript, credits, live parti)
│   │   │   ├── clip_thumbs.ts                # vignettes (ffmpeg, cache) ; gardees quand les clips sont liberes
│   │   │   ├── disk_space.ts                 # place prise, projets inactifs, liberer (exports gardes), recuperer, menage auto (6 h)
│   │   │   ├── app_logs.ts                   # journal de l'app desktop (<data dir>/logs) : periode, cles masquees, vider
│   │   │   ├── zip.ts                        # petit ecrivain .zip (deflate) pour l'export des journaux
│   │   │   ├── db_time.ts                    # dates SQLite : `dbTime()` = format Lucid pour les UPDATE bruts de jobs, `dbMillis()` lit les deux formats
│   │   │   ├── sound_level.ts                # son de chaque export mis au niveau des reseaux (-14 LUFS, loudnorm en 2 passes, image copiee), raccords d'un montage adoucis
│   │   │   └── remotion_renderer.ts          # Bundle + render Remotion (CuttieVideo : un clip ; CuttieMontage : des morceaux bout a bout)
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
│   │       ├── transcriber.py                 # Speech-to-text : Groq / OpenRouter / local (mlx-whisper, faster-whisper), mots normalises
│   │       ├── vod_transcript.py              # Le live entier transcrit en arriere-plan, par morceaux de 10 min (cache transcripts/<job>)
│   │       ├── presort.py                     # L'IA lit tout le live (transcript + pics du chat) et propose des moments
│   │       ├── speaker_diarizer.py            # qui parle quand, sans compte : Silero VAD + WeSpeaker (ONNX) + regroupement prudent, empreinte du streamer
│   │       ├── clipper.py                     # Extraction clips video ; `cut_from_live` / `settle_start` : un fichier decoupe demarre sur sa premiere image et sait ou elle est dans le live
│   │       ├── facecam_detector.py            # YOLOv8 pose + accroche au cadre de la cam, visages par clip
│   │       ├── palette.py                     # couleurs du logo / de la banniere (roles accent, highlight, dark, light)
│   │       ├── timeline.py                    # analyse en direct : courbe d'energie, chat, candidats
│   │       ├── frame_extractor.py             # Extraction frames pour vision
│   │       ├── subtitle_generator.py          # Whisper word-level + LLM correction sous-titres
│   │       ├── paths.py                       # layout du data dir (CUTTIE_DATA_DIR)
│   │       ├── storage.py                     # stockage local (ex-S3)
│   │       ├── api_events.py                  # envoi ordonne des statuts a l'API
│   │       ├── settings.py                    # lecture settings.json (cles API)
│   │       ├── clip_tools.py                  # transcription a la demande + cam d'un live (clips) ou d'une VOD + clip allonge (+30 s) + clips recoupes depuis le live (projet libere) + passages du live decoupes pour les compilations
│   │       ├── live_search.py                 # chercher dans tout le live : mots dits / ecrits dans le chat, recherche et plan de video par l'IA (cache disque, suivi des etapes, modele de repli), montage d'un clip par l'IA
│   │       ├── live_agent.py                  # l'IA qui cherche avec des outils : boucle d'appels (OpenRouter), ecoute d'un passage, reponse verifiee, plafond de cout
│   │       ├── live_tools.py                  # (`ManyLives` : les memes outils sur plusieurs lives a la fois, chaque appel dit « live 1, 2... ») les outils de cette IA : apercu du live, 50 meilleurs moments de l'analyse, mots dits, chat et ses rafales, sons, voix qui montent, lire un passage (une ligne = son heure au dixieme et le temps qu'elle prend a dire)
│   │       ├── tight_cut.py                   # un passage coupe sur ses mots : son texte retrouve parmi les mots dates de son clip, la coupe posee la ou la voix commence et s'arrete (niveau du son)
│   │       ├── sound_index.py                 # ce qu'on entend dans tout le live, seconde par seconde (PANNs, 23 familles de sons, ~1 Mo par live)
│   │       ├── looks.py                       # le modele de chaque passage d'une video, choisi par l'IA qui regarde 3 images de chacun ; « a quoi sert » un modele perso
│   │       ├── llm_text.py                    # appels texte a l'IA (OpenRouter ; CUTTIE_LLM_CMD en dev), cout estime
│   │       ├── openai_client.py               # Clients multi-provider (Groq, OpenRouter)
│   │       ├── provider_errors.py             # Refus definitifs (credits, cle) -> arret clair de l'analyse
│   │       └── db.py                          # SQLite persistence (WAL)
│   ├── assets/fonts/LuckiestGuy-Regular.ttf
│   └── pyproject.toml
│
├── desktop/                           # App Windows (Electron) — voir desktop/README.md
│   ├── main.mjs                               # demarrage, Python via uv au 1er lancement, lanceur, mises a jour, --smoke-test
│   ├── preload.cjs                            # window.cuttieDesktop (version, mises a jour, journaux, reparation)
│   ├── setup.html                             # ecran de demarrage / installation
│   └── scripts/                               # stage.mjs (ce que l'installeur embarque), smoke-test.ps1
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
        │   ├── MontagePage.tsx                # /:jobId/montage — 7 modeles Remotion, cam par live
        │   ├── CompilationsPage.tsx           # /compilations (toutes, par live) et /:jobId/compilations (celles d'un live) : cartes, exportee ou non, dupliquer, renommer, supprimer, nouvelle
        │   ├── CompilationPage.tsx            # /:jobId/compilation?c=<id> — l'editeur d'une compilation : decrire la video a l'IA, chercher dans le live, compiler des passages
        │   ├── TemplateEditorPage.tsx         # /modeles/:id — editeur de modele par elements (glisser, calques, widgets, timing)
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
        │   ├── project/                       # AnalysisView, MomentPlayer/List/Details, VodTimeline, Stepper, RenderCard, ModeSwitch (Clips | Compilations)
        │   ├── montage/                       # TemplatePicker (onglets Mes modeles / Modeles Cuttie, etoile par defaut), TemplateSketch, CamSheet
        │   ├── compilation/                   # LivePicker (choisir un live, ou plusieurs), CompilationCard (une compilation dans la bibliotheque), SearchPanel (mots / IA / decrire la video), PiecePreview (un passage et sa coupe), PlanTalk (la conversation avec l'IA sur une video decrite), CompilationPanel (parties, passages a cocher / glisser, transitions, duree), TransitionPicker (les transitions, chacune jouee en petit), CompilationGuide (l'ecran explique en 4 etapes a la premiere visite)
        │   ├── template-editor/               # EditorCanvas (apercu + poignees), LayerList (calques), Panels (reglages), Scrubber (timeline)
        │   ├── KeyField.tsx                   # Champ de cle API verifie aupres du fournisseur
        │   ├── WebcamFrame.tsx                # Frame + rectangle de cam deplacable
        │   ├── TemplatePreview.tsx            # Apercu du modele par defaut (memes calques que l'export)
        │   ├── Toast.tsx                      # Systeme de notifications
        │   ├── ConfirmModal.tsx               # Dialog confirmation
        │   ├── ProjectRemoveModal.tsx         # Liberer l'espace (clips) ou supprimer le projet
        │   ├── ui/Tooltip.tsx                 # Radix tooltip wrapper
        │   ├── editor/                        # Canvas editor (layers, panels, viewport) ; widgets/kit = widgets de marque (copies cote API)
        │   └── remotion-editor/               # Remotion composition + layers ; MontageComposition = des morceaux bout a bout (copie cote API)
        └── lib/
            ├── api.ts                         # Client REST type-safe + SSE
            ├── desktop.ts                     # pont vers l'app desktop : mises a jour (pastille TopBar, Parametres > Application)
            ├── clientErrors.ts                # erreurs de la page -> journal de l'app (20 max, une fois chacune)
            ├── AuthContext.tsx                 # Auth context + session
            ├── SettingsContext.tsx            # Parametres (cles, onboarded)
            ├── ChannelContext.tsx             # Kit de marque + chaine Twitch, couleur d'accent de l'app
            ├── BackdropContext.tsx            # Image floutee derriere l'app
            ├── TransmitContext.tsx            # SSE Transmit (un uid par flux)
            ├── templates.ts                   # briques des modeles (contexte du clip, recadrages, fond floute), suggestion
            ├── builtinTemplates.ts            # les 7 mises en page de Cuttie, en modeles a elements
            ├── templateSpec.ts                # modeles perso v2 (elements) -> calques, timing des widgets, zones couvertes, drag
            ├── templateKeys.ts                # cle de modele : une des 7 mises en page ou un modele perso
            ├── templateGuide.ts               # la fiche de chaque modele pour l'IA : place de chaque element, arrivees, effets (lue dans le modele), a quoi il sert
            ├── fonts.ts                       # polices des clips (@fontsource, copiees cote API)
            ├── moments.ts / renders.ts / projects.ts  # Logique pure des ecrans (testee)
            ├── montage.ts                     # morceaux d'un clip (couper, garder, enlever les silences, caler sur les mots) -> ce que Remotion joue
            ├── compilation.ts                 # compilations : resultats -> passages, parties, ordre (un passage ou plusieurs a la fois), transitions, ajuster a une duree
            ├── transitions.ts                 # les 7 transitions toutes faites entre deux morceaux d'un montage (copie cote API)
            ├── compilationLibrary.ts          # la bibliotheque : ou en est une compilation (vide, brouillon, exportee, modifiee depuis), groupes par live, nom d'une copie
            ├── editorTypes.ts                 # Types editeur (layers, state)
            ├── editorThemes.ts                # Themes pre-definis
            ├── animations.ts                  # Animations Remotion
            └── i18n/index.ts                  # i18next (fr/en/es)
```

## Pipeline (6 etapes)

```
1. DOWNLOADING_AUDIO   -> Metadata + audio 16 kHz mono WAV + chat Twitch GQL (en parallele)
                          puis transcription du live entier en arriere-plan (morceaux de 10 min,
                          moteur local si rapide, repli OpenRouter par morceau ; ~11 min pour 5 h sur M1 Max)
2. ANALYZING_AUDIO     -> librosa features (5s/2.5s hop) + PANNs CNN14 16 kHz (rires, cris, parole ; en parallele)
                          puis index sonore du live pour les recherches (sound_index.py, ~30 s pour 5 h sur M1 Max)
3. ANALYZING_CHAT      -> Sentiment, emotes, burst, demandes de clip des viewers ;
                          decalage du chat estime (correlation son/chat, defaut 5 s)
4. SCORING             -> Score composite pondere + peak detection -> top 200
5. ANALYZING_CLIPS     -> Pour chaque candidat (sans download video) :
                          a. Texte de chaque candidat lu dans le transcript du live (sinon Whisper
                             sur les 200 segments ; morceaux rates -> job.notices)
                          b. Mot "clip" dit n'importe ou dans le live (15 max, demandes d'abord) ->
                             fenetre des 2 min avant, verifiee par le LLM (vraie demande = clip
                             "detected", garde quel que soit son rang)
                          b'. Pre-tri par l'IA (presort.py, 1 appel texte ~0,05 $) : lit tout le transcript
                             (une ligne / ~20 s) + les pics du chat -> jusqu'a 40 moments, fenetres
                             elargies (-10 s / +20 s, la reaction) ; un candidat qui chevauche prend la
                             fenetre de l'IA ; 15 des 50 places de l'etape f leur sont reservees ;
                             un moment trouve en lisant prend les mesures de la fenetre la plus forte
                             de son passage (scorer.ScoreTrack), marque found_by = "reading"
                          c. VOD context gathering (1 appel LLM text-only) :
                             - Lit les 200 transcripts chronologiquement
                             - Produit contexte VOD (narrative, phases, protagonistes, themes)
                             - Produit content_score par segment (heat map)
                             - Sauvegarde vod_context en base
                          d. Re-rank blende (50% heuristique + 50% content_score) -> top 50
                          e. En parallele :
                             - 6 frames par candidat via ffmpeg seek sur URL VOD directe
                             - Qui parle quand (speaker_diarizer.py, local, sans compte Hugging Face) :
                               Silero VAD + empreintes WeSpeaker ResNet34 (ONNX, 26 Mo) sur des fenetres
                               de 1,5 s, regroupement prudent (2,2 voix / clip, 4 max) ; empreinte du
                               streamer = la voix retrouvee dans le plus de 12 passages repartis sur le live
                               → transcript avec labels speakers ([Streamer]: ..., [SPEAKER_01]: ...)
                          f. 1 appel LLM multimodal par candidat (audio + frames + speaker transcript
                             + chat recale + vod_context) -> score, titre, accroche, coupe conseillee
                          -> Re-rank par final_score, garde top 20
6. CLIPPING            -> yt-dlp video + FFmpeg extraction (bornes dynamiques RMS)
                          uniquement pour les 20 candidats gardes ; chaque fichier demarre sur sa premiere image
                          (voir « Decoupe »)
                          + reperage de la webcam sur les clips (facecam.json v3 : cadre + qui est ou, toutes les 4 s de chaque clip)
                          + mots des clips gardes transcrits sur leur audio si le live l'a ete sans
-> DONE
```

Checkpoints resumables : CLIPPING, LLM_ANALYSIS.

Fournisseur qui refuse tout (`provider_errors.py`) : credits OpenRouter epuises (402) ou cle refusee (401) -> l'analyse s'arrete avec un message clair et une notice `provider` (lien « Recharger mes credits » dans l'app), jamais de repli silencieux sur le score heuristique. Verifie aussi au demarrage (1 token) et dans le diagnostic.

## Scoring

**Score heuristique** (normalisation baseline-relative, median/P95 ; chat lu `chat_lag` s plus tard) :
- chat_speed 18%, onset 14%, pitch_var 14%, spectral_flux 12%, RMS 10%
- chat_burst 10%, emote_density 8%, caps_ratio 7%, centroid 5%, zcr 2%
- Multiplicateurs : accord son + chat (x1,3 max), sentiment du chat, voix forte ; son de jeu seul (x0,85)
- Bonus additifs : excitation vocale PANNs (+0,25), viewers qui demandent un clip (+0,3 a partir de 2)

**Pre-filtre** : `0.5 * heuristique + 0.5 * content_score_LLM` (+ bonus/malus content gems/false positives)

**Score final** : `0.2 * heuristique + 0.8 * LLM virality`

**Coupe conseillee** : le clip extrait garde ses marges (45-90 s) ; le LLM propose `cut_start` / `cut_end` (15-45 s en general), appliques comme trim par defaut dans Choisir et Monter tant que le streamer n'a pas coupe lui-meme.

## Recherche par l'IA

« Demander a l'IA » et « Decrire la video » (ecran Compilation) : un modele qui appelle des outils, pas une lecture du transcript en une fois (essayee d'abord : 1 bon passage sur 4, et rien sur « les moments ou ca pete »).

- **Outils** (`live_tools.py`, chacun repond peu et exactement, heures en H:MM:SS) : `overview` (titre, jeu, resume, phases), `best_moments` (les 50 moments notes par l'analyse, clippes ou non : score, genre, nom, ce qui s'y passe ; l'API les envoie depuis `jobs.timeline.candidates`, le worker n'ayant garde que les 20 clippes), `search_speech` et `search_chat` (mots dits / ecrits), `chat_peaks` (la ou le chat s'emballe : rafales de messages bien au-dessus de son rythme, d'au moins 2 viewers), `find_sounds` (22 familles : coups de feu, cris, rires, sirenes...), `loud_moments` (voix qui montent, plus fort, silences), `read` (ce qui se dit entre deux heures, le chat, ce qu'on entend), `listen` (30 s du live envoyees a un petit modele qui entend, 12 ecoutes au plus), puis `answer` (ou `plan` pour une video) qui termine.
- **Index sonore** (`sound_index.py`) : PANNs ecoute tout le live par fenetres de 2 s, une par seconde ; fait pendant l'analyse, ou a la premiere question pour les lives analyses avant (son retelecharge : 2 a 3 min, une seule fois). Il se trompe (une moto passe pour des coups de feu) : il dit ou regarder, l'IA confirme en ecoutant.
- **Consignes** (`live_agent.py`) : comprendre l'argot comme le streamer l'entend (« ca pete » = l'action eclate), verifier chaque passage (`read`, `listen`), noter honnetement (80-100 exact, 50-79 plus doux, moins de 50 seulement proche), ne jamais remplir ; s'il n'y a rien, donner les passages les plus proches avec ce qui manque. Un plan de video qui fait moins des trois quarts de la duree demandee est renvoye une fois au modele.
- **Un passage = des lignes** : l'IA donne l'heure de la premiere ligne a garder et celle de la derniere, recopiees de `read` (au dixieme de seconde : deux lignes courtes ne se confondent pas). Les lignes du transcript local durent « 6 s » pour une phrase de 2 s : `read` et `search_speech` disent donc le temps qu'une ligne prend a dire (0,22 s par mot + 0,4 s sans mots dates), et c'est avec ca que l'IA et la relance comptent la duree de la video. Les vraies bornes viennent ensuite du clip (voir « Coupes calees sur les mots »).
- **Une video decrite** (`plan`) a son propre modele : trouver des passages est une chose, lire ce que veut dire chaque partie d'une description et y ranger les passages en est une autre. Consigne : ranger par ce qui se passe, pas par les mots communs (quand les parties racontent un avant et un apres, celui qui reparle de ce qui a ete dit, s'en moque ou le reproche va dans l'apres), et chercher la suite d'abord autour des passages de la partie d'avant.
- **Ce qu'elle n'a pas** : l'image (elle ne voit pas la video ; ce qui s'y passe lui vient des resumes de `best_moments`, ecrits par l'analyse qui, elle, a vu des images) et les courbes entieres (elle recoit des pics : 20 par demande, espaces de 15 a 45 s). Le modele qui ecoute repere bien une sirene ou un choc, mal une vraie colere (il decrit presque tout comme « ca plaisante »).
- **Garde-fous** : 28 etapes (36 pour un plan), 0,05 $ par question au plus et 0,12 $ par video decrite (la reponse est alors forcee), connexion coupee reessayee 3 fois, modele de repli si le premier echoue (plan : Terra, puis Luna, puis Haiku), credits epuises ou cle refusee dits tels quels. Les modeles Claude ne gardent en cache ce qu'on leur envoie que si on le demande (`cache_control`) : sans, chaque etape repaie toute la conversation (mesure : 0,0025 $ -> 0,0003 $ l'appel). Les tests ne peuvent joindre aucun fournisseur (`tests/conftest.py`).
- **Choix du modele** (14/11/2026, 9 modeles, 8 requetes sur un live de 4 h 43, 68 recherches, chaque passage juge ; 1,02 $ en tout) : GPT-6 Luna, precision 0,91, 76 % des bons passages trouves, 0,002 $ et ~20 s par recherche ; Claude Haiku 5.5 0,84 / 71 % / 0,005 $ ; Gemini 3 Flash 0,83 / 62 % / 0,014 $ (jusqu'a 0,07 $) ; GLM 5.3 0,78 / 58 % / 0,010 $ ; DeepSeek V4.1 Flash 0,78 / 40 % / 0,014 $ et 2 min ; Kimi K3 0,73 / 58 % / 0,083 $. Aucun de ces modeles n'a besoin d'entendre : l'ecoute passe par Gemini 3.1 Flash Lite (~0,0004 $ les 15 s).
- **Choix du modele du plan** (14/11/2026, catalogue OpenRouter du jour : 189 modeles recents avec outils ; 9 essayes sur la vraie demande d'un streamer, 2 parties, live de 6 h 49, compares aux 31 passages qu'un monteur (Fable 5.2, a la main) avait gardes ; 0,36 $ en tout) : GPT-6 Luna met toute phrase contenant le mot dans la 1re partie et trouve 0 a 2 des 20 passages de la 2e (0,004 $) ; Luna en effort moyen 2 (0,012 $, 2 min 30) ; Claude Haiku 5.5 3 a 5 (0,012 $) ; Gemini 3.5 Flash Lite 5 sans verifier (0,011 $) ; Claude Sonnet 5.5 7, video trop courte (0,09 $) ; Gemini 3.8 Flash 8 (0,10 $, plafond atteint) ; Muse Ember en erreur ; **GPT-6.1 Terra 14 puis 11 en deux essais, ranges juste, a la duree demandee, 0,03-0,04 $ et 45 s**. Limites : une seule demande, un ou deux essais par modele, les gammes au-dessus (Opus, Fable, Astra : 4 a 10 $ le million) non essayees.

## Coupes calees sur les mots

Un passage trouve dans le live (mots ou IA) a d'abord les heures que le transcript donne a ses lignes, approximatives quand il n'a pas les mots dates (moteur local : la moitie des lignes font « 2,0 s » pile, une phrase de 2 s peut tenir dans une ligne de 6 s). Une fois son clip decoupe, il est recale tout seul :

- `tight_cut.py` (worker) : le texte des lignes du passage est retrouve parmi les mots dates du clip (`difflib`, 60 % des mots au moins ; une replique du milieu entendue autrement par les deux transcriptions ne le fait pas perdre, un mot entendu autrement au bord est rendu s'il s'enchaine), puis la coupe est posee sur le son : debut 0,1 s avant que la voix monte, fin 0,1 s apres qu'elle retombe. L'heure d'un mot n'est qu'a peu pres juste : le dernier mot d'une phrase « dure » souvent jusqu'au mot suivant, le premier commence dans le silence ; le niveau du son (toutes les 10 ms) tranche. Jamais dans le mot voisin ; mots introuvables (un son, autre chose) : le passage reste tel quel.
- Une ligne du transcript s'arrete souvent avant la fin de la phrase : un passage qui finirait en pleine parole va jusqu'a ce que la personne s'arrete (`finish_sentence`, 3 s de plus au maximum). On ne coupe pas quelqu'un au milieu d'un souffle.
- Trajet : `item.fit` = les lignes du transcript (secondes du live) tant que le passage attend ; `POST /api/jobs/:id/pieces` l'envoie au worker, qui repond `tight` ; l'app pose alors le passage dessus (`applyTight`) et oublie `fit`. Une coupe faite a la main l'emporte.
- Compare aux 31 points de coupe d'un monteur sur le meme live : fins a moins de 0,15 s dans 93 % des cas, debuts souvent 0,2-0,3 s plus serres (il avait laisse le silence que l'heure du premier mot contenait).
- « Ajuster a 1 min 30 » ne raccourcit plus une phrase : les longs passages (plus de 6 s) raccourcissent, puis les plus faibles s'en vont (note de l'IA ; sinon le dernier de la partie la plus longue), jamais le seul d'une partie. Une video decrite n'est ajustee qu'une fois ses passages recales, et aucun n'y est raccourci (rogner un passage coupe sur ses mots, c'est couper un mot) : jusqu'a 10 % de plus que demande elle reste telle quelle, au-dela les passages les moins bien notes sortent.

## Compilations sur plusieurs lives

Une compilation peut prendre des passages dans plusieurs lives du streamer (5 au plus, le sien compris) ; l'IA travaille alors sur tous a la fois.

- **Donnees** : la compilation reste rangee avec un live (`jobs.compilations` de celui-la, le plus recent des lives coches) et nomme les autres (`compilation.lives` : ids de jobs). Un passage d'un autre live le dit (`item.job`) : ses heures, sa duree maximale, son clip `piece_<id>.mp4`, ses mots, sa webcam et ses vignettes sont ceux de ce live-la, dans le dossier de ce live. Sans `job`, rien ne change (un seul live : memes donnees qu'avant).
- **IA** (`live_tools.ManyLives`) : les memes outils, mais chaque appel dit le live (`live` : 1, 2...) et `overview` sans `live` les liste avec leur date ; les heures sont celles de chaque live. Chaque moment rendu dit son `live`, est relu dans le transcript de ce live et revient avec son `job`. Consigne ajoutee (`live_agent.MANY`) : chercher dans chaque live, faire jouer les passages live apres live dans une partie, piocher dans chacun quand la demande parle de ce qui revient d'un live a l'autre. 12 etapes de plus et moitie de plafond en plus par live ajoute. Un seul live : consigne et reponses inchangees.
- **API** : seuls les lives analyses de l'utilisateur sont acceptes (`otherLives`) ; `/pieces`, `/words`, `edit-env`, les vignettes restent par live (l'app les appelle avec le live du passage) ; `/looks` et `montage-render` lisent chaque clip dans son live ; le menage des clips inutilises regarde toutes les compilations de l'utilisateur (un live ne supprime plus les clips qu'une compilation rangee ailleurs y a decoupes) ; un projet supprime retire ses passages des compilations rangees avec d'autres lives (`withoutLive`) et confie les siennes a un autre de leurs lives (`movedTo`).
- **Bibliotheque** : une compilation faite de plusieurs lives est rangee avec un seul mais se voit dans chacun (bibliotheque, page des compilations d'un live, filtre, compteur de chaque live) : `GET /api/compilations` rend la meme carte sous chaque live de `lives`, avec `home` = le live qui la garde (la ou elle s'ouvre, se renomme, se copie, se supprime). Elle compte une fois dans le total (`libraryCount`) ; la pastille « 2 lives » dit lesquels au survol ; la supprimer la retire de tous (dit dans la confirmation).
- **Projet supprime** : dans les deux sens. Le projet d'un autre live supprime : la compilation perd ses passages de ce live (`withoutLive`). Le projet du live qui la garde supprime : elle passe au plus recent de ses autres lives (`movedTo`), sans les passages du live parti ; les passages du nouveau live deviennent les siens (leurs clips y sont deja). Elle part avec le projet seulement s'il ne lui reste aucun passage. Ses exports, eux, partent avec le projet supprime.
- **Ecran** : dans la bibliotheque, « Nouvelle compilation » laisse cocher plusieurs lives (`LivePicker`) ; dans l'editeur, une frise par live (numero, titre, date, passages pris), « Ajouter un live », un live sans passage se retire ; chaque passage porte le numero de son live ; « Chercher a la main » choisit le live ou chercher ; « Decrire la video » et la conversation cherchent dans tous.
- **Lives pas encore analyses** : le choix des lives (`LivePicker`) liste aussi les VOD de la chaine sans analyse (ou dont l'analyse s'est arretee) ; « Analyser » dit d'abord le prix (`ANALYSIS_COST` : environ 0,30 $ de credits OpenRouter, mesure a 0,31 $ sur un live de 5 h) et ne lance qu'apres confirmation ; l'avancement s'affiche dans la liste, et le live devient cochable une fois pret.
- Essai reel (14/11/2026, lives du 9/11 de 6 h 49 et du 11/10 de 4 h 43) : video de 1 min decrite sur les deux -> 2 parties, 9 passages du premier et 5 du second, 0,044 $ et 31 s ; un changement demande dans le fil (retirer un passage, en ajouter un du deuxieme live) : 0,025 $ et 23 s ; export de 63 s, les clips lus dans deux dossiers.
- Limites : les passages d'un live dont la VOD a quitte Twitch ne peuvent plus etre decoupes (ceux deja decoupes restent) ; la recherche a la main se fait un live a la fois ; le jeu affiche par les widgets est celui du live de la compilation.

## Decoupe : un fichier demarre sur sa premiere image

Une copie sans reencodage ne peut commencer que sur une image cle. Demande a 1:23:45,4, ffmpeg gardait le temps 0 a 1:23:45,4 mais l'image ne commencait qu'a l'image cle suivante (jusqu'a 2 s plus tard sur Twitch), et le fichier le disait par une attente avant ses pistes. Resultat, vu sur un vrai export : image figee au debut d'un passage, et sous-titres en avance (les mots sont transcrits sur le son du fichier, qui ignore cette attente).

- `clipper.cut_from_live` + `settle_start` : apres la copie, le fichier est reecrit (sans reencodage) pour commencer sur sa premiere image, son et image a 0, et `_meta.json` dit ou elle est dans le live (`settled: true`).
- Passages des compilations : decoupes depuis le debut d'un segment HLS, sans recherche (`-ss`), le seul endroit ou il y a une image cle a coup sur ; un passage decoupe avant (`settled` absent) est redecoupe a sa prochaine utilisation.
- Clips deja sur le disque (analyses d'avant) : laisses tels quels, avec leur ancienne horloge ; « +30 s » ne recale que les clips `settled`. Sur ces anciens clips, les sous-titres transcrits sur le clip (transcription locale) peuvent avoir jusqu'a 2 s d'avance.

## Modele par passage

Dans une compilation, chaque passage peut avoir son propre modele (`item.template`) ; sans, il suit celui de la video (`compilation.template`). Le montage construit chaque morceau avec son modele ; l'accroche, les widgets et les pop-ups viennent du modele de la video, et le carton de titre d'une partie s'ecrit comme le modele de son premier passage.

- **A la main** : « Mise en page de ce passage » sous le passage (ecran Compilation) ; « Meme modele partout » remet tout au modele de la video.
- **Une mise en page decrite vaut pour toute la video** : quand le streamer a dit ce qu'il veut (« ma camera en haut, le jeu dessous »), chaque passage garde le modele de la video, sauf celui ou il ne peut pas marcher (bati autour de la cam, personne dedans). Sans rien de demande, l'IA varie quand un passage l'appelle. (Vu sur la vraie demande : 8 passages sur 19 etaient partis sur un autre modele.)
- **Par l'IA** (`looks.py`, bouton « Mise en page par l'IA », ~0,0005 $ par passage) : d'abord le modele de toute la video, decide une fois (GPT-6 Luna lit la demande et les fiches ; sans demande, le modele habituel du streamer, sans appel) ; puis Gemini 3.1 Flash Lite regarde 3 images de chaque passage, ce qui s'y dit et si quelqu'un est dans la cam, par lots de 16, et ne change de modele que si le passage le demande vraiment (personne dans la cam, l'image est le sujet, conversation, grosse reaction). Un modele bati autour de la cam n'est jamais donne a un passage sans personne dedans.
- **Fiche de chaque modele** (`templateGuide.ts`) : ecrite a partir du modele lui-meme (les 7 mises en page et les modeles perso sont le meme objet), donc toujours exacte : place et taille de chaque element, style des sous-titres, accroche, pop-ups avec leur arrivee et leur depart, empilement, puis « a quoi il sert » (ecrit a la main pour les 7 ; pour un modele perso : `usage`, redige par l'IA a l'enregistrement s'il est vide, modifiable dans l'editeur).
- **Depuis « Decrire la video »** : le plan rend aussi ce que la description dit de l'apparence (`look`, dans les mots du streamer) ; l'app lance alors la mise en page toute seule des que les passages sont decoupes.
- Essai reel (demande de l'ami : « ma camera en haut, l'image en zoom centre en dessous, pop-up avec nom et logo, transcription sous la limite ») : « Empile » choisi 3 fois sur 3 pour les bonnes raisons, 13 passages regardes en 15 s pour 0,004 $.

## Transitions

7 transitions toutes faites entre deux passages d'une compilation : flash, zoom, glisse, balayage (vers le haut), secousse, rebond, fondu ; sinon coupe nette.

- **Rien ne change de duree** : une transition ne deplace que l'image autour de la coupe. Le son de chaque passage commence ou il commencait, les sous-titres restent cales, « Ajuster a 1 min 30 » compte pareil. Avant la coupe elle joue sur les dernieres images du passage qui part (zoom, secousse, flash) ; apres, sur les premieres de celui qui arrive.
- **Deux images a la fois** (glisse, balayage, rebond, fondu) : la derniere image du passage d'avant est tenue figee derriere celui qui arrive (`<Freeze>`, muette), le temps de la transition (environ un tiers de seconde).
- **Un seul calcul** (`frontend/src/lib/transitions.ts`, `transitionAt(id, image depuis la coupe, fps)`) pour l'apercu, l'export et les petits dessins du selecteur : copie dans `api/remotion/transitions.ts` par `scripts/sync-remotion.mjs`. Tout est en parts de l'image (%, flou en part de la largeur) : pareil a toute taille.
- **Donnees** : `compilation.transition` (celle de toute la video, absente : coupes nettes) et `item.transition` (ce passage arrive autrement : une transition, ou `"cut"`). Le premier passage de la video n'en a jamais. `MontageSegment.transition` jusqu'au rendu ; l'API refuse une transition qu'elle ne connait pas (`compilations.TRANSITIONS`, tenue egale a la liste du rendu par un test).
- **Dans le montage** : chaque morceau est enveloppe d'une boite sans existence (`display: contents`) qui ne devient une vraie boite que pendant la transition ; le reste du temps ses calques s'empilent parmi les widgets comme avant. L'accroche, les widgets et les titres de parties ne bougent pas.
- Verifie sur un vrai export (14 passages de deux lives, une transition differente a chaque coupe, images sorties autour de chaque coupe) : 71,9 s avec comme sans transitions.
- Pas fait : son de transition (pas de banque de sons libre embarquee), transitions pour un clip coupe en morceaux dans Choisir, l'IA ne les choisit pas.

## Une compilation dans l'editeur a calques

L'editeur a calques (`RemotionEditor`) travaille sur un clip : une video, une horloge, un jeu de calques. Une compilation en est plusieurs. « Ouvrir dans l'editeur » la colle donc en un seul clip, que l'editeur ouvre comme n'importe quel autre.

- **Le clip** (`compilation_flat.ts`) : `flat_<compilation>_<signature>.mp4` dans le dossier du live de la compilation. Chaque passage y est coupe a l'image pres (l'image est reencodee : une copie ne peut commencer que sur une image cle), tous amenes a la taille et a la cadence du premier, le son descendu a zero sur 8 ms a chaque raccord. Avec lui, comme pour un clip : `_probe.json`, `_words.json` (les mots de chaque passage deplaces la ou il joue maintenant, ceux coupes en moins) et `_chat.json` (le chat de chaque passage, sur l'horloge du clip ; `chatInClip` le lit quand il existe).
- **La signature** nomme les passages et leurs coupes : une compilation qui n'a pas change redonne le meme fichier (rien n'est refait, et l'editeur retrouve le travail deja fait dessus, garde sous le nom du clip) ; une coupe qui bouge donne un autre fichier, l'ancien est supprime.
- **Les calques** de depart : ceux du modele de la video, construits pour ce clip (`buildAny`), plus le titre de chaque partie la ou son premier passage commence. Ils ne sont ecrits que si l'editeur n'a encore rien pour ce clip.
- **Ce qui ne suit pas** : l'editeur n'a qu'une mise en page pour toute la video. Les transitions et le modele propre a certains passages ne sont pas repris (dit sous le bouton quand la compilation en a) ; la cam est celle du live de la compilation (un passage d'un autre live ou elle est ailleurs sera mal cadre).
- **Export** depuis l'editeur : un export classique (`CuttieVideo`) du clip colle ; la bibliotheque le compte comme un export de la compilation (`flat_<id>_…` comme `comp_<id>.mp4`). Le clip part avec la compilation, et avec les clips quand le projet est libere.
- Mesure (14/11/2026, 14 passages de deux lives, 71,8 s en 1080p 60 images/s) : colle en 15 s sur M1 Max, 47 Mo, image et son de meme longueur, 279 mots recales ; rouvert en 0,1 s ; export depuis l'editeur a -14,1 LUFS.

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
| `/api/jobs/{id}/selection`            | PATCH   | Token    | Garder / passer / trim un clip, ou le couper en morceaux (`segments`) |
| `/api/jobs/{id}/facecam`              | PUT     | Token    | Cam reglee a la main pour ce live|
| `/api/jobs/{id}/chat`                 | GET     | Token    | Messages du chat de chaque clip  |
| `/api/jobs/{id}/sse`                  | GET     | SSE Token| SSE temps reel                   |
| `/api/clips/{id}/{filename}`          | GET     | Token    | Telecharger un clip              |
| `/api/clips/{id}/{filename}/edit-env` | GET     | Token    | Donnees editeur                  |
| `/api/clips/{id}/{filename}/trim`     | POST    | Token    | Trim clip FFmpeg                 |
| `/api/clips/{id}/{filename}/extend`   | POST    | Token    | +30 s avant / apres (re-extrait) |
| `/api/clips/{id}/{filename}/thumb`    | GET     | Token    | Vignette (clip ou render)        |
| `/api/clips/{id}/{filename}/words`    | GET     | Token    | Mots du clip (cales de coupe)    |
| `/api/clips/{id}/{filename}/suggest-cut` | POST | Token    | Morceaux a garder selon l'IA (rien n'est enregistre) |
| `/api/clips/{id}/{filename}/background` | GET   | Token    | Fond floute 9:16 du clip         |
| `/api/brand-kit`                      | GET/PUT | Token    | Kit de marque                    |
| `/api/brand-kit/detect-colors`        | POST    | Token    | Couleurs du logo -> kit          |
| `/api/brand-kit/template-usage`       | POST    | Token    | « A quoi sert » un modele perso, redige par l'IA depuis sa fiche |
| `/api/brand-kit/detect-facecam`       | POST    | Token    | Cam sur le dernier live (non sauvee) |
| `/api/brand-kit/frame`                | GET     | Token    | Frame ou la cam a ete confirmee  |
| `/api/twitch/channel`                 | GET     | Token    | Chaine du kit + VODs + analyses  |
| `/api/twitch/lookup?login=`           | GET     | Token    | Chaine avant sauvegarde          |
| `/api/twitch/lookup/colors?login=`    | GET     | Token    | Couleurs avant sauvegarde        |
| `/api/twitch/vods/{id}/storyboard`    | GET     | Token    | Planches d'apercu d'une VOD      |
| `/api/renders`                        | GET     | Token    | Liste des exports                |
| `/api/renders`                        | POST    | Token    | Lancer un export Remotion        |
| `/api/jobs/{id}/montage-render`       | POST    | Token    | Export de plusieurs morceaux bout a bout (clip coupe, compilation) |
| `/api/jobs/{id}/search/info`          | GET     | Token    | Ce qui se cherche dans le live, cout d'une question a l'IA |
| `/api/jobs/{id}/search`               | POST    | Token    | Passages du live : mots (gratuit) ou IA (`mode: "ai"`) |
| `/api/jobs/{id}/search/progress`      | GET     | Token    | Ce que fait l'IA pendant qu'elle cherche (outil appele, sur quoi) |
| `/api/jobs/{id}/plan`                 | POST    | Token    | Video decrite -> parties et passages (IA) ; avec `request`, `current`, `asks` : la video deja construite, changee comme demande ; avec `lives` (ids d'autres lives) : l'IA travaille sur tous, chaque passage dit son live (`job`) |
| `/api/jobs/{id}/pieces`               | POST    | Token    | Decoupe les passages demandes dans le live (410 : live parti) ; avec `fit`, repond `tight` : ou ces mots sont vraiment dits |
| `/api/jobs/{id}/looks`                | POST    | Token    | L'IA regarde les passages decoupes et choisit le modele de chacun (409 : rien de decoupe) |
| `/api/jobs/{id}/compilations`         | GET/POST | Token   | Compilations du live             |
| `/api/jobs/{id}/compilations/{compId}` | PUT/DELETE | Token | Enregistrer / supprimer une compilation |
| `/api/jobs/{id}/compilations/{compId}/duplicate` | POST | Token | Copie d'une compilation, avec ses propres clips (fichiers copies) |
| `/api/jobs/{id}/compilations/{compId}/flatten` | POST | Token | La compilation collee en un seul clip pour l'editeur a calques (409 : un passage n'est pas decoupe) |
| `/api/compilations[?job_id=]`         | GET     | Token    | Les lives analyses et leurs compilations (duree, passages, dernier export) ; une compilation de plusieurs lives est sous chacun (`home` : celui qui la garde) |
| `/api/renders/{id}`                   | GET     | Token    | Status d'un export               |
| `/api/assets`                         | GET     | Token    | Liste des assets                 |
| `/api/assets/upload`                  | POST    | Token    | Upload asset                     |
| `/api/app/info`                       | GET     | Public   | Mode local / auto-login          |
| `/api/settings`                       | GET/PUT | Token    | Cles API (masquees), onboarded, guides vus (`guide_seen`) |
| `/api/settings/verify`                | POST    | Token    | Verifie une cle aupres du fournisseur |
| `/api/diagnostics`                    | GET     | Token    | GPU, ffmpeg, yt-dlp, cles, disque|
| `/api/logs`                           | GET/DELETE | Token | Taille du journal / le vider     |
| `/api/logs/export?hours=`             | GET     | Token    | .zip : journal, diagnostic, analyses (cles masquees) |
| `/api/client-log`                     | POST    | Token    | Erreur de la page -> journal     |
| `/api/disk`                           | GET     | Token    | Place prise, menage, projets     |
| `/api/disk/cleanup`                   | PUT     | Token    | Menage auto (0, 7, 30, 90 jours) |
| `/api/disk/free`                      | POST    | Token    | Liberer les projets inactifs     |
| `/api/jobs/{id}/free`                 | POST    | Token    | Liberer les clips d'un projet    |
| `/api/jobs/{id}/restore`              | POST    | Token    | Recouper ses clips depuis le live (410 : live parti) |
| `/api/storage/*`                      | GET     | Signee   | Fichiers stockes (Range)         |
| `/api/internal/worker-events`         | POST    | Secret   | Statuts pousses par le worker    |

## Parcours

- Premier lancement `/bienvenue` (installation sans analyse ni `onboarded` dans settings.json) : chaine Twitch (lives + couleurs du logo), deux cles (verifiees aupres de Groq / OpenRouter), webcam reperee sur le dernier live pendant ce temps.
- Projet en 4 etapes : Analyse (en direct) -> Choisir (garder / passer / trim) -> Monter (7 modeles a la DA de la chaine) -> Exporter.
- Choisir : le chat sur la frise du live (barres, le dixieme le plus actif en blanc vif) et sur celle du clip (un point par message, le texte au survol) ; « + » au survol de la frise du clip = 30 s de plus de ce cote (le clip est re-extrait du live quand la coupe depasse son fichier : mots, cam et vignettes suivent) ; « Pourquoi ce moment » dit d'ou vient un moment (score son + chat, lu par l'IA, demande sur le stream, ajoute a la main).
- Coupe en plusieurs morceaux (Choisir) : « Couper ici » (C) coupe le morceau sous la tete de lecture, « Garder ce passage » ajoute un morceau la ou le clip est coupe (du contexte avant la coupe de l'IA), « × » au survol retire un morceau, « Enlever les silences » retire les blancs de plus d'1,1 s (mots du clip), « Montage IA » demande a l'IA les morceaux a garder (moins d'un centime), Annuler / Ctrl+Z. Les poignees se calent entre deux mots (Alt : librement). La lecture saute les coupes. `selection[clip].segments` (2 morceaux ou plus, secondes du clip) ; `trim` reste l'enveloppe.
- Compilations = un mode a part entiere, au meme niveau que les clips : onglet « Compilations » de la barre du haut (toutes, groupees par live avec sa date, filtre par live, « Nouvelle compilation » en choisissant le live) et interrupteur « Clips | Compilations » sur les pages d'un projet (`ModeSwitch`). Une carte par compilation : etat (vide, brouillon, exportee = un export fini de `comp_<id>.mp4`, « modifiee depuis » si enregistree plus d'une minute apres), duree, passages, dupliquer (les clips des passages sont copies : la copie marche meme si le live a quitte Twitch), renommer, supprimer. « Nouvelle » reprend la compilation vide laissee la derniere fois plutot que d'en empiler.
- Editeur d'une compilation (`/:jobId/compilation?c=<id>`, `?new=1` depuis la bibliotheque) : chercher dans tout le live par mots (dits : transcript du live ; ecrits : chat ; gratuit, immediat, phrases serrees quand le transcript a les mots dates) ou en demandant a l'IA (elle fouille le live avec des outils, ecoute et verifie chaque passage : moins d'un centime, 10 a 30 s, reponse gardee sur disque : la meme question ne se paie qu'une fois ; ce qu'elle fait s'affiche en direct, sa note dit ce qui correspond vraiment, les passages seulement « proches » sont marques), ajouter les passages a des parties titrees, ou decrire toute la video (« Decrire la video » : l'IA propose parties + passages pour une duree visee, et applique la mise en page demandee : voir « Modele par passage »). Chaque passage a son petit clip `piece_<id>.mp4` decoupe dans le live (segments HLS utiles seulement, depuis le debut du premier, 0,6 a 8 s de marge apres), avec les memes fichiers annexes qu'un clip, puis est recale sur ses mots (voir « Coupes calees sur les mots »). Tout reste modifiable : ordre, coupe de chaque passage, titres, modele, « Ajuster a 1 min 30 ». A la premiere visite, l'ecran s'explique en 4 etapes illustrees avec ses propres elements (chercher, ce que fait l'IA, lire ses reponses, construire la video) ; « Comment ca marche » le rouvre. Vu une fois pour toutes : `guides_seen` dans settings.json (pas dans le navigateur, l'adresse de l'app peut changer).
- Ecran d'une compilation, au centre : la video entiere dans son modele, et dessous le passage ouvert pour regler sa coupe (plus d'onglets « Passage | Video entiere »). Un clic sur un passage de la liste amene la video entiere dessus (elle continue si elle jouait, sinon elle s'arrete sur sa premiere image nette, transition finie) et l'ouvre dessous ; le passage sur lequel est la video est marque dans la liste (barre de la couleur de la chaine) et suit la lecture. Un seul son a la fois : la video entiere fait taire le passage et inversement. La video prend la hauteur que la fenetre lui laisse au-dessus du passage ; « × » ferme le passage et lui rend toute sa hauteur.
- Plusieurs passages a la fois (`CompilationPanel.tsx`) : une case sur chaque vignette (au survol, puis sur toutes des qu'une est cochee), Ctrl / Cmd + clic sur un passage, Maj + clic pour tous jusqu'a celui-la. Une barre flottante dit combien sont coches et propose : monter / descendre ensemble (`moveItems` : ils gardent leur ordre, passent dans la partie voisine au bout de la leur), « Deplacer vers » une partie ou une nouvelle (`placeItems`), leur donner une transition, les retirer. Glisser un passage (ou tous les coches, si celui qu'on attrape l'est) le depose ou le trait l'indique, dans sa partie ou une autre ; un appui qui ne bouge pas de 6 px reste un clic.
- Transitions toutes faites (voir « Transitions ») : une pour toute la video (reglages, sous le modele), et un passage peut arriver autrement (bouton au survol de sa ligne, ou depuis la barre des passages coches) ; ce choix s'affiche entre les deux passages.
- A la fin, deux sorties : « Exporter la compilation », ou « Ouvrir dans l'editeur » (voir « Une compilation dans l'editeur a calques »).
- Conversation sur une video decrite (onglet « Decrire la video », `PlanTalk.tsx`) : une fois la video construite, le streamer continue dans un fil (« ajoute les autres moments ou ils disent calme », « apres ce passage, mets celui ou… », « retire le doublon »). L'IA recoit la description d'origine, la video telle qu'elle est (retouches a la main comprises, chaque passage dit par ses lignes du transcript), les demandes precedentes et la nouvelle ; elle rend toute la video (`live_agent.Searcher.revise`, `live_search.revise_video`, meme endpoint `/plan` avec `request` / `current` / `asks`, jamais mis en cache). Ce qu'elle a garde reste le passage d'avant (son clip, sa coupe, son modele) ; un passage qu'elle rend avec d'autres lignes (« des cuts plus agressifs » : `hit.recut`, compare cote worker aux lignes envoyees) garde son clip et son modele et est recoupe sur ces lignes ; rendu en deux, sa seconde moitie est un nouveau passage ; le reste est nouveau (`revisedSections`). La premiere reponse de l'IA (`compilation.answer` : ce qu'elle a mis dans chaque partie et pourquoi) ouvre le fil, et la construction de la video s'y suit pas a pas comme un changement. Le fil (`compilation.brief`, `asks` avec la reponse et le nombre de passages ajoutes / retires) est garde avec la video. A l'ecran : ce que fait l'IA s'ecrit ligne a ligne pendant qu'elle travaille ; les passages ajoutes arrivent eclaires dans la video et la liste defile jusqu'a eux, ceux qu'elle retire s'en vont barres, les autres glissent a leur place ; la pastille « N passages ajoutes » d'une reponse les rallume. ~0,02 $ et 30 s par demande (mesure sur 3 demandes).
- Montage (plusieurs morceaux dans une video) : composition Remotion `CuttieMontage` (app et rendu). Chaque morceau garde l'horloge de son clip (videos, sous-titres, chat) ; l'accroche, les widgets et les titres de parties tournent une seule fois sur l'horloge de la video. Les exports classiques (un clip, une coupe) passent toujours par `CuttieVideo`.
- Design : verre fonce pose sur du contenu floute (vignettes, frames), une seule couleur d'accent = couleur de la chaine.
- Modeles : les 7 mises en page, chacune sa structure (Empile = cam en bandeau / jeu ; Reaction = visage en grand + jeu en vignette ; Discussion RP = scene du jeu + cam ronde, conversation et chat dessous ; Action = jeu plein ecran + cam ronde ; Cinema = ecran du live entier entre deux bandes, titre au-dessus ; Signature = cartes sur fond floute ; Sans cam) + les modeles perso du streamer (`brand_kit.templates`, v2 = elements : fond, jeu (ou ecran entier), cam, chat, sous-titres, accroche, widgets avec arrivee / depart / animations, ordre des calques) ; `brand_kit.default_template` sert aux nouveaux projets. L'editeur a calques reste le mode avance.
- Zones couvertes par TikTok / Shorts / Reels (1080x1920) : haut y < 200, bas y > 1440, droite x > 930 entre y 760 et 1440. Textes, cam et marque restent hors de ces zones (teste) ; le jeu peut passer dessous, une cam pleine largeur en haut passe sous les onglets.
- Accroche = couverture du clip : visible des la 1re image, s'efface apres 3,5 s (ou a la moitie, ou jamais), posee sur le jeu, jamais sur le visage. Sous-titres : 1 a 5 mots a la fois, le mot prononce grossit (`pop`). Chat : messages du clip en bulles (`chatForClip` retire emotes, commandes, bots, liens ; les noms d'emotes viennent de Twitch au telechargement).
- Widgets du kit, polices et transitions : ecrits dans `frontend/`, copies dans `api/remotion` par `node scripts/sync-remotion.mjs` (verifie par `remotionSync.test.ts`).

## App desktop (Windows)

- Electron autour du mode `npm start` : `scripts/launcher.mjs` lance l'API (node.exe embarque, celui du build : `better-sqlite3`) et le worker, attend que les deux repondent.
- Python n'est pas embarque : `uv.exe` installe Python 3.12 + `backend/uv.lock` (PyTorch CUDA 12.6) au 1er lancement dans `%LOCALAPPDATA%\Cuttie\python-env` ; relance un `uv sync` quand `uv.lock` change. Donnees : `%LOCALAPPDATA%\Cuttie\data`.
- Windows neuf : runtime Visual C++ embarque (`resources/bin/msvc`, `CUTTIE_DLL_DIRS` lu par `backend/worker.py`), certificats de certifi pour urllib (`SSL_CERT_FILE`). Le CSS ne doit pas doubler `backdrop-filter` avec `-webkit-backdrop-filter` (le minifieur ne garderait que le second : plus de flou dans l'app compilee, teste).
- Teste en vrai sur un portable Windows (GTX 1650 Max-Q) : live de 7 h 39 analyse en 2 h (transcription locale ~4,6x temps reel), export Remotion OK, mises a jour 0.1.0 -> 0.1.1 -> 0.1.2 (bouton). `--update-test=<rapport>` rejoue le bouton de mise a jour sans fenetre.
- Mises a jour : `electron-updater` + GitHub Releases (`latest.yml`), pastille dans la TopBar, Parametres > Application ; installation silencieuse apres arret de l'API et du worker.
- Son des exports : chaque export est mesure puis amene a -14 LUFS (pic -1,5 dBTP), le niveau auquel TikTok, Shorts et Reels jouent ; un live est souvent bien en dessous (-26 LUFS mesure) et inegal. `sound_level.ts`, ffmpeg `loudnorm` en deux passes, l'image est copiee (7 s pour 1 min 30) ; un echec laisse l'export tel quel. Dans la meme passe, les raccords d'un montage sont adoucis : le son descend a zero sur 8 ms a chaque coupe et remonte aussi vite (une voix coupee en pleine onde fait un clic).
- Journal : `<data dir>/logs/cuttie.log` (API, worker, app ; une ligne = heure ISO UTC), tourne a 10 Mo (cuttie.1.log, cuttie.2.log : 30 Mo max). Parametres > Aide a distance : export .zip d'une periode (journal, diagnostic, analyses et exports, reglages sans cles), « Supprimer les journaux ». On y trouve la vitesse de chaque morceau de transcription, le bilan de chaque analyse (duree des etapes, estimation contre realite), la vitesse des exports et les erreurs de la page.
- Dates de `jobs` : Lucid ecrit et ne relit que `2026-10-11 09:23:17` (UTC). Un UPDATE brut doit passer par `dbTime()`, jamais `toISOString()` (le modele verrait une date invalide et `job.save()` echouerait ; la migration 1776100000000 a remis au propre les anciennes). La table `renders`, elle, est en ISO.
- Compilations et stockage : les passages (`piece_*.mp4`, ~8 Mo par segment de 10 s) partent avec les clips quand un projet est libere et reviennent avec « Recuperer les clips » ; un passage retire d'une compilation (ou seulement regarde) est supprime au bout d'une heure, tous a la suppression de la compilation.
- Stockage : un projet = ~1 Go de clips. Parametres > Stockage : place prise, menage des projets sans activite (7 / 30 / 90 jours, automatique toutes les 6 h ou a la main). Liberer = supprimer les clips (et fonds floutes) ; le projet, ses exports, vignettes, mots et cam restent, `jobs.clips_freed_at` le dit, et « Recuperer les clips » les recoupe depuis la VOD tant que Twitch l'a (7 a 60 jours).
- CI `.github/workflows/desktop.yml` (windows-latest) : installeur, installation silencieuse, `--smoke-test=full`, tests sous Windows ; un tag `v*` (= version de `desktop/package.json`) publie la release avec `desktop/release-notes.md`.

## Webcam

La position confirmee au premier lancement est un **repere**, pas une regle : la cam peut bouger d'un live a l'autre.
- Chaque analyse relocalise la cam sur ses clips (worker, fin de CLIPPING) -> `facecam.json` v3 : le cadre, et qui est ou sur une image cle toutes les 4 s de chaque clip (PyAV, ~1 s par clip).
- `facecam_resolver.ts` : cam reglee a la main pour ce live (`jobs.facecam`) > repere si meme place (IoU >= 0.5) > position du live sinon (`moved`, signale dans Monter).
- La cam est jugee sur la partie exportee (coupe du streamer, sinon coupe de l'IA) : personne dedans sur plus de la moitie des images (webcam passee en plein ecran, ecran de pause, streamer absent) -> monte sans cam, sauf « afficher quand meme ».

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
