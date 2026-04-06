# Etude de viabilite financiere — Cuttie

> Derniere mise a jour : 6 avril 2026
> Basee sur les prix reels des APIs et l'analyse du code source

---

## Table des matieres

1. [Resume executif](#1-resume-executif)
2. [Cout par VOD — decomposition detaillee](#2-cout-par-vod--decomposition-detaillee)
3. [Cout par streamer par mois](#3-cout-par-streamer-par-mois)
4. [Cout infrastructure](#4-cout-infrastructure)
5. [Cout total par utilisateur actif](#5-cout-total-par-utilisateur-actif)
6. [Analyse de la concurrence](#6-analyse-de-la-concurrence)
7. [Analyse de marche](#7-analyse-de-marche)
8. [Proposition de plans tarifaires](#8-proposition-de-plans-tarifaires)
9. [Projections financieres](#9-projections-financieres)
10. [Optimisations possibles](#10-optimisations-possibles)
11. [Risques](#11-risques)
12. [Verdict](#12-verdict)

---

## 1. Resume executif

**Cuttie coute ~$0.50 par VOD en API/IA** (Whisper + Gemini), avec une infrastructure fixe a ~$20/mois.

Pour un streamer regulier (16 VODs/mois), le cout total est de **~$8.50/mois**. A un prix d'abonnement de **$14.99/mois**, cela degage une marge brute de **50-73%** selon l'intensite d'usage.

Le marche valide un pricing entre $10 et $30/mois pour ce type d'outil. Les concurrents facturent entre $4.99 (Sizzle.gg, detection kills uniquement) et $49 (Munch, agences). **Le sweet spot du marche est a $15/mois** — prix converge par Opus Clip, Choppity, StreamLadder, et Spikes Studio.

**Aucun concurrent ne propose la meme profondeur d'analyse** (audio + chat + vision + LLM combines). C'est le moat technique de Cuttie.

Deux predecesseurs ont ferme (Powder.gg en 2025, Athenascope en 2022) faute de unit economics viables a des prix trop bas. La lecon : **ne pas descendre sous $10/mois et ne pas offrir un tier gratuit illimite**.

---

## 2. Cout par VOD — decomposition detaillee

### Pipeline complet pour une VOD de 3 heures

Le pipeline traite **100 candidats initiaux** (issus du scoring heuristique), en analyse **50 avec le LLM**, et conserve les **20 meilleurs** pour le clipping final.

#### 2.1 Whisper — Transcription (Groq)

| Parametre | Valeur |
|---|---|
| Modele | `whisper-large-v3-turbo` |
| Provider | Groq ($0.04/heure audio) |
| Candidats transcrits | **100** (tous) |
| Duree par segment | 60s (±30s autour du peak) |
| Encodage | MP3 64 kbps (~480 KB/segment) |
| Workers paralleles | 5 |

**Calcul :**
- 100 segments x 60s = 6,000s = **100 minutes = 1.67 heures**
- 1.67h x $0.04/h = **$0.067**

> Note : Groq facture au minimum 10 secondes par requete. Ici chaque segment fait 60s donc pas de surcharge.

#### 2.2 LLM — Analyse unifiee (Gemini 3 Flash via OpenRouter)

| Parametre | Valeur |
|---|---|
| Modele | `google/gemini-3-flash-preview` |
| Provider | OpenRouter |
| Candidats analyses | **50** (top 50 apres tri heuristique) |
| Workers paralleles | 5 |

**Contenu envoye par appel :**

| Element | Tokens estimes | Prix/M tokens | Cout/appel |
|---|---|---|---|
| Prompt texte (~1,250 tokens) | 1,250 | $0.50 | $0.000625 |
| Contexte chat (~200 tokens) | 200 | $0.50 | $0.000100 |
| Audio MP3 60s (base64) | ~2,000-5,000 | $1.00 | $0.002-0.005 |
| 6 frames JPEG (detail: low, ~258 tok/image) | ~1,548 | $0.50 | $0.000774 |
| **Total input** | **~5,200-8,000** | | **$0.0035-0.0065** |
| Output JSON (~1,000 tokens) | 1,000 | $3.00 | $0.003000 |
| **Total par appel** | | | **$0.0065-0.0095** |

**Calcul (estimation mediane) :**
- 50 appels x ~$0.008/appel = **$0.40**

**Decomposition totale pour 50 appels :**

| Poste | Tokens totaux | Cout |
|---|---|---|
| Texte input | 72,500 | $0.036 |
| Audio input | 175,000 (median) | $0.175 |
| Images input | 77,400 | $0.039 |
| Output | 50,000 | $0.150 |
| **Total LLM** | | **$0.40** |

> Le cout audio represente ~44% du cout LLM total. C'est le premier levier d'optimisation.

#### 2.3 Stockage S3/R2

| Element | Volume | Cout |
|---|---|---|
| 20 clips uploades | ~200 MB | $0.003/mois (R2) |
| Metadata JSON (20x3 fichiers) | ~80 KB | negligeable |
| Requetes PUT (~40) | | $0.00018 |

#### 2.4 Ressources locales (gratuites en API, couteuses en compute)

| Operation | Volume | Temps CPU |
|---|---|---|
| Download audio WAV (yt-dlp + ffmpeg) | ~170 MB | 20-30 min |
| Analyse librosa (RMS, pitch, spectral) | 3h audio | 10 min |
| Classification PANNs CNN14 | 3h audio | 15 min |
| Extraction 100 segments MP3 | 48 MB | 8 min |
| Extraction 300 frames (ffmpeg seek) | 45 MB | 3 min (10 workers) |
| Chat Twitch GQL | 20-100 requetes | 5 min |
| Clip extraction (20 clips, stream copy) | 200 MB | 10-20 min |
| **Total elapsed** (avec parallelisme) | | **~90-150 min** |

> Le stream copy (ffmpeg -c copy) est 10x plus rapide que le re-encodage libx264. Le fallback yt-dlp + compression peut prendre 60-100 min de plus.

#### 2.5 Synthese cout par VOD

| Poste | Cout | % du total |
|---|---|---|
| Whisper (Groq) | $0.07 | 14% |
| LLM (Gemini 3 Flash) | $0.40 | 80% |
| Stockage R2 | $0.01 | 2% |
| Twitch/yt-dlp | $0.00 | 0% |
| Compute local (amorti) | ~$0.02 | 4% |
| **Total** | **~$0.50** | 100% |

**Fourchette : $0.40 (VOD courte/peu de chat) — $0.60 (VOD longue 6h+ avec chat dense)**

---

## 3. Cout par streamer par mois

| Profil | Streams/sem | VODs/mois | Cout API | Cout compute | Total |
|---|---|---|---|---|---|
| Casual | 2 | 8 | $4.00 | $0.16 | **$4.16** |
| Regulier | 4 | 16 | $8.00 | $0.32 | **$8.32** |
| Intensif | 5 | 20 | $10.00 | $0.40 | **$10.40** |
| Hardcore | 7 | 28 | $14.00 | $0.56 | **$14.56** |

> Le streamer "regulier" (4x/semaine) est le profil cible principal.

---

## 4. Cout infrastructure

### 4.1 Infrastructure recommandee (petit budget, production-ready)

| Composant | Solution | Specs | Cout/mois |
|---|---|---|---|
| **Worker Python** | Hetzner CX33 | 4 vCPU, 8 GB RAM, 80 GB SSD | **~$13** |
| **API AdonisJS** | Co-heberge sur le Worker | (ou CX23 separe : +$5) | **$0** |
| **Redis** | Upstash free tier | 256 MB, 500K cmd/mois | **$0** |
| **Stockage** | Cloudflare R2 | $0.015/GB, egress $0 | **variable** |
| **CDN** | Cloudflare | Gratuit avec R2 | **$0** |
| **Domaine** | | .com | **$1** |
| **Total fixe** | | | **~$14/mois** |

### 4.2 Stockage R2 variable

| Users actifs | VODs/mois total | Stockage cumule (6 mois) | Cout R2/mois |
|---|---|---|---|
| 10 | 160 | ~32 GB | $0.48 |
| 50 | 800 | ~160 GB | $2.40 |
| 200 | 3,200 | ~640 GB | $9.60 |
| 500 | 8,000 | ~1.6 TB | $24.00 |
| 1,000 | 16,000 | ~3.2 TB | $48.00 |

> Hypothese : 200 MB de clips par VOD, retention 6 mois.

### 4.3 Scaling de l'infrastructure

| Palier | Config serveur | Cout infra/mois |
|---|---|---|
| 1-50 users | 1x CX33 (API+Worker) | **~$15** |
| 50-200 users | CX33 (API) + CX43 Worker (8 vCPU, 16 GB) | **~$30** |
| 200-500 users | CX33 (API) + 2x CX43 Workers | **~$45** |
| 500-1000 users | CX33 (API) + 3-4x CX43 Workers + Upstash $10 | **~$70** |

> Chaque worker CX43 peut traiter ~10 VODs en parallele (bound par CPU/FFmpeg). A 20 VODs/jour moyen, un worker suffit pour ~100 users actifs.

### 4.4 Pourquoi PAS AWS

| | Hetzner + R2 | AWS (S3 + EC2 + ElastiCache) |
|---|---|---|
| Serveur (8 GB) | $13/mois | $60/mois (t3.large) |
| Redis | $0 (Upstash free) | $12/mois (ElastiCache) |
| Stockage 500 GB | $7.50/mois (R2) | $11.50/mois (S3) |
| Egress 1 TB/mois | **$0** (R2) | **$90** (S3) |
| **Total** | **~$21** | **~$174** |

L'egress S3 a $0.09/GB tue la rentabilite pour un service qui sert de la video. **R2 est non-negociable**.

---

## 5. Cout total par utilisateur actif

### Pour 50 utilisateurs actifs (palier initial)

| Poste | Cout/mois total | Cout/user/mois |
|---|---|---|
| Infra fixe | $15 | $0.30 |
| R2 stockage | $2.40 | $0.05 |
| API/IA (16 VODs/user moyen) | $400 | $8.00 |
| **Total** | **$417** | **$8.35** |

### Pour 200 utilisateurs actifs

| Poste | Cout/mois total | Cout/user/mois |
|---|---|---|
| Infra fixe | $30 | $0.15 |
| R2 stockage | $9.60 | $0.05 |
| API/IA (16 VODs/user moyen) | $1,600 | $8.00 |
| **Total** | **$1,640** | **$8.20** |

> Le cout est domine par les APIs IA (~96%). L'infra est negligeable. **Le cout marginal d'un user est quasi-lineaire a ~$8/mois.**

---

## 6. Analyse de la concurrence

### 6.1 Panorama des concurrents

#### Eklipse.gg — Leader Twitch

| Plan | Prix | Limite | Fonctionnalites cles |
|---|---|---|---|
| Free | $0 | 15 clips/stream, 720p, watermark, file lente | Editeur basique |
| Premium (mensuel) | $19.99/mois | 600 min credits | 1080p, sans watermark, prioritaire |
| Premium (annuel) | $12.50/mois | 7,200 min credits/an | Idem + Auto Edits, Montage Maker |

**Approche technique :** Detection d'events in-game (kills, victoires) pour 1,000+ jeux. Tres fiable sur FPS/BR, mais **rate completement les moments comediques, reactions, et hype chat** qui ne sont pas lies a un event de jeu.

**Points faibles :** Queue lente sur le free tier (jusqu'a 18h), templates mobile ne sync pas avec desktop.

#### Opus Clip — Leader general (podcast/talking-head)

| Plan | Prix | Credits | Fonctionnalites cles |
|---|---|---|---|
| Free | $0 | 60 min | Watermark, 3 jours d'acces |
| Starter | $15/mois | 150 min | Sans watermark, 1 template |
| Pro (mensuel) | $29/mois | 300 min | Social scheduling, 2 seats |
| Pro (annuel) | $14.50/mois | 3,600 min/an | Idem |

**Approche technique :** Analyse du speech uniquement. Identifie les "hooks" verbaux. **Tres faible sur le gaming** — ne detecte rien si le streamer est silencieux pendant un play.

**Taille :** Leader du marche en volume, mais gaming = use case secondaire.

#### StreamLadder — Conversion verticale + ClipGPT

| Plan | Prix | Fonctionnalites |
|---|---|---|
| Free | $0 | 720p/30fps, editeur basique |
| Silver | $9/mois | 1080p/60fps, sous-titres IA, stickers |
| Gold | $15/mois | Rendering background, scheduling |
| Gold + ClipGPT | $27/mois | Scan stream entier, ~10 clips auto |

**Approche :** ClipGPT scanne le stream mais limite a ~10 clips, sans analyse audio/chat profonde.

#### Choppity — Mid-market agressif

| Plan | Prix | Limite |
|---|---|---|
| Free | $0 | 30 min/mois |
| Starter (annuel) | $7.50/mois | 3h/mois, 40 GB stockage |
| Pro (annuel) | $14/mois | 5h/mois, 100 GB stockage |
| Enterprise | Custom | Illimite, API, whitelabel |

#### Spikes Studio — Generalist milieu de gamme

| Plan | Prix | Limite |
|---|---|---|
| Free | $0 | 30 min |
| PRO+ (annuel) | $14.09/mois | 3,600 min/an |
| Enterprise (annuel) | $56.34/mois | 14,400 min/an |

#### Sizzle.gg — Ultra budget, gaming pur

| Plan | Prix | Fonctionnalites |
|---|---|---|
| Free | $0 | Basique, file standard |
| Starter | $4.99/mois | Illimite, 1080p, prioritaire |

**Approche :** Detection d'events in-game uniquement (kills, headshots). Zero capacite d'analyse audio/chat.

#### 2short.ai — Budget YouTube

| Plan | Prix | Limite |
|---|---|---|
| Free | $0 | 30 min |
| Lite | $9.90/mois | 5h |
| Pro | $19.90/mois | 15h |
| Premium | $49.90/mois | 50h + priorite |

#### Munch — Premium agences

| Plan | Prix | Limite |
|---|---|---|
| Pro | $49/mois | 200 min |
| Elite | $116/mois | 500 min |
| Ultimate | $220/mois | 1,000 min |

### 6.2 Concurrents fermes (lecons)

| Outil | Fermeture | Cause | Lecon |
|---|---|---|---|
| **Powder.gg** | 2025 | "Raisons financieres" apres 7 ans | $99/an etait insuffisant pour couvrir le compute IA |
| **Athenascope** | Avril 2022 | Modele gratuit insoutenable | Gratuit + IA lourde = impossible |

### 6.3 Matrice de differentiation

| Signal | Cuttie | Eklipse | Opus Clip | StreamLadder | Sizzle |
|---|---|---|---|---|---|
| Twitch VOD natif | **Oui** | Oui | Non (upload) | Oui (ClipGPT) | Oui |
| Analyse audio (RMS, spectral, onset) | **Oui** | Non | Non | Non | Non |
| Classification audio (PANNs CNN14) | **Oui** | Non | Non | Non | Non |
| Analyse chat Twitch (sentiment, burst, emotes) | **Oui** | Non | Non | Non | Non |
| Vision (frames) | **Oui** | Non | Non | Non | Non |
| LLM scoring viralite | **Oui** | Non | Partiel (speech) | Basique | Non |
| Transcription + correction LLM | **Oui** | Non | Oui | Non | Non |
| Score composite multi-signal | **Oui** | Non | Non | Non | Non |

**Cuttie est le seul outil a croiser 5 sources de signaux** (audio spectral, classification audio, chat Twitch, vision, LLM) pour scorer la viralite. C'est un avantage technique reel et difficile a reproduire.

---

## 7. Analyse de marche

### 7.1 Taille du marche

| Metrique | Valeur |
|---|---|
| Streamers actifs mensuels (Twitch) | 7.3 millions |
| Twitch Partners | ~80,000 |
| Twitch Affiliates | ~2.9 millions |
| Total monetises (Affiliate+Partner) | ~2.98 millions |
| Viewers mensuels (Twitch) | 240 millions |
| Revenue Twitch 2024 | $1.8 milliard |

### 7.2 Segmentation par revenus streamers

| Segment | Population | Revenus Twitch/mois | Budget outils |
|---|---|---|---|
| Top 1% (elite) | ~30,000 | $30,000+ | $50-200/mois |
| Partners actifs | ~80,000 | $1,000-$30,000 | $20-50/mois |
| Top Affiliates | ~200,000 | $400-$5,000 | $10-30/mois |
| Affiliates reguliers | ~2.7 millions | $50-$400 | $0-15/mois |
| Non-monetises | ~4.4 millions | $0 | $0-5/mois |

### 7.3 Marche adressable

| Cible | Population | Prix moyen | TAM |
|---|---|---|---|
| Partners + top Affiliates | ~280,000 | $15/mois | ~$50M ARR |
| Tous Affiliates + Partners | ~2.98M | $10/mois | ~$358M ARR |
| Realiste (10% des monetises) | ~300,000 | $15/mois | **~$54M ARR** |

> Le TAM realiste partage entre tous les concurrents est de **~$50-100M ARR**. Un acteur capturant 1% du marche = $500K-1M ARR.

### 7.4 Tendances

- Le marche du live streaming croit a **19-23% CAGR** (projections 2025-2033)
- L'adoption d'outils IA par les createurs a augmente de **342% en glissement annuel** (2025)
- Le workflow "VOD → clips courts" est devenu **standard** pour les streamers serieux
- YouTube Shorts, TikTok et Instagram Reels recompensent algorithmiquement le contenu repurpose
- **Kick** et **YouTube Live** etendent le TAM de 40-60% au-dela de Twitch seul

### 7.5 Taux de conversion freemium

| Type de SaaS | Taux free→paid |
|---|---|
| Moyenne industrie SaaS | 3.7% |
| Consumer/EdTech | 2.6% |
| Outils createurs (estime) | 3-5% |
| Free trial (temps limite) | 10-25% |

> Avec un tier gratuit et 10,000 utilisateurs free, on peut esperer **300-500 abonnes payants** (3-5% conversion).

---

## 8. Proposition de plans tarifaires

### 8.1 Structure recommandee — 3 tiers

| | **Free** | **Creator** | **Pro** |
|---|---|---|---|
| **Prix mensuel** | $0 | **$14.99** | **$29.99** |
| **Prix annuel** | $0 | **$9.99/mois** ($119.88/an) | **$19.99/mois** ($239.88/an) |
| VODs par mois | 2 | 15 | 40 |
| Clips par VOD | 5 | 20 | 20 |
| Resolution | 720p | 1080p | 1080p |
| Watermark | Oui | Non | Non |
| Editeur Remotion | Apercu only | Complet | Complet + templates premium |
| Sous-titres | Non | Oui | Oui |
| File d'attente | Standard (delai) | Prioritaire | Instantanee |
| Export formats | MP4 | MP4 + GIF | MP4 + GIF |
| Retention clips | 7 jours | 30 jours | 90 jours |
| Support | Community | Email | Email prioritaire |
| API | Non | Non | Oui |

### 8.2 Justification des prix

**Free ($0) — Acquisition :**
- 2 VODs/mois x $0.50 = **$1.00/mois de cout** par user free actif
- Watermark = pub gratuite
- 5 clips/VOD (au lieu de 20) : pipeline tourne avec KEEP_TOP_N=5, reduit le cout LLM a ~$0.20/VOD
- Retention 7 jours = stockage R2 minimal
- **Cout reel : ~$0.40/mois par user free actif** (pipeline light)

**Creator ($14.99) — Coeur de cible :**
- 15 VODs/mois x $0.50 = **$7.50/mois de cout API**
- **Marge brute : $7.49 = 50%** (scenario max usage)
- Scenario moyen (10 VODs) : **marge 67%**
- $9.99 annuel : marge plus faible mais previsibilite + LTV superieure

**Pro ($29.99) — Power users & editeurs :**
- 40 VODs/mois x $0.50 = **$20/mois de cout API** (scenario max)
- **Marge brute : $9.99 = 33%** (scenario max)
- Scenario moyen (25 VODs) : **marge 58%**
- Cible : editeurs qui gerent plusieurs chaines, petites agences

### 8.3 Analyse de marge par scenario

#### Plan Creator ($14.99/mois)

| Usage | VODs/mois | Cout API | Marge brute | % marge |
|---|---|---|---|---|
| Light | 5 | $2.50 | $12.49 | **83%** |
| Moyen | 10 | $5.00 | $9.99 | **67%** |
| Regulier | 15 (cap) | $7.50 | $7.49 | **50%** |
| **Moyenne ponderee** | **~10** | **$5.00** | **$9.99** | **67%** |

#### Plan Pro ($29.99/mois)

| Usage | VODs/mois | Cout API | Marge brute | % marge |
|---|---|---|---|---|
| Light | 10 | $5.00 | $24.99 | **83%** |
| Moyen | 20 | $10.00 | $19.99 | **67%** |
| Intensif | 30 | $15.00 | $14.99 | **50%** |
| Max | 40 (cap) | $20.00 | $9.99 | **33%** |
| **Moyenne ponderee** | **~22** | **$11.00** | **$18.99** | **63%** |

---

## 9. Projections financieres

### 9.1 Scenario bootstrapped (12 mois)

Hypotheses :
- Lancement mois 1 avec 20 beta users (free)
- Croissance organique +30% users/mois
- Conversion free→paid : 4%
- Mix : 70% Creator / 30% Pro
- ARPU estime : $14.99 x 0.7 + $29.99 x 0.3 = **$19.49** (mensuel)

| Mois | Users free | Users payants | MRR | Cout API | Cout infra | Resultat net |
|---|---|---|---|---|---|---|
| 1 | 20 | 0 | $0 | $10 | $15 | **-$25** |
| 2 | 26 | 1 | $19 | $18 | $15 | **-$14** |
| 3 | 34 | 2 | $39 | $26 | $15 | **-$2** |
| 4 | 44 | 3 | $58 | $34 | $15 | **+$9** |
| 5 | 57 | 4 | $78 | $43 | $15 | **+$20** |
| 6 | 74 | 5 | $97 | $54 | $15 | **+$28** |
| 7 | 97 | 7 | $136 | $71 | $20 | **+$45** |
| 8 | 126 | 9 | $175 | $91 | $20 | **+$64** |
| 9 | 163 | 12 | $234 | $118 | $25 | **+$91** |
| 10 | 212 | 16 | $312 | $153 | $30 | **+$129** |
| 11 | 276 | 21 | $409 | $198 | $30 | **+$181** |
| 12 | 359 | 27 | $526 | $256 | $35 | **+$235** |

**Annee 1 totale :**
- MRR mois 12 : **~$526**
- ARR equivalent : **~$6,300**
- Total revenus annee 1 : **~$2,083**
- Total couts annee 1 : **~$1,343**
- **Resultat net annee 1 : ~+$740**

> Break-even atteint au **mois 4** avec seulement 3 abonnes payants.

### 9.2 Scenario accelere (Product Hunt + marketing)

Hypotheses :
- Launch Product Hunt mois 2 : +500 signups
- Conversion 5% (enthousiasme early adopter)
- Croissance +20%/mois apres le spike

| Mois | Users free | Users payants | MRR | Resultat net/mois |
|---|---|---|---|---|
| 1 | 50 | 0 | $0 | -$40 |
| 2 | 550 | 25 | $487 | +$180 |
| 3 | 660 | 33 | $643 | +$230 |
| 6 | 1,140 | 57 | $1,111 | +$370 |
| 12 | 2,840 | 142 | $2,767 | +$780 |

**MRR mois 12 : ~$2,767 / ARR ~$33K**

### 9.3 Seuils cles

| Seuil | Users payants | MRR | Signification |
|---|---|---|---|
| Break-even infra | 2 | $30 | Couvre les serveurs |
| Break-even total | 4 | $60 | Couvre infra + cout API free users |
| Revenu secondaire | 50 | $975 | ~$12K ARR |
| Micro-SaaS viable | 200 | $3,900 | ~$47K ARR |
| Rentable (1 fondateur) | 500 | $9,750 | ~$117K ARR |
| Scale-up | 1,000 | $19,500 | ~$234K ARR |

---

## 10. Optimisations possibles

### 10.1 Reduire le cout par VOD

| Optimisation | Impact | Complexite | Risque qualite |
|---|---|---|---|
| **Reduire candidats Whisper de 100 a 60** | -40% Whisper (-$0.03) | Faible | Moyen |
| **Reduire candidats LLM de 50 a 30** | -40% LLM (-$0.16) | Faible | Moyen |
| **4 frames au lieu de 6** | -10% LLM (-$0.01) | Trivial | Faible |
| **Supprimer l'audio du LLM** | -44% LLM (-$0.18) | Moyen | Eleve |
| **Modele LLM moins cher** (ex: Gemini Flash Lite) | -50% LLM | Faible | A tester |
| **Context caching** (OpenRouter cache hits 30-40%) | -15% LLM input | Gratuit | Aucun |
| **Whisper local** (whisper.cpp sur GPU) | -100% Whisper (-$0.07) | Eleve | Aucun |

**Scenario optimise (30 LLM + 60 Whisper) :**
- Whisper : 60 x 60s = 60 min = $0.04
- LLM : 30 x $0.008 = $0.24
- **Total : ~$0.30/VOD** (vs $0.50 actuellement, -40%)

### 10.2 Optimisations tier Free

Pour limiter le cout des users free :
- Pipeline light : KEEP_TOP_N=5, KEEP_NORMAL_FOR_LLM=15
- 15 Whisper + 15 LLM = ~$0.13/VOD (vs $0.50 pour le pipeline complet)
- 2 VODs/mois max = **$0.26/mois par user free**

### 10.3 Retention / suppression auto

- Free : clips supprimes apres 7 jours → stockage quasi-nul
- Creator : 30 jours → ~200 MB x 15 x 1 mois = 3 GB max
- Pro : 90 jours → ~200 MB x 40 x 3 mois = 24 GB max
- Politique de suppression auto = controle du cout R2

---

## 11. Risques

### 11.1 Risques techniques

| Risque | Probabilite | Impact | Mitigation |
|---|---|---|---|
| **Twitch bloque yt-dlp** | Moyenne | Critique — tout le produit | Upload direct, API Twitch officielle |
| **Groq augmente ses prix** | Faible | Modere (14% du cout) | Switch whisper.cpp local |
| **OpenRouter/Gemini augmente ses prix** | Moyenne | Eleve (80% du cout) | Switch modele (Llama, Claude Haiku) |
| **Rate limiting Groq/OpenRouter** | Moyenne | Modere | Queue/retry, augmenter workers |
| **PANNs CNN14 trop lent sur CPU** | Faible | Faible | GPU VPS (+$20/mois) |

### 11.2 Risques business

| Risque | Probabilite | Impact | Mitigation |
|---|---|---|---|
| **User hardcore abuse (40 VODs/mois)** | Moyenne | Marge negative sur Pro | Cap dur a 40, ou tarification par VOD au-dela |
| **Faible conversion free→paid** | Moyenne | Croissance lente | Free trial 14j au lieu de tier gratuit permanent |
| **Concurrent lance multi-signal** | Faible | Perte du moat | Execution rapide, communaute, UX |
| **Twitch decline / fragmentation** | Moyenne | TAM reduit | Support multi-plateforme (Kick, YouTube) |

### 11.3 Dependance yt-dlp

C'est le risque #1. Le business depend entierement de la capacite a telecharger les VODs Twitch via yt-dlp.

**Plans de contingence :**
1. **Upload direct** : le streamer upload sa VOD → plus de dependance yt-dlp (mais friction UX)
2. **API Twitch** : endpoint officiel de telechargement VOD (limite, authentification requise)
3. **Extension navigateur** : capture cote client
4. **Integration OBS** : enregistrement local simultane

> Recommandation : developper l'upload direct comme alternative des le debut, avant que yt-dlp soit potentiellement bloque.

---

## 12. Verdict

### Le projet est-il viable ?

| Question | Reponse |
|---|---|
| Cout par VOD tenable ? | **Oui** — $0.50/VOD avec Groq + Gemini Flash |
| Marge suffisante ? | **Oui** — 50-83% sur Creator, 33-83% sur Pro |
| Prix alignes avec le marche ? | **Oui** — $14.99 = sweet spot du marche |
| Differentiation reelle ? | **Oui** — seul outil multi-signal (audio+chat+vision+LLM) |
| Scalabilite ? | **Oui** — infra lineaire, pas de GPU requis |
| Risque principal ? | **Dependance yt-dlp** — mitigable avec upload direct |
| Break-even ? | **4 abonnes payants** — atteignable en 1-2 mois |

### Recommandations prioritaires

1. **Lancer avec Creator a $14.99/mois + Free tier limite** (2 VODs, 5 clips, watermark)
2. **Developper l'upload direct** comme alternative a yt-dlp
3. **Implementer le pipeline light** pour le Free tier (15 LLM au lieu de 50)
4. **Utiliser Cloudflare R2** des le jour 1 (pas S3)
5. **Cibler les Partners et top Affiliates** (80K-280K streamers) qui ont le budget
6. **Mesurer le cout reel par VOD** en production pour affiner les projections
7. **Ajouter le support Kick/YouTube Live** pour etendre le TAM

### En une phrase

**A $0.50/VOD de cout IA, un pricing a $14.99-29.99/mois, et un avantage technique reel que personne n'a, Cuttie est financierement viable avec un break-even a 4 abonnes. Le risque principal n'est pas le cout — c'est la dependance a yt-dlp.**

---

## Annexes

### A. Sources de prix (avril 2026)

| Service | Prix | Source |
|---|---|---|
| Groq Whisper large-v3-turbo | $0.04/heure audio | [groq.com/pricing](https://groq.com/pricing/) |
| Gemini 3 Flash Preview (OpenRouter) | $0.50/M input, $1.00/M audio, $3.00/M output | [openrouter.ai](https://openrouter.ai/google/gemini-3-flash-preview) |
| Cloudflare R2 | $0.015/GB stockage, $0 egress | [developers.cloudflare.com/r2/pricing](https://developers.cloudflare.com/r2/pricing/) |
| Hetzner CX33 | ~$13/mois (4 vCPU, 8 GB) | [hetzner.com/cloud](https://www.hetzner.com/cloud/) |
| Upstash Redis | Free tier 500K cmd/mois | [upstash.com/pricing/redis](https://upstash.com/pricing/redis) |

### B. Parametres du pipeline (code source)

| Parametre | Valeur | Fichier |
|---|---|---|
| Candidats heuristiques | 100 | `scorer.py` |
| Candidats Whisper | 100 (tous) | `llm_analyzer.py:662` |
| Candidats LLM | 50 (KEEP_NORMAL_FOR_LLM) | `llm_analyzer.py:44` |
| Candidats finaux | 20 (KEEP_TOP_N) | `llm_analyzer.py:43` |
| Frames par candidat | 6 (NUM_FRAMES) | `frame_extractor.py:17` |
| Duree clip | 45-90s (CLIP_HALF_DURATION=30) | `clipper.py:65-66` |
| Audio MP3 | 64 kbps | `llm_analyzer.py:67` |
| Workers Whisper | 5 | `llm_analyzer.py:42` |
| Workers LLM | 5 | `llm_analyzer.py:41` |
| Workers frames | 10 | `llm_analyzer.py:713` |
| Poids heuristique | 0.2 | `llm_analyzer.py:39` |
| Poids LLM | 0.8 | `llm_analyzer.py:40` |

### C. Concurrents — grille de prix

| Concurrent | Free | Tier 1 | Tier 2 | Tier 3 | Annuel min |
|---|---|---|---|---|---|
| Eklipse.gg | 15 clips/stream | $19.99/mo | - | - | $12.50/mo |
| Opus Clip | 60 min | $15/mo | $29/mo | Custom | $14.50/mo |
| StreamLadder | Basique | $9/mo | $15/mo | $27/mo | ~$7.20/mo |
| Choppity | 30 min | $15/mo | $28/mo | Custom | $7.50/mo |
| Spikes Studio | 30 min | $32.99/mo | $115.99/mo | - | $14.09/mo |
| Sizzle.gg | Basique | $4.99/mo | - | - | $4.99/mo |
| 2short.ai | 30 min | $9.90/mo | $19.90/mo | $49.90/mo | - |
| Munch | - | $49/mo | $116/mo | $220/mo | - |
| **Cuttie (propose)** | **2 VODs** | **$14.99/mo** | **$29.99/mo** | **-** | **$9.99/mo** |
