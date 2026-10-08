import { describe, expect, it } from "vitest";
import { contrast, hexToRgb, inkOn, uiAccent } from "./color";

describe("brand accent colors", () => {
  it("parses hex colors", () => {
    expect(hexToRgb("#42BF85")).toEqual([66, 191, 133]);
    expect(hexToRgb("163f5a")).toEqual([22, 63, 90]);
    expect(hexToRgb("green")).toBeNull();
  });

  it("puts dark text on light accents and white text on dark ones", () => {
    expect(inkOn("#42BF85")).toBe("#07140E");
    expect(inkOn("#FFD21F")).toBe("#07140E");
    expect(inkOn("#163F5A")).toBe("#FFFFFF");
  });

  it("keeps readable accents as they are", () => {
    expect(uiAccent("#42BF85")).toBe("#42BF85");
  });

  it("lifts a too-dark brand color so it reads on the dark ground", () => {
    const lifted = uiAccent("#163F5A");
    expect(lifted).not.toBe("#163F5A");
    expect(contrast(hexToRgb(lifted)!, [11, 11, 12])).toBeGreaterThanOrEqual(5);
  });
});
