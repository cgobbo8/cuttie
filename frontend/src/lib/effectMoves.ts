import type { Compilation, CompilationItem } from "./api";
import { inOrder, type SegmentEffect } from "./effects";

/**
 * The moves of a video's picture as the streamer sees and handles them: one mark each on a lane
 * of the timeline, put down, moved, stretched, changed or taken out by hand (or by the
 * assistant).
 *
 * A video's effects are placed without anyone seeing to it while it has a level (« Légers »,
 * « Marqués »: see effects.ts). The first time one is touched, what was placed becomes the
 * passages' own moves (`item.moves`) and the video's effects are « à la main » (`effects:
 * "custom"`): from then on only what is written on the passages plays. A move belongs to its
 * passage and is dated on the live's clock, as the passage's own ends are: a passage moved,
 * cut again or put in another part keeps its moves where they were made.
 */

/** A video whose moves were set by hand */
export const CUSTOM_EFFECTS = "custom";

/** The moves that can be put on a passage */
export const MOVE_TYPES = ["cam", "zoom", "slow", "shake", "pulse", "flash", "gray"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];
export const isMoveType = (value: unknown): value is MoveType => typeof value === "string" && (MOVE_TYPES as readonly string[]).includes(value);

/** How long each lasts when it is put down, and how short and how long it can be made (seconds) */
export const MOVE_SPANS: Record<MoveType, { for: number; min: number; max: number }> = {
  cam: { for: 1.7, min: 0.8, max: 8 },
  zoom: { for: 1.3, min: 0.8, max: 8 },
  slow: { for: 3.4, min: 1.5, max: 12 },
  shake: { for: 0.4, min: 0.2, max: 2 },
  pulse: { for: 0.8, min: 0.4, max: 3 },
  flash: { for: 0.35, min: 0.15, max: 1.5 },
  gray: { for: 2.5, min: 0.6, max: 15 },
};

/**
 * One move of a passage: `at` on the live's clock (seconds, as the passage's own ends), for
 * `for` seconds. Its own settings, when it is not as its kind usually is: `sharp` (it is cut
 * in and out instead of coming and going smoothly) and `amount` (how far it goes).
 */
export interface ItemMove {
  id: string;
  kind: MoveType;
  at: number;
  for: number;
  sharp?: boolean;
  amount?: number;
}

/** How far a move goes: gentle, as usual, strong (a scale, or a share of the picture for a tremor). A flash and black and white have no such thing */
export const MOVE_AMOUNTS: Partial<Record<MoveType, [number, number, number]>> = {
  cam: [1.12, 1.2, 1.3],
  zoom: [1.07, 1.12, 1.2],
  slow: [1.06, 1.1, 1.16],
  shake: [0.004, 0.006, 0.01],
  pulse: [1.05, 1.08, 1.13],
};
export const STRENGTHS = ["soft", "normal", "strong"] as const;
export type Strength = (typeof STRENGTHS)[number];
/** The moves that can be cut in and out instead of coming smoothly: those that bring the picture closer */
export const SHARP_KINDS: MoveType[] = ["cam", "zoom", "slow"];

/** How far a move goes, within what its kind allows */
export function amountOf(move: Pick<ItemMove, "kind" | "amount">): number {
  const range = MOVE_AMOUNTS[move.kind];
  if (!range) return 1;
  // (a little room on each side of the three settings: what was placed for the video is kept as it was)
  const [least, most] = move.kind === "shake" ? [0.002, 0.012] : [1.03, 1.3];
  return typeof move.amount === "number" && Number.isFinite(move.amount) ? Math.min(most, Math.max(least, move.amount)) : range[1];
}

/** Which of the three settings a move is nearest to (null: its kind has none) */
export function strengthOf(move: Pick<ItemMove, "kind" | "amount">): Strength | null {
  const range = MOVE_AMOUNTS[move.kind];
  if (!range) return null;
  const amount = amountOf(move);
  return STRENGTHS[range.reduce((best, value, k) => (Math.abs(value - amount) < Math.abs(range[best] - amount) ? k : best), 1)];
}

