# Suivi de travail — Cuttie Editor

## En cours

_(rien en cours)_

## Fait (session 2)

- [x] Refacto AI Panel : SSE artisanal → Vercel AI SDK natif (`useChat` + `pipeUIMessageStreamToResponse`)
- [x] Backend : `convertToModelMessages` + `createUIMessageStream` + `toUIMessageStream()`
- [x] Frontend : `useChat` + `onToolCall` + `addToolOutput` + `DefaultChatTransport` avec body dynamique
- [x] Système Access Control : permissions booléennes + quotas numériques
- [x] Migration `user_permissions` + `user_quotas`
- [x] Service `AccessControlService` (`can()` + `checkQuota()`) avec wildcards (`*`, `domain:*`)
- [x] Middleware `access('editor-ai:write')` sur les routes
- [x] Seeder admin avec permission `*`
- [x] `/auth/me` retourne permissions + quotas
- [x] Hook frontend `useAccess()` + `useQuota()`
- [x] Gate AI panel derrière `editor-ai:write` (back + front)

## Fait (session 1)

- [x] Fix drag bug : auto-update keyframe snapshot quand on drag
- [x] Auto-create keyframe quand drag à un temps sans keyframe (auto-key)
- [x] Fix bounding box décalée des handles (transform résolu)
- [x] Fix click-after-drag qui sélectionne le mauvais layer
- [x] AnimationsPanel : liste des keyframes, seek, delete
- [x] AnimationsPanel : easing picker entre keyframes
- [x] borderRadius et blur keyframables
- [x] Diamants Lucide (remplacement SVG custom croppés)
- [x] Tolérance keyframe augmentée (KF_TOLERANCE = 0.15s)
- [x] Commit `9790ab8`
- [x] Keyframes dans l'export Remotion (`api/remotion/animations.ts`, `CuttieComposition.tsx`)
- [x] `resolveKeyframes` server-side (miroir du frontend)
- [x] `borderRadius`, `blur`, `opacity` résolus dans l'export
- [x] Commit `98fc9a5`
- [x] Panel AI (`AiPanel.tsx`) — chat streaming SSE avec 15 tools
- [x] Endpoint API `POST /api/ai/editor/chat` (AdonisJS + Vercel AI SDK v6)
- [x] Onglet "AI" dans RemotionEditor avec icône Bot
- [x] 50 tests Vitest pour le système de keyframes (`animations.test.ts`)
- [x] Commit `ba25596`

## Notes

- `KF_TOLERANCE = 0.15` (150ms) — constante centralisée dans `animations.ts`
- L'export Remotion utilise des compositions dans `api/remotion/` qui doivent être synchronisées avec le frontend
- Le scale dans KeyframeSnapshot est toujours à 1, pas encore utilisé dans le render
- AI SDK v6 : `createOpenAI()` au lieu de `openai()`, `inputSchema` au lieu de `parameters`, pas de `maxSteps`, pas de `toDataStream()`
- Les tools AI sont exécutés côté client (pas de `execute` server-side), le LLM émet des tool-calls via SSE
- Pour tester l'AI panel, le serveur API doit tourner avec `OPENAI_API_KEY` configuré dans `api/.env`
- Convention permissions : `domaine:action` (ex: `editor-ai:write`, `clips:read`)
- Wildcards : `*` (tout), `domaine:*` (tout le domaine)
- `editor-ai` = IA dans l'éditeur, `ai` = IA globale (futur)
- Quotas : comptent les rows en DB directement (pas de consume/decrement)
