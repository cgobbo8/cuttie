/**
 * What makes a montage feel edited: the picture moves on what is said.
 *
 * The moves, all of them smooth (the picture never jumps to another size inside a shot):
 * - "zoom": a whole piece plays a little closer than the one before it, so a cut between two
 *   pieces of the same scene reads as a cut and not as a glitch (every other piece);
 * - "punch": the picture comes closer in a quarter of a second, stays there for a moment and
 *   goes back as smoothly. When the streamer shouts it is their webcam that comes closer (the
 *   face); on a line that lands ("!" or "?"), the whole picture, less;
 * - "ease": a slow close-up over a few lines of plain talk, so that a calm stretch moves too;
 * - "shake": a small tremor that dies down, with a shout, at the strong level only.
 *
 * Never more than one move every ten seconds, pieces put end to end: more than that and the
 * eye is told nothing by them.
 *
 * Nothing changes length and no sound moves: an effect only scales and shifts the pictures of
 * its piece (the game, the webcam), each inside its own box: what a layout draws round them,
 * the subtitles and the titles stay still. The same maths draws the preview and the export
 * (this file is copied to api/remotion by scripts/sync-remotion.mjs).
 *
 * `placeEffects` decides where they go, from what is known of each piece without any AI:
 * where its sound jumps well above its usual level while someone speaks (a shout: found by the
 * app from the clip's sound, see api/app/services/clip_shouts.ts), its dated words (where its
 * lines start; a word that ends with "!" or "?" is a line that lands) or the key moments the
 * analysis gave a clip. Two levels, and none: a video can always play plain.
 */

export type EffectLevel = "light" | "strong";
export const EFFECT_LEVELS: EffectLevel[] = ["light", "strong"];
export const isEffectLevel = (value: unknown): value is EffectLevel => value === "light" || value === "strong";

export type EffectKind = "zoom" | "punch" | "ease" | "shake";
export const EFFECT_KINDS: EffectKind[] = ["zoom", "punch", "ease", "shake"];

/**
 * One move of a piece's picture: `at` and `for` in seconds from the piece's start; `amount`: a
 * scale (zoom, punch, ease) or a share of the picture (shake). `on: "cam"`: it moves the webcam
 * only (the face), when the piece shows one; else every picture of the piece.
 */
export interface SegmentEffect {
  kind: EffectKind;
  at: number;
  for: number;
  amount: number;
  on?: "cam";
}

/** The picture of a piece an effect is asked for: its webcam, its game, or all of it (a piece with no webcam) */
export type EffectPart = "cam" | "game" | "all";

const round = (value: number) => Math.round(value * 10000) / 10000;
const unit = (value: number) => Math.min(1, Math.max(0, value));
/** From 0 to 1 with no jolt at either end */
const smooth = (t: number) => unit(t) * unit(t) * (3 - 2 * unit(t));

/** How long a move takes to come in and to go out, seconds (never more than a share of its own length) */
const PACE: Record<"punch" | "ease", { rise: number; fall: number }> = { punch: { rise: 0.26, fall: 0.5 }, ease: { rise: 0.9, fall: 0.9 } };

/**
 * What a piece's effects do to one of its pictures `frame` frames from its start (null:
 * nothing, it plays as it is). `part`: the picture asked for; a move made for the webcam
 * leaves the game alone.
 */
