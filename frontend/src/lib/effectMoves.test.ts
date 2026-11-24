import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CompilationItem } from "./api";
import { amountOf, changedMove, CUSTOM_EFFECTS, effectiveMoves, effectsFromMoves, laneMoves, laneRows, MOVE_SPANS, MOVE_TYPES, movesFromEffects, newMove, STRENGTHS, strengthOf, withLevel, withMoves, type ItemMove } from "./effectMoves";
import type { SegmentEffect } from "./effects";

const item = (id: string, start: number, end: number, more: Partial<CompilationItem> = {}): CompilationItem => ({ id, start, end, text: "", why: "", sources: ["voice"], ...more });
const move = (id: string, kind: ItemMove["kind"], at: number, length: number, more: Partial<ItemMove> = {}): ItemMove => ({ id, kind, at, for: length, ...more });

describe("a passage's own moves", () => {
  // A passage of 20 s, from 1:40 of its live
  const passage = item("passage001", 100, 120);

  it("plays each as the renderer's effect, on the piece's own clock", () => {
    const moves = [move("a", "cam", 112.25, 1.7), move("b", "slow", 102.45, 3.4), move("c", "shake", 112.25, 0.4), move("d", "pulse", 105, 0.8), move("e", "flash", 108, 0.35), move("f", "gray", 115, 2.5), move("g", "zoom", 118, 1.3)];
    expect(effectsFromMoves(moves, passage)).toEqual<SegmentEffect[]>([
      { kind: "ease", at: 2.45, for: 3.4, amount: 1.1 },
      { kind: "pulse", at: 5, for: 0.8, amount: 1.08 },
      { kind: "flash", at: 8, for: 0.35, amount: 1 },
      // On the webcam, the face; its tremor with it
      { kind: "punch", at: 12.25, for: 1.7, amount: 1.2, on: "cam" },
      { kind: "shake", at: 12.25, for: 0.4, amount: 0.006 },
      { kind: "gray", at: 15, for: 2.5, amount: 1 },
      { kind: "punch", at: 18, for: 1.3, amount: 1.12 },
    ]);
  });

  it("is cut in and out when asked, and goes as far as asked", () => {
    // « Net »: the picture is at that size for the whole stretch, with no way in nor out
    expect(effectsFromMoves([move("a", "cam", 105, 2, { sharp: true, amount: 1.3 })], passage)).toEqual([{ kind: "zoom", at: 5, for: 2, amount: 1.3, on: "cam" }]);
    expect(effectsFromMoves([move("a", "slow", 105, 3, { sharp: true })], passage)).toEqual([{ kind: "zoom", at: 5, for: 3, amount: 1.1 }]);
    // (a tremor has no such thing as sharp, and what it is asked stays within what its kind allows)
    expect(effectsFromMoves([move("a", "shake", 105, 0.4, { sharp: true, amount: 0.5 })], passage)).toEqual([{ kind: "shake", at: 5, for: 0.4, amount: 0.012 }]);
    expect(amountOf(move("a", "zoom", 0, 1, { amount: 9 }))).toBe(1.3);
    expect(amountOf(move("a", "flash", 0, 1, { amount: 9 }))).toBe(1);
    // Its strength, as one of the three settings
    expect([strengthOf(move("a", "cam", 0, 1)), strengthOf(move("a", "cam", 0, 1, { amount: 1.13 })), strengthOf(move("a", "cam", 0, 1, { amount: 1.29 })), strengthOf(move("a", "gray", 0, 1))]).toEqual(["normal", "soft", "strong", null]);
  });

  it("leaves out what is outside the passage, and stops a move with it", () => {
    // (cut again since: one move is before it now, one after; one starts in it and would run past its end)
    const moves = [move("a", "zoom", 95, 1.3), move("b", "zoom", 121, 1.3), move("c", "slow", 118.5, 3.4)];
    expect(effectsFromMoves(moves, passage)).toEqual([{ kind: "ease", at: 18.5, for: 1.5, amount: 1.1 }]);
    expect(effectsFromMoves(undefined, passage)).toEqual([]);
  });

  it("reads back what was placed for a piece, as it played", () => {
    const placed: SegmentEffect[] = [
      { kind: "zoom", at: 0, for: 20, amount: 1.05 },
      { kind: "ease", at: 2.45, for: 3.4, amount: 1.06 },
      { kind: "punch", at: 12.25, for: 1.7, amount: 1.24, on: "cam" },
      { kind: "shake", at: 12.25, for: 0.4, amount: 0.006, on: "cam" },
      { kind: "punch", at: 17, for: 1.3, amount: 1.12 },
    ];
    const read = movesFromEffects(placed, passage);
    // (a piece that only plays a little closer has no move for that)
    expect(read).toEqual([
      { id: "passaa0", kind: "slow", at: 102.45, for: 3.4, amount: 1.06 },
      { id: "passaa1", kind: "cam", at: 112.25, for: 1.7, amount: 1.24 },
      { id: "passaa2", kind: "shake", at: 112.25, for: 0.4, amount: 0.006 },
      { id: "passaa3", kind: "zoom", at: 117, for: 1.3, amount: 1.12 },
    ]);
    // Made the passage's own, they play as they did
    expect(effectsFromMoves(read, passage)).toEqual([
      { kind: "ease", at: 2.45, for: 3.4, amount: 1.06 },
      { kind: "punch", at: 12.25, for: 1.7, amount: 1.24, on: "cam" },
      { kind: "shake", at: 12.25, for: 0.4, amount: 0.006 },
      { kind: "punch", at: 17, for: 1.3, amount: 1.12 },
    ]);
  });

  it("puts a new one down inside the passage, at the length of its kind", () => {
    expect(newMove("cam", 110, passage)).toMatchObject({ kind: "cam", at: 110, for: 1.7 });
    // (too close to the end: it starts earlier, to play whole)
    expect(newMove("slow", 119, passage)).toMatchObject({ at: 116.6, for: 3.4 });
    expect(newMove("zoom", 90, passage)).toMatchObject({ at: 100 });
    // A passage shorter than the move: all of it
    expect(newMove("slow", 0, item("short", 10, 12))).toMatchObject({ at: 10, for: 2 });
    expect(newMove("flash", 110, passage).id).toMatch(/^[a-z0-9]{8}$/);
  });

  it("changes one within what its kind and its passage allow", () => {
    const zoom = move("a", "zoom", 110, 1.3, { amount: 1.2 });
    // Moved, stretched
    expect(changedMove(zoom, { at: 114 }, passage)).toEqual({ id: "a", kind: "zoom", at: 114, for: 1.3, amount: 1.2 });
    expect(changedMove(zoom, { at: 130 }, passage).at).toBe(118.7);
    expect(changedMove(zoom, { for: 0.1 }, passage).for).toBe(MOVE_SPANS.zoom.min);
    expect(changedMove(zoom, { for: 60 }, passage).for).toBe(MOVE_SPANS.zoom.max);
    // Cut in instead of coming smoothly, and back
    expect(changedMove(zoom, { sharp: true }, passage)).toEqual({ id: "a", kind: "zoom", at: 110, for: 1.3, sharp: true, amount: 1.2 });
    expect(changedMove({ ...zoom, sharp: true }, { sharp: false }, passage)).toEqual(zoom);
    // One of the three strengths
    expect(changedMove(zoom, { strength: "soft" }, passage).amount).toBe(1.07);
    // Another kind: its usual length and strength; what does not go with it is let go
    expect(changedMove({ ...zoom, sharp: true }, { kind: "flash" }, passage)).toEqual({ id: "a", kind: "flash", at: 110, for: 0.35 });
    expect(changedMove(zoom, { kind: "slow" }, passage)).toEqual({ id: "a", kind: "slow", at: 110, for: 3.4 });
  });
});

