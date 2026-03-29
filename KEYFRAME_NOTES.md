# Keyframe System — Work Notes

## Bug principal
Quand un keyframe existe, le drag du layer ne fait rien visuellement car le render
utilise les valeurs du keyframe snapshot (`resolveKeyframes()`) au lieu de `layer.transform`.
L'utilisateur déplace "à l'aveugle".

**Fix** : quand `updateTransform` / `updateStyle` est appelé et qu'un keyframe existe
au `currentTime`, auto-update le snapshot du keyframe avec les nouvelles valeurs.
Comme ça le drag met à jour à la fois `layer.transform` ET le keyframe.

## TODO
- [x] Fix: auto-update keyframe snapshot quand on drag/edit un layer
- [x] AnimationsPanel: afficher les keyframes snapshots (liste, timestamp, clickable)
- [x] AnimationsPanel: cliquer sur un keyframe → seek vers sa position
- [x] AnimationsPanel: bouton supprimer par keyframe
- [x] Diamond header: s'allume quand le playhead est sur/près d'un keyframe
- [x] Diamond header: toggle (re-clic supprime le keyframe)
- [ ] Commit à chaque étape

## Architecture
- `KeyframeSnapshot` : { id, time, easing, x, y, width, height, rotation, opacity, scale }
- `Layer.keyframes?: KeyframeSnapshot[]` (sorted by time)
- `resolveKeyframes(snapshots, time)` → interpolates between surrounding snapshots
- `addKeyframe(layerId)` → captures current transform+style into snapshot
- `toggleKeyframe(layerId)` → add or remove at current time
