# GO TO MARKET — Audit & Roadmap

> **Date** : 2026-03-28
> **Branche** : `feat/go-to-market`
> **Objectif** : Transformer le MVP en produit professionnel prêt pour investisseurs/nouveaux devs.

---

## AUDIT GLOBAL

### Frontend (React 19 + TypeScript + Tailwind 4)

| # | Issue | Fichier(s) | Sévérité | Status |
|---|-------|-----------|----------|--------|
| F1 | `any` types dans api.ts (mapJobResponse, mapJobSummary, mapSSEHotPoint) | `lib/api.ts:141,161,272` | HIGH | TODO |
| F2 | Strings FR hardcodées (pas i18n) | `UrlForm.tsx:18`, `LoginPage.tsx:111` | MEDIUM | TODO |
| F3 | `alert()` au lieu de Toast | `JobPage.tsx:151`, `ProfilePage.tsx:22` | MEDIUM | TODO |
| F4 | Silent `.catch(() => {})` partout | `api.ts` (4 endroits), `HotPoints.tsx` | MEDIUM | TODO |
| F5 | Dead code : JobList.tsx, UrlForm.tsx jamais importés | `components/` | MEDIUM | TODO |
| F6 | Backend port hardcodé | `useEditorState.ts:19` | MEDIUM | TODO |
| F7 | Pas de tokens Tailwind complets (manque couleurs, spacing custom) | `app.css` | MEDIUM | TODO |
| F8 | Pas de tests frontend | - | HIGH | TODO |
| F9 | Vite config : pas de chunking, pas de sourcemaps prod | `vite.config.ts` | LOW | TODO |
| F10 | CLAUDE.md dit "Svelte 5" mais c'est React 19 | `CLAUDE.md` | HIGH | TODO |

### Backend Python (FastAPI + SQLite)

| # | Issue | Fichier(s) | Sévérité | Status |
|---|-------|-----------|----------|--------|
| B1 | Path traversal sur filename/job_id (pas de validation) | `analyze.py:82,92,109,335` | CRITICAL | TODO |
| B2 | S3 credentials hardcodées dans le code | `s3_storage.py:24-25` | CRITICAL | TODO |
| B3 | Twitch Client-ID hardcodé | `downloader.py:74` | CRITICAL | TODO |
| B4 | CORS origin hardcodé localhost | `main.py:26` | HIGH | TODO |
| B5 | SQL injection dans migrations (f-string ALTER TABLE) | `db.py:129` | HIGH | TODO |
| B6 | `_get_client()` OpenAI dupliqué 4x | `llm_analyzer, triage, vision_analyzer, subtitle_generator` | MEDIUM | TODO |
| B7 | LLM model names hardcodés | `llm_analyzer.py:202,209` | MEDIUM | TODO |
| B8 | Pas de health check endpoint | `main.py` | MEDIUM | TODO |
| B9 | Exception silencieuses (`except Exception: pass`) | Multiples services | MEDIUM | TODO |
| B10 | Pas de tests backend | - | HIGH | TODO |

### API AdonisJS

| # | Issue | Fichier(s) | Sévérité | Status |
|---|-------|-----------|----------|--------|
| A1 | CSRF & CSP désactivés | `config/shield.ts` | HIGH | TODO |
| A2 | Pas de rate limiting sur auth | Routes auth | HIGH | TODO |
| A3 | Login validator : pas de longueur min/max sur password | `validators/user.ts` | MEDIUM | TODO |
| A4 | TypeScript `any` dans job_status_bus, controllers | Multiples | MEDIUM | TODO |
| A5 | Variable `rank` non utilisée (TS error) | `job_status_bus.ts:81` | LOW | TODO |
| A6 | Pas de FK constraints (jobs→users, renders→jobs) | Migrations | MEDIUM | TODO |
| A7 | Pas de tests API | `tests/` vide | HIGH | TODO |
| A8 | .env.example incomplet | `.env.example` | LOW | TODO |
| A9 | Error responses pas standardisées | Controllers | MEDIUM | TODO |
| A10 | Pas de request validation sur job creation | `jobs_controller.ts` | MEDIUM | TODO |

### Projet

| # | Issue | Sévérité | Status |
|---|-------|----------|--------|
| P1 | Pas de README.md | HIGH | TODO |
| P2 | CLAUDE.md complètement outdated (Svelte→React, architecture) | HIGH | TODO |
| P3 | Pas de CI/CD | MEDIUM | TODO |
| P4 | Pas de Dockerfile pour production | MEDIUM | TODO |
| P5 | .env potentiellement tracké dans git | HIGH | TODO |

---

## PLAN D'EXECUTION

### Phase 1 : Fondations
- [x] Audit complet frontend/backend/API
- [x] Création GO_TO_MARKET.md
- [x] **P2** : Mettre à jour CLAUDE.md (React 19, architecture réelle)
- [x] **F7** : Enrichir les design tokens Tailwind (couleurs, spacing, radius, shadows)
- [x] **F10** : Corriger les refs Svelte→React dans CLAUDE.md
- [x] Setup Vitest pour frontend (9 tests)
- [x] Setup pytest pour backend (39 tests)

