import { describe, expect, it } from "vitest";
import { soundHeights } from "./laneSound";

describe("the live's sound on the timeline", () => {
  it("stretches what is heard between the calm of the video and its loudest moment", () => {
    // A live is never silent: measured, everything sits between 40 and 84 of 100
    const levels = [44, 40, 46, 42, 45, 43, 84, 60, 41, 44, 47, 42, 45, 43, 46, 44, 42, 45, 43, 44, 46];
    const drawn = soundHeights(levels.map((level, k) => [k * 6, level]));
    const heights = drawn.map(([, height]) => height);
    // The shout takes the whole lane, the calm stays low, and what is in between is nearer the calm
    expect(heights[6]).toBe(100);
    expect(Math.max(...heights.filter((_, k) => k !== 6 && k !== 7))).toBeLessThan(20);
    expect(heights[7]).toBeGreaterThan(30);
    expect(heights[7]).toBeLessThan(50);
    // Never nothing under a passage, and the frames are left alone
    expect(Math.min(...heights)).toBe(10);
    expect(drawn.map(([frame]) => frame)).toEqual(levels.map((_, k) => k * 6));
  });

  it("keeps the edges of each passage on the ground", () => {
    const drawn = soundHeights([[0, 0], [0, 50], [30, 80], [60, 0], [60, 0], [60, 55], [90, 0]]);
    expect(drawn.map(([, height]) => height)).toEqual([0, 10, 100, 0, 0, 16, 0]);
  });

  it("draws an even sound flat, and nothing when nothing was measured", () => {
    expect(soundHeights([[0, 0], [0, 61], [30, 62], [60, 63], [90, 0]]).map(([, height]) => height)).toEqual([0, 50, 50, 50, 0]);
    expect(soundHeights([])).toEqual([]);
    expect(soundHeights([[0, 0], [30, 0]])).toEqual([[0, 0], [30, 0]]);
  });
});