const hundredth = (seconds: number) => Math.round(seconds * 100) / 100;
/** 8 letters and digits: names a move */
const newMoveId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** What a move is to the renderer, on its piece's clock (`start`: where the passage starts on the live's clock) */
function effectOf(move: ItemMove, start: number): SegmentEffect {
  const at = hundredth(Math.max(0, move.at - start));
  const amount = amountOf(move);
  // (cut in and out: the picture is at that size for the whole stretch, with no way in nor out)
  const sharp = !!move.sharp && SHARP_KINDS.includes(move.kind);
  if (move.kind === "cam") return { kind: sharp ? "zoom" : "punch", at, for: move.for, amount, on: "cam" };
  if (move.kind === "zoom") return { kind: sharp ? "zoom" : "punch", at, for: move.for, amount };
  if (move.kind === "slow") return { kind: sharp ? "zoom" : "ease", at, for: move.for, amount };
  if (move.kind === "shake" || move.kind === "pulse") return { kind: move.kind, at, for: move.for, amount };
  return { kind: move.kind, at, for: move.for, amount: 1 };
}

/** A passage's own moves as the effects of its piece: those that start inside it, none running past its end */
export function effectsFromMoves(moves: ItemMove[] | undefined, item: Pick<CompilationItem, "start" | "end">): SegmentEffect[] {
  const length = item.end - item.start;
  return inOrder(
    (moves ?? [])
      .filter((move) => isMoveType(move.kind) && move.at >= item.start - 0.01 && move.at < item.end - 0.1)
      .map((move) => effectOf({ ...move, for: hundredth(Math.min(move.for, item.end - move.at)) }, item.start))
      .filter((effect) => effect.at < length),
  );
}

/** The effects placed on a piece read back as moves of its passage: what plays before anyone touched it (a piece that only plays a little closer has none) */
export function movesFromEffects(effects: SegmentEffect[] | undefined, item: Pick<CompilationItem, "id" | "start">): ItemMove[] {
  const moves: ItemMove[] = [];
  for (const effect of effects ?? []) {
    const kind: MoveType | null =
      effect.kind === "punch" ? (effect.on === "cam" ? "cam" : "zoom") : effect.kind === "ease" ? "slow" : effect.kind === "zoom" ? null : effect.kind === "shake" || effect.kind === "pulse" || effect.kind === "flash" || effect.kind === "gray" ? effect.kind : null;
    // (the same name each time the video is built: a move read back is the same move until it is touched)
    // (how far it went is kept: made its passage's own, the video plays as it did)
    if (kind) moves.push({ id: `${item.id.slice(0, 5)}a${moves.length}`, kind, at: hundredth(item.start + effect.at), for: hundredth(effect.for), ...(MOVE_AMOUNTS[kind] ? { amount: effect.amount } : {}) });
  }
  return moves;
}

/**
 * The moves of each passage of a video as they play: its own once the video's effects are « à
 * la main », else what was placed for it (`placed[i]`: the effects of piece `i`, in the order
 * of `items`).
 */
export function effectiveMoves(custom: boolean, items: CompilationItem[], placed: (SegmentEffect[] | undefined)[]): Record<string, ItemMove[]> {
  return Object.fromEntries(items.map((item, i) => [item.id, custom ? (item.moves ?? []).filter((move) => move.at >= item.start - 0.01 && move.at < item.end) : movesFromEffects(placed[i], item)]));
}

/** A video with these moves on its passages, its effects « à la main » from now on */
export function withMoves<T extends Pick<Compilation, "sections" | "effects">>(video: T, moves: Record<string, ItemMove[]>): T {
  return { ...video, effects: CUSTOM_EFFECTS, sections: video.sections.map((section) => ({ ...section, items: section.items.map((item) => ({ ...item, moves: [...(moves[item.id] ?? [])].sort((a, b) => a.at - b.at) })) })) };
}

