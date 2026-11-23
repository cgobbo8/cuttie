/**
 * What makes a montage feel edited: the picture moves on what is said.
 *
 * Three moves, the ones short videos that do well are cut with:
 * - "zoom": a piece plays a little closer than the one before it, so a cut between two pieces
 *   of the same scene reads as a cut and not as a glitch (every other piece);
 * - "punch": the picture jumps closer on a line that lands (in a tenth of a second), stays
 *   there for a moment and comes back;
 * - "shake": a short tremor that dies down, on the same instant.
 *
 * Nothing changes length and no sound moves: an effect only scales and shifts the picture of
 * its piece, as a transition does around a cut. The same maths draws the preview and the
 * export (this file is copied to api/remotion by scripts/sync-remotion.mjs).
 *
 * `placeEffects` decides where they go, from what is known of each piece without any AI: its
 * dated words (a word that ends with "!" or "?" is a line that lands) or the key moments the
 * analysis gave a clip. Two levels, and none: a video can always play plain.
 */

export type EffectLevel = "light" | "strong";
export const EFFECT_LEVELS: EffectLevel[] = ["light", "strong"];
export const isEffectLevel = (value: unknown): value is EffectLevel => value === "light" || value === "strong";

export type EffectKind = "zoom" | "punch" | "shake";
export const EFFECT_KINDS: EffectKind[] = ["zoom", "punch", "shake"];

/** One move of a piece's picture: `at` and `for` in seconds from the piece's start; `amount`: a scale (zoom, punch) or a share of the picture (shake) */
export interface SegmentEffect {
  kind: EffectKind;
  at: number;
  for: number;
  amount: number;
}

const round = (value: number) => Math.round(value * 10000) / 10000;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** How fast a punch comes in and goes out, seconds */
const PUNCH_IN = 0.1;
const PUNCH_OUT = 0.18;

/** What a piece's effects do to its picture `frame` frames from its start (null: nothing, the piece plays as it is) */
export function effectAt(effects: SegmentEffect[] | undefined, frame: number, fps: number): { transform: string } | null {
  if (!effects?.length) return null;
  const t = frame / fps;
  let scale = 1;
  let x = 0;
  let y = 0;
  let moved = false;
  for (const effect of effects) {
    const into = t - effect.at;
    const left = effect.at + effect.for - t;
    if (into < 0 || left <= 0) continue;
    moved = true;
    if (effect.kind === "zoom") scale *= effect.amount;
    else if (effect.kind === "punch") scale *= 1 + (effect.amount - 1) * easeOut(Math.min(1, into / PUNCH_IN) * Math.min(1, left / PUNCH_OUT));
    else {
      // A tremor that dies down; the picture comes a little closer so that its edges never show
      const strength = effect.amount * (left / effect.for);
      scale *= 1 + 2.5 * effect.amount;
      x += 100 * strength * Math.sin(t * 83);
      y += 100 * strength * Math.cos(t * 97);
    }
  }
  return moved ? { transform: `translate(${round(x)}%, ${round(y)}%) scale(${round(scale)})` } : null;
}

/** How much each level moves the picture */
const LEVELS: Record<EffectLevel, { zoom: number; punch: number; hold: number; punches: number; shake: number }> = {
  light: { zoom: 1.05, punch: 1.08, hold: 0.8, punches: 1, shake: 0 },
  strong: { zoom: 1.08, punch: 1.14, hold: 1.0, punches: 2, shake: 0.008 },
};
/** A piece shorter than this is left alone (seconds), and how far from its ends and from each other punches stay */
const SHORTEST = 2.5;
const EDGE = 0.5;
const APART = 2.5;
const SHAKE_FOR = 0.35;

/** What is known of a piece: how long it plays, its words on its own clock (seconds from its start), the instants that matter when someone named them */
export interface EffectPiece {
  duration: number;
  words?: { word: string; start: number; end: number }[];
  beats?: number[];
}

/** A word a line lands on: it ends with "!" or "?" (quotes and brackets aside) */
const lands = (word: string) => /[!?]["'»)\]]*$/.test(word.trim());

/** The instants of a piece worth a punch, in order: those named (a clip's key moments), else the starts of its lines that land */
function beatsOf(piece: EffectPiece): number[] {
  if (piece.beats?.length) return [...piece.beats].sort((a, b) => a - b);
  const beats: number[] = [];
  const words = piece.words ?? [];
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    // (a new line after a pause or a word that ended the one before)
    if (i > 0 && (words[i].start - words[i - 1].end > 0.6 || /[.!?…]["'»)\]]*$/.test(words[i - 1].word.trim()))) lineStart = i;
    if (lands(words[i].word)) {
      // The punch comes on the line's last words, not after them: where its last three words start
      const from = Math.max(lineStart, i - 2);
      beats.push(words[from].start);
    }
  }
  return beats;
}

/**
 * The effects of each piece of a montage at a level (none: every piece plays plain). Every
 * other piece plays a little closer; a piece long enough gets a punch on its last line that
 * lands (the payoff), and at the strong level on its first too, with a short tremor.
 */
export function placeEffects(pieces: EffectPiece[], level: EffectLevel | null | undefined): SegmentEffect[][] {
  if (!isEffectLevel(level)) return pieces.map(() => []);
  const set = LEVELS[level];
  return pieces.map((piece, index) => {
    const effects: SegmentEffect[] = [];
    if (pieces.length > 1 && index % 2 === 1) effects.push({ kind: "zoom", at: 0, for: round(piece.duration), amount: set.zoom });
    if (piece.duration < SHORTEST) return effects;
    const inside = beatsOf(piece).filter((at) => at >= EDGE && at <= piece.duration - EDGE);
    // The last one first (the payoff), then the earliest far enough from it
    const chosen: number[] = [];
    for (const at of [...inside].reverse().slice(0, 1).concat(inside)) {
      if (chosen.length < set.punches && chosen.every((other) => Math.abs(other - at) >= APART)) chosen.push(at);
    }
    for (const at of chosen.sort((a, b) => a - b)) {
      const start = round(Math.max(0, at - 0.05));
      effects.push({ kind: "punch", at: start, for: round(Math.min(set.hold, piece.duration - start)), amount: set.punch });
      if (set.shake) effects.push({ kind: "shake", at: start, for: round(Math.min(SHAKE_FOR, piece.duration - start)), amount: set.shake });
    }
    return effects;
  });
}

/** Effects as the renderer takes them: known kinds, sane numbers, a few per piece (anything else is dropped) */
export function cleanEffects(raw: unknown): SegmentEffect[] {
  const effects: SegmentEffect[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 12) : []) {
    const { kind, at, for: length, amount } = (item ?? {}) as Record<string, unknown>;
    if (!EFFECT_KINDS.includes(kind as EffectKind)) continue;
    const numbers = [at, length, amount].map(Number);
    if (!numbers.every(Number.isFinite) || numbers[0] < 0 || numbers[1] <= 0 || numbers[1] > 3600) continue;
    const most = kind === "shake" ? 0.03 : 1.3;
    const least = kind === "shake" ? 0 : 1;
    if (numbers[2] < least || numbers[2] > most) continue;
    effects.push({ kind: kind as EffectKind, at: numbers[0], for: numbers[1], amount: numbers[2] });
  }
  return effects;
}
