/**
 * Pure animation functions — shared between:
 *   - NativePreviewViewport (preview, currentTime from native <video>)
 *   - CuttieComposition    (export, currentTime = frame / fps from Remotion)
 *
 * Never import Remotion here. Keep this framework-agnostic.
 */

import type { LayerStyle } from "./editorTypes";

/**
 * Compute the effective opacity of a layer at a given point in time,
 * applying fadeIn and fadeOut curves.
 */
export function animatedOpacity(
  style: LayerStyle,
  currentTime: number,
  duration: number,
): number {
  let opacity = style.opacity;

  if (style.fadeIn > 0 && currentTime < style.fadeIn) {
    opacity *= currentTime / style.fadeIn;
  }
  if (style.fadeOut > 0 && duration > 0 && currentTime > duration - style.fadeOut) {
    opacity *= Math.max(0, (duration - currentTime) / style.fadeOut);
  }

  return Math.max(0, opacity);
}