/** A video whose effects are a level again (or none): its passages forget the moves made by hand */
export function withLevel<T extends Pick<Compilation, "sections" | "effects">>(video: T, level: string | null): T {
  const { effects: _before, ...rest } = video;
  return {
    ...(rest as T),
    ...(level ? { effects: level } : {}),
    sections: video.sections.map((section) => ({ ...section, items: section.items.map(({ moves: _moves, ...item }) => item) })),
  };
}

/** A move put down on a passage at `at` (live seconds): of the length of its kind, inside the passage */
export function newMove(kind: MoveType, at: number, item: Pick<CompilationItem, "start" | "end">): ItemMove {
  const span = MOVE_SPANS[kind];
  const length = Math.max(Math.min(span.min, item.end - item.start), Math.min(span.for, item.end - item.start));
  const start = Math.min(Math.max(item.start, at), Math.max(item.start, item.end - length));
  return { id: newMoveId(), kind, at: hundredth(start), for: hundredth(length) };
}

/** What can be changed of a move: its place, its length, its kind, whether it is cut in, and how far it goes (as one of the three settings, or exactly) */
export type MovePatch = Partial<Pick<ItemMove, "at" | "for" | "kind" | "sharp" | "amount">> & { strength?: Strength };

/** A move changed: kept inside its passage and within what its kind allows */
export function changedMove(move: ItemMove, patch: MovePatch, item: Pick<CompilationItem, "start" | "end">): ItemMove {
  const kind = patch.kind && isMoveType(patch.kind) ? patch.kind : move.kind;
  const other = kind !== move.kind;
  const span = MOVE_SPANS[kind];
  const room = item.end - item.start;
  // (another kind: its usual length and its usual strength, unless they were asked for in the same breath)
  const wanted = patch.for ?? (other ? span.for : move.for);
  const length = Math.min(Math.max(wanted, Math.min(span.min, room)), span.max, room);
  const at = Math.min(Math.max(item.start, patch.at ?? move.at), item.end - length);
  const range = MOVE_AMOUNTS[kind];
  const amount = !range ? undefined : patch.strength ? range[STRENGTHS.indexOf(patch.strength)] : (patch.amount ?? (other ? undefined : move.amount));
  const sharp = SHARP_KINDS.includes(kind) && (patch.sharp ?? move.sharp);
  const { sharp: _sharp, amount: _amount, ...rest } = move;
  return { ...rest, kind, at: hundredth(at), for: hundredth(length), ...(sharp ? { sharp: true } : {}), ...(amount !== undefined ? { amount: amountOf({ kind, amount }) } : {}) };
}

/** A move as the timeline draws it: its passage, its kind and its own settings, where it plays in the whole video (frames) */
export interface LaneMove {
  id: string;
  item: string;
  kind: MoveType;
  from: number;
  to: number;
  sharp: boolean;
  strength: Strength | null;
}

/** The moves of a video on its clock: `marks[i]` is where passage `i` (of `items`) plays, frames */
export function laneMoves(items: CompilationItem[], marks: { id: string; from: number; to: number }[], moves: Record<string, ItemMove[]>, fps: number): LaneMove[] {
  const lane: LaneMove[] = [];
  for (const item of items) {
    const mark = marks.find((one) => one.id === item.id);
    if (!mark) continue;
    for (const move of moves[item.id] ?? []) {
      const from = Math.min(mark.to - 1, Math.max(mark.from, mark.from + Math.round((move.at - item.start) * fps)));
      const to = Math.min(mark.to, from + Math.max(1, Math.round(move.for * fps)));
      lane.push({ id: move.id, item: item.id, kind: move.kind, from, to, sharp: !!move.sharp && SHARP_KINDS.includes(move.kind), strength: strengthOf(move) });
    }
  }
  return lane.sort((a, b) => a.from - b.from);
}

/** The row each mark is drawn on so that two that overlap are both seen (0 or 1) */
export function laneRows(moves: LaneMove[]): number[] {
  const ends = [-1, -1];
  return moves.map((move) => {
    const row = move.from >= ends[0] ? 0 : move.from >= ends[1] ? 1 : ends[0] <= ends[1] ? 0 : 1;
    ends[row] = Math.max(ends[row], move.to);
    return row;
  });
}