export function effectAt(effects: SegmentEffect[] | undefined, frame: number, fps: number, part: EffectPart = "all"): { transform: string } | null {
  if (!effects?.length) return null;
  const t = frame / fps;
  let scale = 1;
  let x = 0;
  let y = 0;
  let moved = false;
  for (const effect of effects) {
    if (effect.on === "cam" && part === "game") continue;
    const into = t - effect.at;
    const left = effect.at + effect.for - t;
    if (into < 0 || left <= 0) continue;
    moved = true;
    if (effect.kind === "zoom") scale *= effect.amount;
    else if (effect.kind === "punch" || effect.kind === "ease") {
      // In, a hold, and out: each as smooth as the other (at most a third of the move each)
      const pace = PACE[effect.kind];
      const rise = Math.min(pace.rise, effect.for / 3);
      const fall = Math.min(pace.fall, effect.for / 3);
      scale *= 1 + (effect.amount - 1) * smooth(into / rise) * smooth(left / fall);
    } else {
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
const LEVELS: Record<EffectLevel, { zoom: number; shout: number; line: number; calm: number; shake: number }> = {
  // (`shout`: the webcam on a shout; `line`: the picture on a line that lands; `calm`: a slow close-up on plain talk)
  light: { zoom: 1.05, shout: 1.16, line: 1.08, calm: 1.06, shake: 0 },
  strong: { zoom: 1.08, shout: 1.24, line: 1.12, calm: 1.1, shake: 0.006 },
};
/** Never two moves closer than this, seconds, from one piece to the next too */
export const EFFECTS_APART = 10;
/** A piece shorter than this is left alone (seconds), and how far from its ends a move stays */
const SHORTEST = 2.5;
const EDGE = 0.5;
/** How long a shout holds the picture close, a line that lands, a tremor */
const SHOUT_FOR = 1.7;
const LINE_FOR = 1.3;
const SHAKE_FOR = 0.4;
/** A calm close-up: not before the picture was seen as it is, from a line to a later one (how long at least, at most, else) */
const FIRST = 2.4;
const CALM_MIN = 2.6;
const CALM_MAX = 4.8;
const CALM_FOR = 3.4;
/** A move starts a hair before the sound it is made for */
const LEAD = 0.05;
/** A shout is the streamer's when a word is said around it (seconds before, after) */
const WORD_NEAR = [0.4, 0.8];

/** What is known of a piece: how long it plays, its words on its own clock (seconds from its start), where someone shouts, the instants that matter when someone named them */
export interface EffectPiece {
  duration: number;
  words?: { word: string; start: number; end: number }[];
  /** Where the sound jumps well above its usual level (seconds), and by how much (dB) */
  shouts?: { at: number; over: number }[];
  beats?: number[];
}

/** A word a line lands on: it ends with "!" or "?" (quotes and brackets aside) */
const lands = (word: string) => /[!?]["'»)\]]*$/.test(word.trim());
/** A word that ends its line */
const ends = (word: string) => /[.!?…]["'»)\]]*$/.test(word.trim());

/** The instants a piece's lines start at: its first word, then each word after a pause or after one that ended the line before */
function lineStarts(piece: EffectPiece): number[] {
  const words = piece.words ?? [];
  return words.filter((word, i) => i === 0 || word.start - words[i - 1].end > 0.6 || ends(words[i - 1].word)).map((word) => word.start);
}

/** The instants of a piece worth a punch, in order: those named (a clip's key moments), else the starts of its lines that land */
function beatsOf(piece: EffectPiece): number[] {
  if (piece.beats?.length) return [...piece.beats].sort((a, b) => a - b);
  const beats: number[] = [];
  const words = piece.words ?? [];
  let lineStart = 0;
  for (let i = 0; i < words.length; i++) {
    // (a new line after a pause or a word that ended the one before)
    if (i > 0 && (words[i].start - words[i - 1].end > 0.6 || ends(words[i - 1].word))) lineStart = i;
    if (lands(words[i].word)) {
      // The punch comes on the line's last words, not after them: where its last three words start
      const from = Math.max(lineStart, i - 2);
      beats.push(words[from].start);
    }
  }
  return beats;
}

/** The shouts of a piece that are someone's voice: a word is said around them (a piece whose words are not known keeps them all), the loudest first */
function voiced(piece: EffectPiece): number[] {
  const words = piece.words;
  return [...(piece.shouts ?? [])]
    .filter((shout) => !words || words.some((word) => word.start <= shout.at + WORD_NEAR[1] && word.end >= shout.at - WORD_NEAR[0]))
    .sort((a, b) => b.over - a.over)
    .map((shout) => shout.at);
}

/**
 * The effects of each piece of a montage at a level (none: every piece plays plain). Every
 * other piece plays a little closer. Then the moves, never two within ten seconds of each
 * other on the video's clock: where the streamer shouts first (the webcam comes closer, with a
 * tremor at the strong level), then on the lines that land, the last one first (the payoff),
 * then a slow close-up on plain talk wherever ten seconds would pass with nothing.
 */
export function placeEffects(pieces: EffectPiece[], level: EffectLevel | null | undefined): SegmentEffect[][] {
  if (!isEffectLevel(level)) return pieces.map(() => []);
  const set = LEVELS[level];
  const starts: number[] = [];
  pieces.reduce((at, piece) => (starts.push(at), at + piece.duration), 0);
  // Where the moves already chosen are, on the video's clock
  const taken: number[] = [];
  // (to the thousandth: ten seconds counted from 12.4 s must not fall a hair short)
  const free = (at: number) => taken.every((other) => Math.abs(other - at) >= EFFECTS_APART - 0.001);
  const placed = pieces.map((piece, index): SegmentEffect[] => (pieces.length > 1 && index % 2 === 1 ? [{ kind: "zoom", at: 0, for: round(piece.duration), amount: set.zoom }] : []));
  const long = (piece: EffectPiece) => piece.duration >= SHORTEST;
  const inside = (piece: EffectPiece, at: number, room = EDGE) => at >= EDGE && at <= piece.duration - room;

  // 1. Where the streamer shouts: the loudest of the whole video first
  const shouts = pieces
    .flatMap((piece, index) => (long(piece) ? (piece.shouts ?? []).filter((shout) => voiced(piece).includes(shout.at) && inside(piece, shout.at)).map((shout) => ({ index, ...shout })) : []))
    .sort((a, b) => b.over - a.over);
  for (const shout of shouts) {
    const at = starts[shout.index] + shout.at;
    if (!free(at)) continue;
    taken.push(at);
    const piece = pieces[shout.index];
    const start = round(Math.max(0, shout.at - LEAD));
    placed[shout.index].push({ kind: "punch", at: start, for: round(Math.min(SHOUT_FOR, piece.duration - start)), amount: set.shout, on: "cam" });
    if (set.shake) placed[shout.index].push({ kind: "shake", at: start, for: round(Math.min(SHAKE_FOR, piece.duration - start)), amount: set.shake, on: "cam" });
  }

  // 2. The lines that land, the last of each piece first (the payoff)
  pieces.forEach((piece, index) => {
    if (!long(piece)) return;
    for (const beat of beatsOf(piece).filter((at) => inside(piece, at)).reverse()) {
      const at = starts[index] + beat;
      if (!free(at)) continue;
      taken.push(at);
      const start = round(Math.max(0, beat - LEAD));
      placed[index].push({ kind: "punch", at: start, for: round(Math.min(LINE_FOR, piece.duration - start)), amount: set.line });
    }
  });

  // 3. Plain talk: a slow close-up from a line to a later one, wherever ten seconds would pass with nothing
  pieces.forEach((piece, index) => {
    if (piece.duration < FIRST + CALM_MIN + EDGE) return;
    const lines = lineStarts(piece);
    const last = piece.duration - CALM_MIN - EDGE;
    for (let from = FIRST; from <= last; ) {
      // (a piece nobody speaks in is taken at even times)
      const start = lines.length > 0 ? lines.find((at) => at >= from) : from;
      if (start === undefined || start > last) break;
      if (!free(starts[index] + start)) {
        from = start + 1;
        continue;
      }
      const next = lines.find((at) => at >= start + CALM_MIN && at <= start + CALM_MAX);
      const end = Math.min(next ?? start + CALM_FOR, piece.duration - EDGE);
      taken.push(starts[index] + start);
      placed[index].push({ kind: "ease", at: round(Math.max(0, start - LEAD)), for: round(end - start), amount: set.calm });
      from = start + EFFECTS_APART;
    }
  });

  return placed.map((effects) => effects.sort((a, b) => a.at - b.at || EFFECT_KINDS.indexOf(a.kind) - EFFECT_KINDS.indexOf(b.kind)));
}

/** Effects as the renderer takes them: known kinds, sane numbers, a few dozen per piece at most (anything else is dropped) */
export function cleanEffects(raw: unknown): SegmentEffect[] {
  const effects: SegmentEffect[] = [];
  for (const item of Array.isArray(raw) ? raw.slice(0, 80) : []) {
    const { kind, at, for: length, amount, on } = (item ?? {}) as Record<string, unknown>;
    if (!EFFECT_KINDS.includes(kind as EffectKind)) continue;
    const numbers = [at, length, amount].map(Number);
    if (!numbers.every(Number.isFinite) || numbers[0] < 0 || numbers[1] <= 0 || numbers[1] > 3600) continue;
    const most = kind === "shake" ? 0.03 : 1.3;
    const least = kind === "shake" ? 0 : 1;
    if (numbers[2] < least || numbers[2] > most) continue;
    effects.push({ kind: kind as EffectKind, at: numbers[0], for: numbers[1], amount: numbers[2], ...(on === "cam" ? { on: "cam" as const } : {}) });
  }
  return effects;
}
