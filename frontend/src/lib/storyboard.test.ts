import { describe, expect, it } from "vitest";
import type { TwitchStoryboard } from "./api";
import { evenFrames, frameAt, tileStyle } from "./storyboard";

const sb: TwitchStoryboard = { images: ["a.jpg", "b.jpg"], cols: 5, rows: 10, count: 100, width: 220, height: 124, interval: 115 };

describe("storyboard sprites", () => {
  it("points at the right sheet and cell", () => {
    expect(tileStyle(sb, 0)).toMatchObject({ backgroundImage: 'url("a.jpg")', backgroundPosition: "0% 0%" });
    // Frame 57 = sheet 2, cell 7 = column 2, row 1
    expect(tileStyle(sb, 57)).toMatchObject({ backgroundImage: 'url("b.jpg")', backgroundPosition: "50% 11.11111111111111%" });
    expect(tileStyle(sb, 500).backgroundImage).toBe('url("b.jpg")');
  });

  it("maps VOD time to frames", () => {
    expect(frameAt(sb, 0)).toBe(0);
    expect(frameAt(sb, 230)).toBe(2);
    expect(frameAt(sb, 1e6)).toBe(99);
    expect(evenFrames(sb, 4)).toEqual([13, 38, 63, 88]);
  });
});
