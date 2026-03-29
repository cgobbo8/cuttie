/**
 * Animation engine — shared between preview and Remotion render.
 * Never import framework-specific code here.
 */

import type { Layer, LayerAnimation, AnimationType, AnimationCategory, EasingPreset, KeyframeSnapshot, KeyframableProperty } from "./editorTypes";

/* ── Easing functions ────────────────────────────────────── */

const PI = Math.PI;

export const EASING_FUNCTIONS: Record<EasingPreset, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  "easeIn.power3": (t) => t * t * t,
  "easeOut.power3": (t) => 1 - (1 - t) ** 3,
  "easeInOut.power3": (t) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  "easeIn.power4": (t) => t * t * t * t,
  "easeOut.power4": (t) => 1 - (1 - t) ** 4,
  "easeInOut.power4": (t) => t < 0.5 ? 8 * t * t * t * t : 1 - (-2 * t + 2) ** 4 / 2,
  bounce: (t) => {
    const n = 7.5625;
    const d = 2.75;
    let x = t;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
    if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
    x -= 2.625 / d;
    return n * x * x + 0.984375;
  },
  elastic: (t) => {
    if (t === 0 || t === 1) return t;
    return -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * (2 * PI) / 3);
  },
};

export const EASING_LABELS: Record<EasingPreset, string> = {
  linear: "Linéaire",
  easeIn: "Ease In",
  easeOut: "Ease Out",
  easeInOut: "Ease In-Out",
  "easeIn.power3": "Ease In (Power 3)",
  "easeOut.power3": "Ease Out (Power 3)",
  "easeInOut.power3": "Ease In-Out (Power 3)",
  "easeIn.power4": "Ease In (Power 4)",
  "easeOut.power4": "Ease Out (Power 4)",
  "easeInOut.power4": "Ease In-Out (Power 4)",
  bounce: "Bounce",
  elastic: "Elastic",
};

export function applyEasing(preset: EasingPreset, t: number): number {
  return EASING_FUNCTIONS[preset]?.(Math.max(0, Math.min(1, t))) ?? t;
}

/* ── Animation definitions ───────────────────────────────── */

export interface AnimationDef {
  label: string;
  category: AnimationCategory;
  /** Returns CSS-like transform values at eased progress (0→1). For "in": 0=hidden, 1=visible. For "out": 0=visible, 1=hidden. */
  apply: (progress: number) => { opacity: number; scaleX: number; scaleY: number; translateX: number; translateY: number };
}

const identity = { opacity: 1, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };
const hidden = { opacity: 0, scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 };

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

export const ANIMATION_DEFS: Record<AnimationType, AnimationDef> = {
  fadeIn: {
    label: "Fondu entrant",
    category: "in",
    apply: (p) => ({ ...identity, opacity: p }),
  },
  fadeOut: {
    label: "Fondu sortant",
    category: "out",
    apply: (p) => ({ ...identity, opacity: 1 - p }),
  },
  scaleIn: {
    label: "Zoom entrant",
    category: "in",
    apply: (p) => ({ opacity: p, scaleX: lerp(0.3, 1, p), scaleY: lerp(0.3, 1, p), translateX: 0, translateY: 0 }),
  },
  scaleOut: {
    label: "Zoom sortant",
    category: "out",
    apply: (p) => ({ opacity: 1 - p, scaleX: lerp(1, 0.3, p), scaleY: lerp(1, 0.3, p), translateX: 0, translateY: 0 }),
  },
  bounceIn: {
    label: "Rebond entrant",
    category: "in",
    apply: (p) => ({ opacity: Math.min(1, p * 3), scaleX: lerp(0.3, 1, p), scaleY: lerp(0.3, 1, p), translateX: 0, translateY: 0 }),
  },
  bounceOut: {
    label: "Rebond sortant",
    category: "out",
    apply: (p) => ({ opacity: 1 - p, scaleX: lerp(1, 0.3, p), scaleY: lerp(1, 0.3, p), translateX: 0, translateY: 0 }),
  },
  slideInLeft: {
    label: "Glisse depuis gauche",
    category: "in",
    apply: (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1, scaleY: 1, translateX: lerp(-100, 0, p), translateY: 0 }),
  },
  slideInRight: {
    label: "Glisse depuis droite",
    category: "in",
    apply: (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1, scaleY: 1, translateX: lerp(100, 0, p), translateY: 0 }),
  },
  slideInTop: {
    label: "Glisse depuis haut",
    category: "in",
    apply: (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1, scaleY: 1, translateX: 0, translateY: lerp(-100, 0, p) }),
  },
  slideInBottom: {
    label: "Glisse depuis bas",
    category: "in",
    apply: (p) => ({ opacity: Math.min(1, p * 2), scaleX: 1, scaleY: 1, translateX: 0, translateY: lerp(100, 0, p) }),
  },
  slideOutLeft: {
    label: "Glisse vers gauche",
    category: "out",
    apply: (p) => ({ opacity: Math.max(0, 1 - p * 2), scaleX: 1, scaleY: 1, translateX: lerp(0, -100, p), translateY: 0 }),
  },
  slideOutRight: {
    label: "Glisse vers droite",
    category: "out",
    apply: (p) => ({ opacity: Math.max(0, 1 - p * 2), scaleX: 1, scaleY: 1, translateX: lerp(0, 100, p), translateY: 0 }),
  },
  slideOutTop: {
    label: "Glisse vers haut",
    category: "out",
    apply: (p) => ({ opacity: Math.max(0, 1 - p * 2), scaleX: 1, scaleY: 1, translateX: 0, translateY: lerp(0, -100, p) }),
  },
  slideOutBottom: {
    label: "Glisse vers bas",
    category: "out",
    apply: (p) => ({ opacity: Math.max(0, 1 - p * 2), scaleX: 1, scaleY: 1, translateX: 0, translateY: lerp(0, 100, p) }),
  },
};

