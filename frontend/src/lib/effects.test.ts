import { describe, expect, it } from "vitest";
import { cleanEffects, effectAt, isEffectLevel, placeEffects, type SegmentEffect } from "./effects";

const word = (text: string, start: number, length = 0.3) => ({ word: text, start, end: start + length });
/** "Oh mais y'a des portes de chaque côté! Oh putain! Nathan!" said from `at` */
const line = (texts: string[], at: number, each = 0.35) => texts.map((text, i) => word(text, at + i * each));
const scaleOf = (transform: string) => Number(/scale\(([\d.]+)\)/.exec(transform)![1]);
const shiftOf = (transform: string) => /translate\((-?[\d.]+)%, (-?[\d.]+)%\)/.exec(transform)!.slice(1).map(Number);

describe("where a montage's effects go", () => {
  it("plays plain when no level is chosen", () => {
    const pieces = [{ duration: 6, words: line(["Oh", "putain!"], 2) }, { duration: 8 }];
    expect(placeEffects(pieces, null)).toEqual([[], []]);
    expect(placeEffects(pieces, undefined)).toEqual([[], []]);
    expect(placeEffects(pieces, "wild" as never)).toEqual([[], []]);
    expect([isEffectLevel("light"), isEffectLevel("strong"), isEffectLevel("off"), isEffectLevel(null)]).toEqual([true, true, false, false]);
  });

  it("plays every other piece a little closer, so a cut reads as a cut", () => {
    const placed = placeEffects([{ duration: 4 }, { duration: 5 }, { duration: 3 }, { duration: 6 }], "light");
    expect(placed.map((effects) => effects.filter((e) => e.kind === "zoom"))).toEqual([[], [{ kind: "zoom", at: 0, for: 5, amount: 1.05 }], [], [{ kind: "zoom", at: 0, for: 6, amount: 1.05 }]]);
    // A single piece (a clip): nothing to tell apart
    expect(placeEffects([{ duration: 30 }], "light")).toEqual([[]]);
  });

  it("punches in on the line that lands, where its last words start", () => {
    // « Oh mais y'a des portes de chaque côté! » then, after a pause, « Oh putain! Nathan! »
    const words = [...line(["Oh", "mais", "y'a", "des", "portes", "de", "chaque", "côté!"], 1), ...line(["Oh", "putain!"], 5.2), ...line(["Nathan!"], 6.4)];
    const [light] = placeEffects([{ duration: 9, words }], "light");
    // One punch, on the last line that lands (the payoff): « Nathan! »
    expect(light).toEqual([{ kind: "punch", at: 6.35, for: 0.8, amount: 1.08 }]);
    const [strong] = placeEffects([{ duration: 9, words }], "strong");
    // The strong level also takes the first one, far enough from it (on « de chaque côté! »), each with a tremor
    expect(strong.map((e) => [e.kind, e.at])).toEqual([["punch", 2.7], ["shake", 2.7], ["punch", 6.35], ["shake", 6.35]]);
    expect(strong.find((e) => e.kind === "punch")!.amount).toBeGreaterThan(light[0].amount);
  });

  it("leaves a short piece and the ends of a piece alone", () => {
    expect(placeEffects([{ duration: 2, words: line(["Non!"], 1) }], "strong")).toEqual([[]]);
    // A line that lands in the first or the last half second: no room to punch
    expect(placeEffects([{ duration: 6, words: [word("Quoi?", 0.1), word("Stop!", 5.8, 0.15)] }], "light")).toEqual([[]]);
    // No word that lands: no punch (a piece of plain talk stays plain)
    expect(placeEffects([{ duration: 6, words: line(["on", "va", "au", "port."], 1) }], "light")).toEqual([[]]);
    // A punch near the end is held only as long as the piece lasts
    const [late] = placeEffects([{ duration: 4, words: [word("Non!", 3.4)] }], "light");
    expect(late).toEqual([{ kind: "punch", at: 3.35, for: 0.65, amount: 1.08 }]);
  });

  it("takes the instants someone named over the words (a clip's key moments)", () => {
    const [effects] = placeEffects([{ duration: 40, words: line(["Non!"], 3), beats: [31.5, 12, 0.2] }], "strong");
    expect(effects.filter((e) => e.kind === "punch").map((e) => e.at)).toEqual([11.95, 31.45]);
  });
});

