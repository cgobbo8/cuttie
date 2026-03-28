# NOTES — Session de nuit (2026-03-26)

Oublie pas de commit entre chaque etape

## Taches

### 1. [FAIT] Fix facecam crop sur job b2a262eeb8ba
- Probleme : faces de PNJ du jeu polluaient la detection (clip_03 : face au centre de l'ecran)
- Solution : filtrage outlier — median des positions de face sur tous les clips, exclusion des faces trop eloignees (>2x largeur face)
- Aussi : construction de la carte d'edges persistantes uniquement a partir des clips "bons"
- Commit : d98736e

### 2. [FAIT] Reprocess les clips verticaux du job b2a262eeb8ba
- Batch 1 (3 workers, timeout 120s) : 11/20 OK, 9 timeouts (03,06,07,08,09,12,18,19,20)
- Batch 2 (sequentiel, timeout 300s) : 6/6 OK (03,06,07,08,09,12)
- Batch 3 (sequentiel, timeout 300s) : 3/3 OK (18,19,20)
- Resultat : 20/20 clips verticaux valides

### 3. [FAIT] Optimisation des performances
- Restructure vertical clips en 2 phases :
  - Phase 1 : Whisper + LLM rewrite + ASS (5 workers API-bound)
  - Phase 2 : FFmpeg rendu (3 workers CPU-bound)
  - Avant : 2 workers faisaient tout sequentiellement
- FFmpeg preset : fast -> veryfast
- FFmpeg timeout : 120s -> 300s
- Commit : f14cd12

## Log

- 01:05 — Investigation facecam crop : faces de PNJ polluent la detection
- 01:10 — Fix : filtrage outlier des faces + edge map des bons clips seulement
- 01:15 — Test visuel OK sur clip_03 du nouveau job
- 01:20 — Commit fix + lancement reprocess batch 1 (3 workers)
- 01:30 — Batch 1 : 9 timeouts (120s trop court), relance batch 2 sequentiel (300s)
- 01:35 — Restructuration vertical clips en 2 phases + preset veryfast
- 01:40 — Commit perf, attente batch 2
- ~02:00 — Batch 2 termine : 6/6 OK (03,06,07,08,09,12)
- ~02:10 — Batch 3 (18,19,20) : 3/3 OK
- ~02:15 — Verification finale : 20/20 clips verticaux valides

## Statut final

Tout est fait. Les 20 clips verticaux du job b2a262eeb8ba sont valides et prets.
