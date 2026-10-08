import { describe, expect, it } from "vitest";
import { cropStyle, gameRegion } from "./SignaturePreview";

const FRAME = { w: 1920, h: 1080 };
const CAM = { x: 1518, y: 0, w: 402, h: 446 };

describe("Signature preview crops", () => {
  it("keeps the gameplay left of a top-right webcam", () => {
    expect(gameRegion(CAM, FRAME)).toEqual({ x: 0, y: 0, w: 1518, h: 1080 });
    expect(gameRegion({ x: 0, y: 600, w: 400, h: 480 }, FRAME)).toEqual({ x: 400, y: 0, w: 1520, h: 1080 });
    expect(gameRegion(null, FRAME)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("scales the frame so the region fills the box", () => {
    // Same aspect as the region: no extra cropping
    const style = cropStyle({ x: 960, y: 0, w: 960, h: 540 }, FRAME, 960 / 540);
    expect(style.width).toBe("200%");
    expect(style.height).toBe("200%");
    expect(style.left).toBe("-100%");
    expect(style.top).toBe("0%");
  });

  it("center-crops a region wider than the box", () => {
    const style = cropStyle({ x: 0, y: 0, w: 1920, h: 1080 }, FRAME, 1);
    // 1080x1080 window centered horizontally
    expect(parseFloat(String(style.width))).toBeCloseTo(177.78, 1);
    expect(parseFloat(String(style.left))).toBeCloseTo(-38.89, 1);
  });
});
