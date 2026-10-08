# Banc d'essai du choix des clips

Compare des versions de la pipeline et des modèles LLM sur de vraies VODs de Falkarst, sans toucher à l'app : chaque run a son propre dossier de données (`.data/bench/…`, ignoré par git), aucun projet n'apparaît dans Cuttie et aucun clip n'est découpé.

## Vérité terrain

- **Clips viewers** (automatique) : les clips que des viewers ont faits sur la VOD, récupérés sur Twitch. Un système « trouve » un clip viewer si l'un de ses choix en couvre au moins la moitié. Peu nombreux (≈ 1 à 4 par VOD) mais indépendants de nous.
- **Notes humaines** (optionnel, le plus fiable) : `.data/bench/labels/<vod>.json` = `{"<début>-<fin>": "good" | "meh" | "bad"}` en secondes de VOD. Ajoute la précision des choix.

## Commandes (depuis `backend/`)

```bash
# 1. Une version de la pipeline sur une VOD (enregistre ce que le LLM a vu pour chaque extrait)
uv run python -m bench.run_pipeline --version now --vod 2886567499
uv run python -m bench.run_pipeline --version before --vod 2886567499        # code d'avant les corrections (58d74af)
uv run python -m bench.run_pipeline --version now --vod 2886567499 --label run2  # mesure le hasard du LLM

# 2. Un autre modèle, sur exactement les mêmes extraits (même prompt, audio, images)
uv run python -m bench.replay --model google/gemini-3.8-flash --vod 2886567499 --budget 1.5

# 3. Le rapport
uv run python -m bench.report
```

## Ce que mesure le rapport

| Colonne | Sens |
|---|---|
| viewer clips found | clips viewers couverts par les 20 choix (+ demandes « clip » confirmées) |
| mean rank | rang moyen de l'extrait qui couvre un clip viewer, parmi les ~50 notés |
| cost/VOD | coût réel OpenRouter (comptabilité d'usage) |
| failed | réponses manquantes ou JSON invalide |
| spread | écart-type des notes de viralité : un modèle qui note tout 0,65 ne départage rien |
| top-20 overlap | choix communs avec le modèle actuel |

La ligne `ceiling (all candidates)` dit ce que les ~50 extraits notés couvrent au mieux : un modèle ne peut que les réordonner.
