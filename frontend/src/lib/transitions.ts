/**
 * Ready-made transitions between two pieces of a montage (copied to
 * api/remotion/transitions.ts by scripts/sync-remotion.mjs: the export draws
 * exactly what the app shows).
 *
 * A transition never changes how long the video is, nor where a piece's sound
 * starts: it only moves what is seen around the cut. Before the cut it plays on
 * the last frames of the piece going out; after it, on the first frames of the
 * piece coming in, over the last picture of the one before held still when the
 * transition shows both (a slide, a fade).
 */

export const TRANSITION_IDS = ["flash", "zoom", "slide", "swipe", "shake", "pop", "fade"] as const;
export type TransitionId = (typeof TRANSITION_IDS)[number];

export const isTransition = (value: unknown): value is TransitionId => TRANSITION_IDS.includes(value as TransitionId);

/** How a piece is drawn during a transition, in shares of its own size: the same at any scale */
export interface TransitionLook {
  transform?: string;
  opacity?: number;
  /** Blur, as a share of the picture's width */
  blur?: number;
  /** 1: as it is, 0: black */
  brightness?: number;
}

/** A look as CSS, for a picture `width` pixels wide */
export function lookStyle(look: TransitionLook, width: number): { transform?: string; opacity?: number; filter?: string } {
  const filter = [look.blur ? `blur(${Math.round(look.blur * width * 10) / 10}px)` : "", look.brightness !== undefined ? `brightness(${look.brightness})` : ""].filter(Boolean).join(" ");
  return {
    ...(look.transform ? { transform: look.transform } : {}),
    ...(look.opacity !== undefined ? { opacity: look.opacity } : {}),
    ...(filter ? { filter } : {}),
  };
}

export interface TransitionFrame {
  /** The piece playing: the one going out before the cut, the one coming in after it */
  piece: TransitionLook;
  /** After the cut, the last picture of the piece before, held behind the one coming in (null: not shown) */
  held: TransitionLook | null;
  /** White over the pieces, 0 to 1 */
  flash: number;
}

/** Frames at 30 fps each transition plays before the cut and after it */
const SPANS: Record<TransitionId, { before: number; after: number }> = {
  flash: { before: 2, after: 9 },
  zoom: { before: 5, after: 9 },
  slide: { before: 0, after: 11 },
  swipe: { before: 0, after: 11 },
  shake: { before: 3, after: 9 },
  pop: { before: 0, after: 13 },
  fade: { before: 0, after: 11 },
};

/** Frames a transition plays before the cut and after it, at this frame rate */
export function transitionSpan(id: TransitionId, fps: number): { before: number; after: number } {
  const span = SPANS[id];
  return { before: Math.round((span.before * fps) / 30), after: Math.max(1, Math.round((span.after * fps) / 30)) };
}

const outCubic = (t: number) => 1 - (1 - t) ** 3;
const outQuart = (t: number) => 1 - (1 - t) ** 4;
/** Past its mark, then back: what makes a picture land instead of stopping */
const outBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * What a transition does `frame` frames from the cut: negative before it (-1 is
 * the last frame of the piece going out), 0 on the first frame of the piece
 * coming in. Null where it does nothing.
 */
export function transitionAt(id: TransitionId, frame: number, fps: number): TransitionFrame | null {
  const { before, after } = transitionSpan(id, fps);
  if (frame < -before || frame >= after) return null;
  // Before the cut: 0 -> 1 as it comes; after it: 0 -> 1 as the transition ends
  const u = frame < 0 ? (frame + before + 1) / before : 0;
  const t = frame >= 0 ? frame / after : 0;
  const left = 1 - t;

  switch (id) {
    case "flash":
      if (frame < 0) return { piece: { transform: `scale(${round(1 + 0.03 * u)})` }, held: null, flash: round(0.55 * u * u) };
      return { piece: { transform: `scale(${round(1 + 0.07 * left * left)})` }, held: null, flash: round(left ** 2.2) };

    case "zoom": {
      if (frame < 0) {
        const e = u ** 3;
        return { piece: { transform: `scale(${round(1 + 0.55 * e)})`, blur: round(0.011 * e) }, held: null, flash: 0 };
      }
      const e = 1 - outCubic(t);
      return { piece: { transform: `scale(${round(1 + 0.55 * e)})`, blur: round(0.011 * e) }, held: null, flash: 0 };
    }

    case "slide":
    case "swipe": {
      const p = outQuart(t);
      const axis = id === "slide" ? "X" : "Y";
      // Fastest in the middle of the way: blurred there, sharp at both ends
      const blur = round(0.024 * p * (1 - p));
      return {
        piece: { transform: `translate${axis}(${round((1 - p) * 100)}%)`, blur },
        held: { transform: `translate${axis}(${round(-p * 100)}%)`, blur },
        flash: 0,
      };
    }

    case "shake": {
      // The picture is a little bigger than its frame for as long as it moves: its edges never show
      const power = frame < 0 ? 0.35 * u : left * left;
      const x = 2.6 * power * Math.sin(frame * 2.7 + 1);
      const y = 1.5 * power * Math.sin(frame * 3.9);
      const turn = 0.8 * power * Math.sin(frame * 3.3);
      return { piece: { transform: `translate(${round(x)}%, ${round(y)}%) rotate(${round(turn)}deg) scale(${round(1 + 0.09 * power)})` }, held: null, flash: 0 };
    }

    case "pop": {
      const dim = outCubic(Math.min(1, t * 1.6));
      return {
        piece: { transform: `scale(${round(0.45 + 0.55 * outBack(t))})`, opacity: round(Math.min(1, t * 5 + 0.2)) },
        // The picture before stays where it is and goes dark and soft behind (smaller, its edges would show)
        held: { brightness: round(1 - 0.62 * dim), blur: round(0.008 * dim) },
        flash: 0,
      };
    }

    case "fade":
      return { piece: { opacity: round(t * t * (3 - 2 * t)) }, held: {}, flash: 0 };
  }
}
