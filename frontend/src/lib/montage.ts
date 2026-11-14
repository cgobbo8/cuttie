/**
 * A montage: several pieces played one after the other in one vertical video.
 * Either one clip cut in several pieces (Choisir: "keep the setup, drop the
 * middle, keep the punchline"), or pieces from all over the live put together
 * (compilations).
 *
 * Each piece keeps its clip's clock (subtitles, chat and videos are timed on
 * it), while the hook line and the widgets run on the montage's own clock:
 * they don't restart at every cut.
 */

import type { ChatMessage, Layer, SubtitleWord } from "./editorTypes";
import type { TemplateContext } from "./templates";

/** A part of a clip, [start, end] in clip seconds */
export type Range = [number, number];

/** Shortest piece kept, seconds */
export const MIN_PIECE = 0.4;
/** Two pieces closer than this touch: the video goes from one to the other without a jump */
export const TOUCH = 0.05;

const hundredth = (s: number) => Math.round(s * 100) / 100;

/**
 * Pieces in order, inside the clip, the tiny ones dropped. Pieces that overlap
 * become one; pieces that only touch stay two (a cut the streamer made, or a
 * part kept right before another: each keeps its own handles).
 */
export function normalizeRanges(ranges: Range[], duration: number, minLength = MIN_PIECE): Range[] {
  const sorted = ranges
    .map(([a, b]): Range => [Math.max(0, Math.min(a, b)), Math.min(duration, Math.max(a, b))])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((x, y) => x[0] - y[0]);
  const pieces: Range[] = [];
  for (const [a, b] of sorted) {
    const last = pieces[pieces.length - 1];
    if (last && a < last[1] - TOUCH) last[1] = Math.max(last[1], b);
    // Starts exactly where the one before ends: no frame lost or played twice
    else pieces.push([last && a <= last[1] + TOUCH ? last[1] : a, b]);
  }
  return pieces.filter(([a, b]) => b - a >= minLength).map(([a, b]): Range => [hundredth(a), hundredth(b)]);
}

/** The same pieces, to `tolerance` seconds (what the server stores is rounded) */
export function sameRanges(a: Range[], b: Range[], tolerance = 0.001): boolean {
  return a.length === b.length && a.every(([s, e], i) => Math.abs(s - b[i][0]) <= tolerance && Math.abs(e - b[i][1]) <= tolerance);
}

/** The parts of the clip that are cut out, in order */
export function gapsOf(ranges: Range[], duration: number): Range[] {
  const gaps: Range[] = [];
  let cursor = 0;
  for (const [a, b] of ranges) {
    if (a > cursor) gaps.push([cursor, a]);
    cursor = b;
  }
  if (cursor < duration) gaps.push([cursor, duration]);
  return gaps;
}

