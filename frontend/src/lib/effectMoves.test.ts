import { describe, expect, it } from "vitest";
import { seenMoves, videoMoves } from "./effectMoves";
import type { SegmentEffect } from "./effects";

describe("the moves of a video, as the timeline shows them", () => {
  const fps = 30;
  // Two passages: the first plays from frame 45 (after an intro) for 20 s, the second for 6 s
  const marks = [{ from: 45, to: 645 }, { from: 645, to: 825 }];
  const first: SegmentEffect[] = [
    { kind: "ease", at: 2.45, for: 3.4, amount: 1.06 },
    { kind: "punch", at: 12.25, for: 1.7, amount: 1.24, on: "cam" },
    { kind: "shake", at: 12.25, for: 0.4, amount: 0.006, on: "cam" },
  ];
  const second: SegmentEffect[] = [{ kind: "zoom", at: 0, for: 6, amount: 1.08 }, { kind: "punch", at: 4.95, for: 1.3, amount: 1.12 }];

  it("puts each move on the video's clock and says what it is for", () => {
    const moves = videoMoves([{ effects: first }, { effects: second }], marks, fps);
    expect(moves).toEqual([
      // A slow close-up on plain talk
      { kind: "calm", from: 45 + 74, to: 45 + 74 + 102, shake: false },
      // The webcam comes closer on a shout; its tremor is not a move of its own
      { kind: "shout", from: 45 + 368, to: 45 + 368 + 51, shake: true },
      // The second passage plays a little closer from end to end, and comes closer on a line that lands
      { kind: "closer", from: 645, to: 825, shake: false },
      { kind: "line", from: 645 + 149, to: 825, shake: false },
    ]);
    // (the last one would run past its passage: it stops with it)
    expect(seenMoves(moves)).toBe(3);
  });

  it("has nothing to show for a video that plays plain", () => {
    expect(videoMoves([{}, { effects: [] }], marks, fps)).toEqual([]);
    expect(videoMoves([{ effects: first }], [], fps)).toEqual([]);
    expect(seenMoves([])).toBe(0);
  });
});