/* ── Evaluate animations at a given time ─────────────────── */

export interface AnimationResult {
  opacity: number;
  transform: string; // CSS transform string
}

/**
 * Evaluate all animations on a layer at the given time.
 * Returns the combined opacity and CSS transform.
 * Falls back to old fadeIn/fadeOut if no animations are defined.
 */
export function evaluateAnimations(
  layer: Layer,
  currentTime: number,
  clipDuration: number,
): AnimationResult {
  const anims = layer.animations;
  const baseOpacity = layer.style.opacity;

  // Legacy fallback: use old fadeIn/fadeOut if no animations
  if (!anims || anims.length === 0) {
    let opacity = baseOpacity;
    const { fadeIn, fadeOut } = layer.style;
    if (fadeIn > 0 && currentTime < fadeIn) opacity *= currentTime / fadeIn;
    if (fadeOut > 0 && clipDuration > 0 && currentTime > clipDuration - fadeOut) {
      opacity *= Math.max(0, (clipDuration - currentTime) / fadeOut);
    }
    return { opacity: Math.max(0, opacity), transform: "" };
  }

  // Evaluate each animation and compose results
  let finalOpacity = baseOpacity;
  let totalTranslateX = 0; // percent of layer width
  let totalTranslateY = 0;
  let totalScaleX = 1;
  let totalScaleY = 1;

  for (const anim of anims) {
    const def = ANIMATION_DEFS[anim.type];
    if (!def) continue;

    const elapsed = currentTime - anim.time;

    if (elapsed < 0) {
      // Before animation starts — apply initial state for "in" animations
      if (def.category === "in") {
        const state = def.apply(0);
        finalOpacity *= state.opacity;
        totalScaleX *= state.scaleX;
        totalScaleY *= state.scaleY;
        totalTranslateX += state.translateX;
        totalTranslateY += state.translateY;
      }
      continue;
    }

    if (elapsed >= anim.duration) {
      // After animation ends — apply final state for "out" animations
      if (def.category === "out") {
        const state = def.apply(1);
        finalOpacity *= state.opacity;
        totalScaleX *= state.scaleX;
        totalScaleY *= state.scaleY;
        totalTranslateX += state.translateX;
        totalTranslateY += state.translateY;
      }
      continue;
    }

    // During animation
    const rawProgress = elapsed / anim.duration;
    const easedProgress = applyEasing(anim.easing, rawProgress);
    const state = def.apply(easedProgress);

    finalOpacity *= state.opacity;
    totalScaleX *= state.scaleX;
    totalScaleY *= state.scaleY;
    totalTranslateX += state.translateX;
    totalTranslateY += state.translateY;
  }

  const parts: string[] = [];
  if (totalTranslateX !== 0 || totalTranslateY !== 0) {
    parts.push(`translate(${totalTranslateX.toFixed(1)}%, ${totalTranslateY.toFixed(1)}%)`);
  }
  if (totalScaleX !== 1 || totalScaleY !== 1) {
    parts.push(`scale(${totalScaleX.toFixed(3)}, ${totalScaleY.toFixed(3)})`);
  }

  return {
    opacity: Math.max(0, Math.min(1, finalOpacity)),
    transform: parts.join(" "),
  };
}

/**
 * Compute the "visibility" (0-1) of a layer at a given time.
 * Used to draw the layer lifetime bar on the timeline.
 * Only considers opacity-affecting properties.
 */
export function layerVisibilityAtTime(
  layer: Layer,
  time: number,
  clipDuration: number,
): number {
  const result = evaluateAnimations(layer, time, clipDuration);
  return result.opacity;
}

/* ── Keyframe snapshot interpolation ─────────────────────── */

const KF_PROPS: KeyframableProperty[] = ["x", "y", "width", "height", "rotation", "opacity", "scale", "borderRadius", "blur"];

/**
 * Resolve all keyframed properties for a layer at a given time.
 * Interpolates between the two surrounding snapshots with easing.
 */
export function resolveKeyframes(
  keyframes: KeyframeSnapshot[] | undefined,
  time: number,
): Partial<Record<KeyframableProperty, number>> {
  if (!keyframes || keyframes.length === 0) return {};

  const sorted = keyframes.length > 1
    ? [...keyframes].sort((a, b) => a.time - b.time)
    : keyframes;

  // Before first → hold first snapshot values
  if (time <= sorted[0].time) {
    const s = sorted[0];
    return { x: s.x, y: s.y, width: s.width, height: s.height, rotation: s.rotation, opacity: s.opacity, scale: s.scale, borderRadius: s.borderRadius, blur: s.blur };
  }

  // After last → hold last snapshot values
  if (time >= sorted[sorted.length - 1].time) {
    const s = sorted[sorted.length - 1];
    return { x: s.x, y: s.y, width: s.width, height: s.height, rotation: s.rotation, opacity: s.opacity, scale: s.scale, borderRadius: s.borderRadius, blur: s.blur };
  }

  // Find surrounding snapshots and interpolate
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (time >= a.time && time <= b.time) {
      const raw = (time - a.time) / (b.time - a.time);
      const t = applyEasing(a.easing, raw);
      const result: Partial<Record<KeyframableProperty, number>> = {};
      for (const p of KF_PROPS) {
        result[p] = a[p] + (b[p] - a[p]) * t;
      }
      return result;
    }
  }

  const s = sorted[sorted.length - 1];
  return { x: s.x, y: s.y, width: s.width, height: s.height, rotation: s.rotation, opacity: s.opacity, scale: s.scale, borderRadius: s.borderRadius, blur: s.blur };
}
