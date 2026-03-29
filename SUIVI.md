# Suivi de travail — Cuttie Editor

## En cours

### 1. Keyframes dans l'export Remotion
- [ ] Identifier les compositions Remotion server-side (`api/remotion/`)
- [ ] Ajouter `resolveKeyframes` dans le rendu des layers export
- [ ] Vérifier que `borderRadius`, `blur`, `opacity` sont aussi résolus
- [ ] Commit

### 2. Panel AI (Vercel AI SDK)
- [ ] Installer Vercel AI SDK (`ai` + `@ai-sdk/openai`) dans le frontend
- [ ] Créer un endpoint API pour le chat (AdonisJS ou route frontend)
- [ ] Créer le composant `AiPanel.tsx` (onglet droit dans l'éditeur)
- [ ] Définir les tools AI :
  - `move_layer` — déplacer un layer (x, y)
  - `resize_layer` — redimensionner (width, height)
  - `set_opacity` — changer l'opacité
  - `set_blur` — changer le flou
  - `set_border_radius` — changer les bords arrondis
  - `set_rotation` — changer la rotation
  - `add_keyframe` — ajouter un keyframe à un temps donné
  - `remove_keyframe` — supprimer un keyframe
  - `set_trim` — ajuster le trim (start, end)
  - `add_animation` — ajouter une animation (entrée/sortie)
  - `remove_animation` — supprimer une animation
  - `select_layer` — sélectionner un layer
  - `list_layers` — lister les layers avec leurs propriétés
  - `add_layer` — ajouter un layer (shape, text)
  - `remove_layer` — supprimer un layer
- [ ] Wiring dans RemotionEditor (nouvel onglet "AI" à droite)
- [ ] Commit

## Fait (session courante)

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

## Notes

- `KF_TOLERANCE = 0.15` (150ms) — constante centralisée dans `animations.ts`
- L'export Remotion utilise des compositions dans `api/remotion/` qui doivent être synchronisées avec le frontend
- Le scale dans KeyframeSnapshot est toujours à 1, pas encore utilisé dans le render