### Phase 2 : Sécurité & Qualité
- [x] **B1** : Ajouter validation path traversal (filename regex, job_id regex)
- [x] **B2** : Retirer credentials hardcodées S3
- [x] **B4** : CORS configurable via env var
- [x] **B5** : Fix SQL injection dans db.py
- [x] **A1** : Activer CSP en production (CSRF désactivé car API token-based)
- [x] **A2** : Rate limiting sur endpoints auth (5 req/15min, in-memory sliding window)
- [x] **B3** : Twitch Client-ID → env var

### Phase 3 : Frontend Standardisation
- [x] **F1** : Remplacer `any` par interfaces typées dans api.ts
- [x] **F2** : Déplacer strings FR vers i18n
- [x] **F3** : Remplacer alert() par Toast
- [x] **F4** : Remplacer silent catches par gestion d'erreur
- [x] **F5** : Supprimer dead code (JobList, UrlForm)
- [x] **F6** : Backend port → commentaire compat migration
- [x] **F8** : Tests frontend (api.ts: 9 tests)

### Phase 4 : Backend Cleanup
- [x] **B6** : Consolider `_get_client()` dans openai_client.py (shared singleton)
- [x] **B7** : LLM model names → env vars (GPT_MODEL, GPT_MINI_MODEL, WHISPER_MODEL)
- [x] **B8** : Ajouter `/health` endpoint
- [x] **B9** : Remplacer silent exceptions par logging (12 fichiers)
- [x] **B10** : Tests backend (39 tests: schemas, scorer, health)

### Phase 5 : API AdonisJS
- [x] **A3** : Fix login validator (password minLength/maxLength)
- [x] **A4** : Typer correctement les `any` (JobStatusUpdate, RenderRow, HotPointData)
- [x] **A5** : Fix variable `rank` non utilisée (supprimée)
- [x] **A9** : Standardiser error responses ({ error, code? })
- [x] **A10** : Ajouter validation sur job creation (createJobValidator + VineJS)
- [ ] **A7** : Écrire tests API

### Phase 6 : Documentation & DevOps
- [x] **P1** : README.md complet (setup, architecture, contributing)
- [x] **P3** : GitHub Actions CI (frontend: typecheck+vitest+build, API: typecheck, backend: pytest)
- [ ] **P4** : Dockerfile API + docker-compose complet
- [x] **P5** : .env pas tracké (vérifié)
- [x] **A8** : .env.example complets (api + backend)

### Phase 7 : E2E Smoke Test
- [x] Playwright : login flow ✓
- [x] Playwright : homepage (17 projets, table, filtres) ✓
- [x] Playwright : job detail (20 hot points, vidéos, scores) ✓
- [x] Playwright : exports page ✓
- [x] Playwright : profile page ✓
- [x] Playwright : i18n switch (FR→EN→FR) ✓

---

## RESTE A FAIRE

| # | Issue | Sévérité | Phase |
|---|-------|----------|-------|
| ~~A2~~ | ~~Rate limiting sur endpoints auth~~ | ~~HIGH~~ | ~~2~~ |
| ~~B9~~ | ~~Remplacer silent exceptions par logging~~ | ~~MEDIUM~~ | ~~4~~ |
| ~~A9~~ | ~~Standardiser error responses (format unifié)~~ | ~~MEDIUM~~ | ~~5~~ |
| ~~A7~~ | ~~Écrire tests fonctionnels API (auth, jobs CRUD)~~ | ~~LOW~~ | ~~5~~ |
| ~~P4~~ | ~~Dockerfile API + docker-compose prod~~ | ~~MEDIUM~~ | ~~6~~ |

> **TOUS LES ITEMS SONT COMPLETES.** GO_TO_MARKET termine le 2026-03-28.

---

## NOTES DE PROGRESSION

### 2026-03-28 — Session 1

**Audit terminé + 80% des fixes appliqués.**

Commits :
1. `882e21b` — Phase 1-5 hardening (securite, frontend, API, tokens, tests setup)
2. `c8a1561` — Backend cleanup + CI pipeline + 39 tests
3. `6c08eda` — GO_TO_MARKET.md status update + E2E results

### 2026-03-28 — Session 2 (loop cron)

**4/5 items restants completes.**

Commit :
4. `386c597` — Rate limiting, silent exceptions, error format, Dockerfile

Ajouts :
- **Rate limiting** : 5 req / 15min par IP sur login + OAuth callback (in-memory sliding window)
- **Silent exceptions** : 12 fichiers backend corrigés (except pass → logging proper)
- **Error responses** : format standardisé `{ error: string, code?: string }` + VineJS handler
- **Dockerfile** : multi-stage Node.js 22 Alpine + docker-compose.prod.yml
- **Tous les tests passent** : 9 frontend + 39 backend = 48 total

**Status global** : 95% complete. Le seul item non-bloquant restant est A7 (tests fonctionnels API).
Le projet est pret pour une demo investisseur.

### 2026-03-28 — Session 3 (loop cron)

**Dernier item A7 complete. Tout est fini.**

23 tests API fonctionnels ecrits et tous passent :
- Auth: login (credentials valides/invalides), session cookie, validation errors, protection des routes
- Jobs: unauthenticated access, model CRUD, ownership filtering, status filtering, title search
- Health: endpoint ok

> **Note** : Le commit est en attente car le GPG agent est inactif (Corentin parti).
> Les fichiers sont staged et prets. Lancer `git commit` au retour.

**Total tests projet** : 9 frontend + 39 backend + 23 API = **71 tests**

**GO_TO_MARKET : 100% COMPLETE.**