describe("what an effect does to the picture", () => {
  const fps = 30;

  it("does nothing outside its time, and nothing at all without effects", () => {
    const zoom: SegmentEffect = { kind: "zoom", at: 2, for: 3, amount: 1.05 };
    expect(effectAt(undefined, 10, fps)).toBeNull();
    expect(effectAt([], 10, fps)).toBeNull();
    expect(effectAt([zoom], 59, fps)).toBeNull();
    expect(effectAt([zoom], 150, fps)).toBeNull();
    expect(scaleOf(effectAt([zoom], 60, fps)!.transform)).toBe(1.05);
    expect(scaleOf(effectAt([zoom], 149, fps)!.transform)).toBe(1.05);
  });

  it("punches in fast, holds, and comes back", () => {
    const punch: SegmentEffect = { kind: "punch", at: 1, for: 0.8, amount: 1.1 };
    const at = (seconds: number) => scaleOf(effectAt([punch], Math.round(seconds * fps), fps)!.transform);
    expect(at(1)).toBe(1); // (its first frame is the cut-in: it starts from the picture as it was)
    expect(at(1.1)).toBeCloseTo(1.1, 3); // there in a tenth of a second
    expect(at(1.4)).toBeCloseTo(1.1, 3);
    expect(at(1.7)).toBeGreaterThan(1.05);
    expect(at(1.77)).toBeLessThan(1.06); // on its way back
    expect(effectAt([punch], Math.round(1.8 * fps), fps)).toBeNull();
  });

  it("shakes less and less, the picture closer so that its edges never show", () => {
    const shake: SegmentEffect = { kind: "shake", at: 0, for: 0.4, amount: 0.01 };
    const early = effectAt([shake], 1, fps)!.transform;
    const late = effectAt([shake], 11, fps)!.transform;
    const size = (transform: string) => Math.hypot(...shiftOf(transform));
    expect(size(early)).toBeGreaterThan(size(late));
    // Never further than what the closer picture hides: 1 % each way against 2.5 % of zoom
    for (let frame = 0; frame < 12; frame++) {
      const transform = effectAt([shake], frame, fps)!.transform;
      expect(Math.max(...shiftOf(transform).map(Math.abs))).toBeLessThanOrEqual(1);
      expect(scaleOf(transform)).toBe(1.025);
    }
  });

  it("adds up a zoom, a punch and a shake that fall together", () => {
    const together: SegmentEffect[] = [{ kind: "zoom", at: 0, for: 5, amount: 1.05 }, { kind: "punch", at: 2, for: 0.8, amount: 1.08 }, { kind: "shake", at: 2, for: 0.35, amount: 0.008 }];
    expect(scaleOf(effectAt(together, 30, fps)!.transform)).toBe(1.05);
    expect(scaleOf(effectAt(together, Math.round(2.2 * fps), fps)!.transform)).toBeCloseTo(1.05 * 1.08 * 1.02, 3);
  });
});

describe("effects as the renderer takes them", () => {
  it("keeps what it knows and drops the rest", () => {
    expect(
      cleanEffects([
        { kind: "zoom", at: 0, for: 5, amount: 1.05 },
        { kind: "punch", at: "2", for: 0.8, amount: 1.14 },
        { kind: "shake", at: 2, for: 0.35, amount: 0.008 },
        { kind: "spin", at: 0, for: 1, amount: 1.1 },
        { kind: "zoom", at: -1, for: 5, amount: 1.05 },
        { kind: "zoom", at: 0, for: 0, amount: 1.05 },
        { kind: "zoom", at: 0, for: 5, amount: 3 }, // would show nothing but a corner
        { kind: "zoom", at: 0, for: 5, amount: 0.5 }, // would show the picture's edges
        { kind: "shake", at: 0, for: 1, amount: 0.5 },
        null,
        "zoom",
      ]),
    ).toEqual([
      { kind: "zoom", at: 0, for: 5, amount: 1.05 },
      { kind: "punch", at: 2, for: 0.8, amount: 1.14 },
      { kind: "shake", at: 2, for: 0.35, amount: 0.008 },
    ]);
    expect(cleanEffects(undefined)).toEqual([]);
    expect(cleanEffects(Array.from({ length: 40 }, () => ({ kind: "zoom", at: 0, for: 1, amount: 1.05 })))).toHaveLength(12);
  });
});