/** Seconds of video the pieces make together */
export function rangesLength(ranges: Range[]): number {
  return ranges.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** From the first piece's start to the last one's end */
export function envelope(ranges: Range[]): Range | null {
  return ranges.length > 0 ? [ranges[0][0], ranges[ranges.length - 1][1]] : null;
}

/** Index of the piece playing at `time`, -1 in a part that is cut out (a piece's start is rounded: a hair before it is in) */
export function pieceAt(ranges: Range[], time: number): number {
  return ranges.findIndex(([a, b]) => time >= a - 0.006 && time < b);
}

/**
 * Cut at `time`: the piece playing there becomes two that touch, nothing is
 * taken out yet. Each half has its own handles: drag them apart to take a part
 * out, or remove a half. Unchanged when a side would be too short.
 */
export function splitAt(ranges: Range[], time: number): Range[] {
  const i = pieceAt(ranges, time);
  if (i === -1) return ranges;
  const [a, b] = ranges[i];
  const at = hundredth(time);
  if (at - a < MIN_PIECE || b - at < MIN_PIECE) return ranges;
  return [...ranges.slice(0, i), [a, at], [at, b], ...ranges.slice(i + 1)];
}

/**
 * After an edge of piece `index` was dragged: when it now touches its
 * neighbor on that side, the two become one (closing a gap by hand joins them).
 */
export function joinTouching(ranges: Range[], index: number, side: "start" | "end"): Range[] {
  const a = side === "end" ? index : index - 1;
  const left = ranges[a];
  const right = ranges[a + 1];
  if (!left || !right || right[0] - left[1] > TOUCH) return ranges;
  return [...ranges.slice(0, a), [left[0], right[1]], ...ranges.slice(a + 2)];
}

/**
 * A new piece starting at `time`, in a part that was cut out: `length` seconds,
 * or up to the next piece when it is closer (they then touch, and stay two).
 */
export function addPiece(ranges: Range[], time: number, duration: number, length = 8): Range[] {
  if (pieceAt(ranges, time) !== -1) return ranges;
  const next = ranges.find(([a]) => a > time);
  const end = Math.min(duration, time + length, next ? next[0] : Infinity);
  if (end - time < MIN_PIECE) return ranges;
  return normalizeRanges([...ranges, [time, end]], duration);
}

/** Without piece `index` (the last piece standing stays) */
export function removePiece(ranges: Range[], index: number): Range[] {
  return ranges.length > 1 ? ranges.filter((_, i) => i !== index) : ranges;
}

/** Piece `index` with one edge moved to `time`: stays at least `min` seconds long, never crosses its neighbors */
export function moveEdge(ranges: Range[], index: number, side: "start" | "end", time: number, duration: number, min = MIN_PIECE): Range[] {
  const [a, b] = ranges[index];
  const floor = index > 0 ? ranges[index - 1][1] : 0;
  const ceil = index < ranges.length - 1 ? ranges[index + 1][0] : duration;
  const next: Range = side === "start" ? [Math.min(Math.max(time, floor), b - min), b] : [a, Math.max(Math.min(time, ceil), a + min)];
  return ranges.map((r, i) => (i === index ? next : r));
}

/** Where to go on when the playhead sits in a part that is cut out: the next piece's start, null after the last */
export function nextStart(ranges: Range[], time: number): number | null {
  if (pieceAt(ranges, time) !== -1) return time;
  return ranges.find(([a]) => a > time)?.[0] ?? null;
}

/** Time in the finished video of a time of the clip (a cut out part counts as the next piece's start) */
export function outputTime(ranges: Range[], clipTime: number): number {
  let out = 0;
  for (const [a, b] of ranges) {
    if (clipTime < a) break;
    out += Math.min(clipTime, b) - a;
  }
  return out;
}

/* ── Clean cuts ───────────────────────────────────────────── */

/** Longest silence left between two words when tightening, seconds */
export const TIGHTEN_GAP = 1.1;
/** Air kept after the last word before a cut and before the first word after it */
const AIR_AFTER = 0.3;
const AIR_BEFORE = 0.2;

/**
 * A handle dropped at `time` moves to the silence between two words when one
 * is within `radius` seconds: cuts land between words, not through them.
 */
export function snapToWords(time: number, words: SubtitleWord[], radius = 0.25): number {
  let best = time;
  let bestDistance = radius;
  for (let i = 0; i <= words.length; i++) {
    const before = words[i - 1];
    const after = words[i];
    // The middle of the silence between two words (or just off a word at the clip's ends)
    const spot = before && after ? (before.end + Math.max(before.end, after.start)) / 2 : before ? before.end + 0.08 : after ? after.start - 0.08 : null;
    if (spot === null) continue;
    const distance = Math.abs(spot - time);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return Math.max(0, hundredth(best));
}

/**
 * The pieces without their silences: wherever nobody speaks for more than
 * `maxGap` seconds, the wait is cut out (a little air stays around the words).
 * Pieces without a word are left alone: a silent action is still a moment.
 */
export function tighten(ranges: Range[], words: SubtitleWord[], duration: number, maxGap = TIGHTEN_GAP): Range[] {
  const out: Range[] = [];
  for (const [a, b] of ranges) {
    const spoken = words.filter((w) => w.end > a && w.start < b);
    if (spoken.length === 0) {
      out.push([a, b]);
      continue;
    }
    let start = a;
    // Waiting before the first word
    if (spoken[0].start - a > maxGap) start = spoken[0].start - AIR_BEFORE;
    for (let i = 0; i < spoken.length - 1; i++) {
      const gap = spoken[i + 1].start - spoken[i].end;
      if (gap > maxGap) {
        out.push([start, spoken[i].end + AIR_AFTER]);
        start = spoken[i + 1].start - AIR_BEFORE;
      }
    }
    const last = spoken[spoken.length - 1];
    out.push([start, b - last.end > maxGap ? last.end + AIR_AFTER : b]);
  }
  return normalizeRanges(out, duration);
}

/* ── From pieces to what Remotion plays ───────────────────── */

/** A layer and where it stacks among all the template's layers (0 = bottom) */
export interface PlacedLayer {
  layer: Layer;
  z: number;
}

/** A piece: `duration` seconds of its clip from `from` (clip seconds), with the layers that follow the clip's clock */
export interface MontageSegment {
  from: number;
  duration: number;
  layers: PlacedLayer[];
}

export interface MontageProps {
  segments: MontageSegment[];
  /** Layers on the montage's own clock (hook line, widgets, section titles) */
  overlays: PlacedLayer[];
  // Remotion's props are a record
  [key: string]: unknown;
}

/** A piece to build: its clip's template context, and the part of the clip it plays */
export interface MontageCut {
  ctx: TemplateContext;
  start: number;
  end: number;
}

/** Layers that live on the montage's clock: the hook line (the video's cover) and the widgets */
export function isOverlayLayer(layer: Layer): boolean {
  return layer.type === "widget" || layer.id === "tpl-accroche" || layer.id === "tpl-fond-de-l-accroche";
}

/** A word belongs to the piece that plays most of it */
export function wordsIn<T extends { start: number; end: number }>(words: T[], start: number, end: number): T[] {
  return words.filter((w) => {
    const middle = (w.start + w.end) / 2;
    return middle >= start && middle <= end;
  });
}

const chatIn = (chat: ChatMessage[] | undefined, start: number, end: number) => (chat ?? []).filter((m) => m.timestamp >= start && m.timestamp <= end);

export const framesOf = (seconds: number, fps: number) => Math.max(1, Math.round(seconds * fps));

/** Frames of the whole montage */
export function montageFrames(segments: { duration: number }[], fps: number): number {
  return segments.reduce((sum, s) => sum + framesOf(s.duration, fps), 0);
}

/**
 * What Remotion plays for these pieces with a template (`build`: the template's
 * layers for a context). Each piece gets the template's layers for its own
 * part of its clip; the hook and widgets are laid once over the whole video.
 * `build` is told which piece it builds for (its index), so each can have its
 * own template; the hook and widgets are asked with -1 (the video's template).
 * `extra`: more layers on the montage's clock (section titles), on top.
 */
export function buildMontage(
  cuts: MontageCut[],
  build: (ctx: TemplateContext, index: number) => Layer[],
  fps = 30,
  extra: (total: number) => Layer[] = () => [],
): MontageProps {
  const place = (layers: Layer[]): PlacedLayer[] => layers.map((layer, z) => ({ layer, z }));
  const segments: MontageSegment[] = cuts.map((cut, index) => {
    // Whole frames, counted from the piece's two ends: the overlays' clock stays on the pictures, and a
    // piece that starts where another ends takes over on the very next frame (none played twice, none lost)
    const first = Math.round(cut.start * fps);
    const from = first / fps;
    const duration = Math.max(1, Math.round(cut.end * fps) - first) / fps;
    const ctx: TemplateContext = {
      ...cut.ctx,
      startAt: from,
      endAt: from + duration,
      words: wordsIn(cut.ctx.words, from, from + duration),
      chat: chatIn(cut.ctx.chat, from, from + duration),
    };
    const layers = place(build(ctx, index))
      .filter((p) => !isOverlayLayer(p.layer))
      // No "subtitles" placeholder between two sentences: it would flash at every cut of the preview
      .map((p) => (p.layer.subtitle ? { ...p, layer: { ...p.layer, subtitle: { ...p.layer.subtitle, quiet: true } } } : p));
    return { from, duration, layers };
  });
  const total = segments.reduce((sum, s) => sum + s.duration, 0);
  const first = cuts[0];
  const overlays = first ? place(build({ ...first.ctx, startAt: 0, endAt: total, words: [], chat: [] }, -1)).filter((p) => isOverlayLayer(p.layer)) : [];
  const top = Math.max(0, ...overlays.map((p) => p.z), ...segments.flatMap((s) => s.layers.map((p) => p.z))) + 1;
  return { segments, overlays: [...overlays, ...extra(total).map((layer, i) => ({ layer, z: top + i }))] };
}

/** The montage as the renderer takes it: `clips[i]` is the clip piece `i` plays */
export function renderPieces(montage: MontageProps, clips: string[]): { clip: string; from: number; duration: number; layers: PlacedLayer[] }[] {
  return montage.segments.map((segment, i) => ({ clip: clips[i], from: segment.from, duration: segment.duration, layers: segment.layers }));
}
