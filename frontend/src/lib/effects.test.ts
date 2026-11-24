import { describe, expect, it } from "vitest";
import { cleanEffects, effectAt, EFFECTS_APART, flashAt, isEffectLevel, placeEffects, type SegmentEffect } from "./effects";

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
    const placed = placeEffects([{ duration: 4 }, { duration: 5 }, { duration: 3 }, { duration: 5 }], "light");
    expect(placed).toEqual([[], [{ kind: "zoom", at: 0, for: 5, amount: 1.05 }], [], [{ kind: "zoom", at: 0, for: 5, amount: 1.05 }]]);
    // A single short piece: nothing to tell apart, and no room for a move
    expect(placeEffects([{ duration: 5 }], "light")).toEqual([[]]);
  });

  it("brings the webcam closer where the streamer shouts, the loudest first, never twice within ten seconds", () => {
    // « Bon. » at 2.5 s, « Mais non » at 14 s, « là » at 16 s, « oh » at 26 s; the sound jumps at 14.2, 16, 20 and 26.1 s
    const words = [word("Bon.", 2.5), ...line(["Mais", "non"], 14), word("là", 16), word("oh", 26)];
    const shouts = [{ at: 14.2, over: 14 }, { at: 16, over: 11 }, { at: 20, over: 20 }, { at: 26.1, over: 12 }];
    const [light] = placeEffects([{ duration: 30, words, shouts }], "light");
    expect(light).toEqual([
      // Plain talk at the start: a slow close-up, ten seconds and more before the first shout
      { kind: "ease", at: 2.45, for: 3.4, amount: 1.06 },
      // The shouts someone's voice is in (a word is said around them): the webcam, not the game
      { kind: "punch", at: 14.15, for: 1.7, amount: 1.16, on: "cam" },
      { kind: "punch", at: 26.05, for: 1.7, amount: 1.16, on: "cam" },
    ]);
    // (the one at 16 s is too close to a louder one; the loudest of all, at 20 s, has no word around it: the game's own noise)
    expect(EFFECTS_APART).toBe(10);
    // The strong level comes closer and adds a small tremor to each shout
    const [strong] = placeEffects([{ duration: 30, words, shouts }], "strong");
    expect(strong.map((e) => [e.kind, e.at, e.amount, e.on])).toEqual([
      ["ease", 2.45, 1.1, undefined],
      ["punch", 14.15, 1.24, "cam"],
      ["shake", 14.15, 0.006, "cam"],
      ["punch", 26.05, 1.24, "cam"],
      ["shake", 26.05, 0.006, "cam"],
    ]);
    // A piece whose words are not known keeps its shouts
    expect(placeEffects([{ duration: 12, shouts: [{ at: 6, over: 12 }] }], "light")[0]).toEqual([{ kind: "punch", at: 5.95, for: 1.7, amount: 1.16, on: "cam" }]);
  });

  it("comes closer on the line that lands, where its last words start", () => {
    // « Oh mais y'a des portes de chaque côté! » then, after a pause, « Oh putain! Nathan! »
    const words = [...line(["Oh", "mais", "y'a", "des", "portes", "de", "chaque", "côté!"], 1), ...line(["Oh", "putain!"], 5.2), ...line(["Nathan!"], 6.4)];
    const [light] = placeEffects([{ duration: 9, words }], "light");
    // One move for these nine seconds, on the last line that lands (the payoff): « Nathan! ». The whole picture, less than for a shout
    expect(light).toEqual([{ kind: "punch", at: 6.35, for: 1.3, amount: 1.08 }]);
    const [strong] = placeEffects([{ duration: 9, words }], "strong");
    expect(strong).toEqual([{ kind: "punch", at: 6.35, for: 1.3, amount: 1.12 }]);
  });

  it("keeps ten seconds between two moves from one piece to the next too", () => {
    const placed = placeEffects([{ duration: 6, words: [word("Oui!", 4)] }, { duration: 6, words: [word("Non!", 1)] }, { duration: 8, words: [word("Si!", 6)] }], "light");
    expect(placed).toEqual([
      [{ kind: "punch", at: 3.95, for: 1.3, amount: 1.08 }],
      // (« Non! » comes 3 s after « Oui! » on the video's clock: left alone; the piece only plays a little closer)
      [{ kind: "zoom", at: 0, for: 6, amount: 1.05 }],
      [{ kind: "punch", at: 5.95, for: 1.3, amount: 1.08 }],
    ]);
  });

  it("moves a calm stretch too: a slow close-up every ten seconds, from a line to a later one", () => {
    // A piece nobody speaks in: at even times, never in its last seconds
    expect(placeEffects([{ duration: 30 }], "light")[0]).toEqual([
      { kind: "ease", at: 2.35, for: 3.4, amount: 1.06 },
      { kind: "ease", at: 12.35, for: 3.4, amount: 1.06 },
      { kind: "ease", at: 22.35, for: 3.4, amount: 1.06 },
    ]);
    // Plain talk: each starts with a line, and ends where a later one starts when there is one in reach
    const words = [...line(["Bon,", "on", "arrive."], 1), ...line(["Regarde", "là-bas."], 3), ...line(["Il", "y", "a", "un", "tigre."], 6.2), ...line(["On", "s'en", "va."], 14)];
    expect(placeEffects([{ duration: 20, words }], "light")[0]).toEqual([
      { kind: "ease", at: 2.95, for: 3.2, amount: 1.06 },
      { kind: "ease", at: 13.95, for: 3.4, amount: 1.06 },
    ]);
    for (const effect of placeEffects([{ duration: 31 }], "strong")[0]) expect(effect.at + effect.for).toBeLessThanOrEqual(30.5);
  });

  it("leaves a short piece and the ends of a piece alone", () => {
    expect(placeEffects([{ duration: 2, words: line(["Non!"], 1), shouts: [{ at: 1, over: 15 }] }], "strong")).toEqual([[]]);
    // A line that lands in the first or the last half second: no room to come closer
    expect(placeEffects([{ duration: 6, words: [word("Quoi?", 0.1), word("Stop!", 5.8, 0.15)] }], "light")).toEqual([[]]);
    // A few seconds of plain talk stay plain
    expect(placeEffects([{ duration: 6, words: line(["on", "va", "au", "port."], 1) }], "light")).toEqual([[]]);
    // A move near the end is held only as long as the piece lasts
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

  it("comes closer smoothly, holds, and goes back as smoothly: never a jump", () => {
    const punch: SegmentEffect = { kind: "punch", at: 1, for: 1.3, amount: 1.1 };
    const at = (seconds: number) => scaleOf(effectAt([punch], Math.round(seconds * fps), fps)!.transform);
    expect(at(1)).toBe(1); // (it starts from the picture as it was)
    // Halfway in, it is halfway there
    expect(at(1.13)).toBeGreaterThan(1.03);
    expect(at(1.13)).toBeLessThan(1.07);
    expect(at(1.3)).toBeCloseTo(1.1, 3);
    expect(at(1.8)).toBeCloseTo(1.1, 3);
    // ...and it lands back where it was
    expect(at(2.2)).toBeLessThan(1.03);
    expect(effectAt([punch], Math.round(2.3 * fps), fps)).toBeNull();
    // No frame is far from the one before it
    for (let frame = 30; frame < 68; frame++) expect(Math.abs(scaleOf(effectAt([punch], frame + 1, fps)!.transform) - scaleOf(effectAt([punch], frame, fps)!.transform))).toBeLessThan(0.025);
  });

  it("takes its time for a calm close-up", () => {
    const ease: SegmentEffect = { kind: "ease", at: 2, for: 4, amount: 1.06 };
    const at = (seconds: number) => scaleOf(effectAt([ease], Math.round(seconds * fps), fps)!.transform);
    expect(at(2)).toBe(1);
    expect(at(2.45)).toBeCloseTo(1.03, 2);
    expect(at(4)).toBeCloseTo(1.06, 3);
    expect(at(5.55)).toBeCloseTo(1.03, 2);
  });

  it("moves the webcam alone when the move is made for it", () => {
    const shout: SegmentEffect = { kind: "punch", at: 1, for: 1.7, amount: 1.16, on: "cam" };
    const frame = Math.round(1.5 * fps);
    expect(scaleOf(effectAt([shout], frame, fps, "cam")!.transform)).toBeCloseTo(1.16, 3);
    expect(effectAt([shout], frame, fps, "game")).toBeNull();
    // (a piece with no webcam: its picture takes the move)
    expect(scaleOf(effectAt([shout], frame, fps, "all")!.transform)).toBeCloseTo(1.16, 3);
    expect(scaleOf(effectAt([shout], frame, fps)!.transform)).toBeCloseTo(1.16, 3);
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
    expect(scaleOf(effectAt(together, Math.round(2.3 * fps), fps)!.transform)).toBeCloseTo(1.05 * 1.08 * 1.02, 3);
  });
});

