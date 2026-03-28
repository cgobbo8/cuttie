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

### Phase 1 : Fondations (en cours)
- [x] Audit complet frontend/backend/API
- [x] Création GO_TO_MARKET.md
- [ ] **P2** : Mettre à jour CLAUDE.md (React 19, architecture réelle)
- [ ] **F7** : Enrichir les design tokens Tailwind (couleurs, spacing, radius, shadows)
- [ ] **F10** : Corriger les refs Svelte→React dans CLAUDE.md
- [ ] Setup Vitest pour frontend
- [ ] Setup Vitest/pytest pour backend

### Phase 2 : Sécurité & Qualité
- [ ] **B1** : Ajouter validation path traversal (filename regex, job_id regex)
- [ ] **B2** : Retirer credentials hardcodées S3
- [ ] **B4** : CORS configurable via env var
- [ ] **B5** : Fix SQL injection dans db.py
- [ ] **A1** : Activer CSRF/CSP en production
- [ ] **A2** : Rate limiting sur endpoints auth
- [ ] **B3** : Twitch Client-ID → env var

### Phase 3 : Frontend Standardisation
- [ ] **F1** : Remplacer `any` par interfaces typées dans api.ts
- [ ] **F2** : Déplacer strings FR vers i18n
- [ ] **F3** : Remplacer alert() par Toast
- [ ] **F4** : Remplacer silent catches par gestion d'erreur
- [ ] **F5** : Supprimer dead code (JobList, UrlForm)
- [ ] **F6** : Backend port → env var
- [ ] **F8** : Écrire tests frontend (api.ts, hooks, composants clés)

### Phase 4 : Backend Cleanup
- [ ] **B6** : Consolider `_get_client()` dans un module shared
- [ ] **B7** : LLM model names → env vars
- [ ] **B8** : Ajouter `/health` endpoint
- [ ] **B9** : Remplacer silent exceptions par logging
- [ ] **B10** : Écrire tests backend (routes, services critiques)

### Phase 5 : API AdonisJS
- [ ] **A3** : Fix login validator
- [ ] **A4** : Typer correctement les `any`
- [ ] **A5** : Fix variable `rank` non utilisée
- [ ] **A9** : Standardiser error responses
- [ ] **A10** : Ajouter validation sur job creation
- [ ] **A7** : Écrire tests API

### Phase 6 : Documentation & DevOps
- [ ] **P1** : README.md complet (setup, architecture, contributing)
- [ ] **P3** : GitHub Actions CI (lint, typecheck, tests)
- [ ] **P4** : Dockerfile API + docker-compose complet
- [ ] **P5** : Vérifier .env pas tracké
- [ ] **A8** : Compléter .env.example

---

## NOTES DE PROGRESSION

### 2026-03-28

**Audit terminé.** Résumé :
- **3 issues CRITICAL** (path traversal, credentials hardcodées, Twitch client-ID)
- **10 issues HIGH** (sécurité, tests, documentation)
- **20+ issues MEDIUM** (standardisation, qualité code)
- Le CLAUDE.md est complètement faux (Svelte vs React)
- Aucun test nulle part
- Frontend plutôt propre architecturalement, juste besoin de standardiser
- Backend fonctionnel mais plusieurs failles de sécurité

Début des travaux Phase 1...