describe("a video's moves, by level or by hand", () => {
  const first = item("first00001", 100, 120);
  const second = item("second0001", 300, 306, { moves: [move("mine", "flash", 302, 0.35)] });
  const video = { effects: "light", sections: [{ id: "s", title: "", query: "", items: [first, second] }] };
  const placed: SegmentEffect[][] = [[{ kind: "punch", at: 4, for: 1.3, amount: 1.08 }], [{ kind: "zoom", at: 0, for: 6, amount: 1.05 }]];

  it("plays what was placed while the video has a level, its passages' own once set by hand", () => {
    expect(effectiveMoves(false, [first, second], placed)).toEqual({ first00001: [{ id: "firsta0", kind: "zoom", at: 104, for: 1.3, amount: 1.08 }], second0001: [] });
    expect(effectiveMoves(true, [first, second], placed)).toEqual({ first00001: [], second0001: [{ id: "mine", kind: "flash", at: 302, for: 0.35 }] });
  });

  it("makes them the passages' own the first time one is touched, and lets them go when a level is chosen again", () => {
    const frozen = withMoves(video, effectiveMoves(false, [first, second], placed));
    expect(frozen.effects).toBe(CUSTOM_EFFECTS);
    expect(frozen.sections[0].items.map((one) => one.moves)).toEqual([[{ id: "firsta0", kind: "zoom", at: 104, for: 1.3, amount: 1.08 }], []]);
    const back = withLevel(frozen, "strong");
    expect(back.effects).toBe("strong");
    expect(back.sections[0].items.every((one) => !("moves" in one))).toBe(true);
    expect("effects" in withLevel(frozen, null)).toBe(false);
  });

  it("draws each on the video's clock, on a second row when two overlap", () => {
    const fps = 30;
    const marks = [{ id: "first00001", from: 45, to: 645 }, { id: "second0001", from: 645, to: 825 }];
    const moves = { first00001: [move("a", "cam", 112, 1.7, { sharp: true }), move("b", "shake", 112, 0.4), move("c", "slow", 119, 3.4)], second0001: [move("d", "flash", 302, 0.35)] };
    const lane = laneMoves([first, second], marks, moves, fps);
    expect(lane).toEqual([
      { id: "a", item: "first00001", kind: "cam", from: 405, to: 456, sharp: true, strength: "normal" },
      { id: "b", item: "first00001", kind: "shake", from: 405, to: 417, sharp: false, strength: "normal" },
      // (it would run past its passage: it stops with it)
      { id: "c", item: "first00001", kind: "slow", from: 615, to: 645, sharp: false, strength: "normal" },
      { id: "d", item: "second0001", kind: "flash", from: 705, to: 716, sharp: false, strength: null },
    ]);
    expect(laneRows(lane)).toEqual([0, 1, 0, 0]);
    // A passage that is not built yet has no mark: its moves wait
    expect(laneMoves([first, second], [marks[0]], moves, fps).map((one) => one.id)).toEqual(["a", "b", "c"]);
  });
});

describe("the same moves on both sides", () => {
  it("are known to the server by the same names", () => {
    const service = readFileSync(path.resolve(__dirname, "../../../api/app/services/compilations.ts"), "utf8");
    expect(service.match(/export const MOVE_TYPES = \[([^\]]+)\]/)?.[1].match(/\w+/g)).toEqual([...MOVE_TYPES]);
    expect(service).toContain(`export const CUSTOM_EFFECTS = '${CUSTOM_EFFECTS}'`);
  });

  it("are named the same to the assistant, with the same three strengths", () => {
    const tools = readFileSync(path.resolve(__dirname, "../../../backend/app/services/assistant_tools.py"), "utf8");
    expect(tools.match(/^EFFECT_KINDS = \(([^)]+)\)/m)?.[1].match(/\w+/g)).toEqual([...MOVE_TYPES]);
    expect(tools.match(/^STRENGTHS = \(([^)]+)\)/m)?.[1].match(/\w+/g)).toEqual([...STRENGTHS]);
  });
});