describe("effects as the renderer takes them", () => {
  it("keeps what it knows and drops the rest", () => {
    expect(
      cleanEffects([
        { kind: "zoom", at: 0, for: 5, amount: 1.05 },
        { kind: "ease", at: 6, for: 3.4, amount: 1.06 },
        { kind: "punch", at: "2", for: 1.7, amount: 1.16, on: "cam" },
        { kind: "shake", at: 2, for: 0.4, amount: 0.006, on: "everything" },
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
      { kind: "ease", at: 6, for: 3.4, amount: 1.06 },
      { kind: "punch", at: 2, for: 1.7, amount: 1.16, on: "cam" },
      { kind: "shake", at: 2, for: 0.4, amount: 0.006 },
    ]);
    expect(cleanEffects(undefined)).toEqual([]);
    expect(cleanEffects(Array.from({ length: 200 }, () => ({ kind: "zoom", at: 0, for: 1, amount: 1.05 })))).toHaveLength(80);
    // The ones only a hand puts down
    const byHand = [{ kind: "pulse", at: 1, for: 0.8, amount: 1.08 }, { kind: "gray", at: 2, for: 2.5, amount: 1 }, { kind: "flash", at: 3, for: 0.35, amount: 1 }];
    expect(cleanEffects(byHand)).toEqual(byHand);
  });
});

describe("the effects only a hand puts down", () => {
  const fps = 30;

  it("bounces the picture twice, the second time less, and leaves it as it was", () => {
    const pulse: SegmentEffect[] = [{ kind: "pulse", at: 2, for: 0.8, amount: 1.08 }];
    expect(effectAt(pulse, 59, fps)).toBeNull();
    expect(scaleOf(effectAt(pulse, 60, fps)!.transform)).toBe(1);
    expect(scaleOf(effectAt(pulse, 66, fps)!.transform)).toBe(1.06);
    expect(scaleOf(effectAt(pulse, 72, fps)!.transform)).toBe(1);
    expect(scaleOf(effectAt(pulse, 78, fps)!.transform)).toBe(1.02);
    expect(effectAt(pulse, 84, fps)).toBeNull();
  });

  it("takes the colours away for a moment, and brings them back", () => {
    const gray: SegmentEffect[] = [{ kind: "gray", at: 1, for: 2.5, amount: 1 }];
    // (nothing is moved: the picture stays where it is)
    expect(effectAt(gray, 30, fps)).toEqual({ transform: "translate(0%, 0%) scale(1)" });
    expect(effectAt(gray, 45, fps)).toEqual({ transform: "translate(0%, 0%) scale(1)", filter: "grayscale(1)" });
    const leaving = Number(/grayscale\(([\d.]+)\)/.exec(effectAt(gray, 99, fps)!.filter!)![1]);
    expect(leaving).toBeGreaterThan(0.3);
    expect(leaving).toBeLessThan(0.6);
    expect(effectAt(gray, 105, fps)).toBeNull();
  });

  it("lays a flash over the whole frame, at once and gone by its end, without moving any picture", () => {
    const flash: SegmentEffect[] = [{ kind: "flash", at: 4, for: 0.4, amount: 1 }];
    expect([119, 120, 126, 132].map((frame) => flashAt(flash, frame, fps))).toEqual([0, 0.85, 0.2125, 0]);
    expect(effectAt(flash, 123, fps)).toBeNull();
    expect(flashAt(undefined, 10, fps)).toBe(0);
  });

  it("cuts a zoom in and out when it is told for how long: on the webcam, the game is left alone", () => {
    // « Net »: no way in nor out, the picture is at that size from one frame to the next
    const sharp: SegmentEffect[] = [{ kind: "zoom", at: 5, for: 2, amount: 1.3, on: "cam" }];
    expect(effectAt(sharp, 149, fps, "cam")).toBeNull();
    expect(scaleOf(effectAt(sharp, 150, fps, "cam")!.transform)).toBe(1.3);
    expect(scaleOf(effectAt(sharp, 209, fps, "cam")!.transform)).toBe(1.3);
    expect(effectAt(sharp, 210, fps, "cam")).toBeNull();
    expect(effectAt(sharp, 180, fps, "game")).toBeNull();
  });
});
