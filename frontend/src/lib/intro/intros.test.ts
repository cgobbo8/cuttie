import { describe, expect, it } from "vitest";
import { backOut, between, defaultIntroSound, INTRO_IDS, INTRO_SOUND_IDS, introFade, introSeconds, introSound, introSpan, introVolume, isIntro, isIntroSound, NO_SOUND, titleLines } from "./intros";

describe("the intros of a compilation", () => {
  it("knows its styles and how long each holds the screen, at any frame rate", () => {
    expect(INTRO_IDS).toEqual(["slam", "bands", "glitch", "neon", "rush", "sticker", "split"]);
    expect(isIntro("slam") && !isIntro("wobble") && !isIntro(undefined)).toBe(true);
    expect(introSpan("slam", 30)).toEqual({ hold: 48, out: 8 });
    // Twice the frames at 60 a second: the same time on screen
    expect(introSpan("slam", 60)).toEqual({ hold: 96, out: 16 });
    // Every intro is short: the video starts within about two seconds
    for (const id of INTRO_IDS) {
      const { hold, out } = introSpan(id, 30);
      expect(hold).toBeGreaterThanOrEqual(40);
      expect(hold).toBeLessThanOrEqual(62);
      expect(out).toBeGreaterThan(0);
    }
  });

  it("adds its length to the video, and nothing when there is none", () => {
    expect(introSeconds({ style: "slam" })).toBe(1.6);
    expect(introSeconds(undefined)).toBe(0);
    expect(introSeconds(null)).toBe(0);
    // An intro of a newer version this app doesn't draw: not counted
    expect(introSeconds({ style: "wobble" })).toBe(0);
  });

  it("plays the sound of its style unless another is chosen, or none", () => {
    expect(INTRO_IDS.map(defaultIntroSound)).toEqual([...INTRO_SOUND_IDS]);
    expect(introSound({ style: "slam" })).toBe("boom");
    expect(introSound({ style: "slam", sound: "drum" })).toBe("drum");
    expect(introSound({ style: "slam", sound: NO_SOUND })).toBeNull();
    // A sound nobody knows: the style's own
    expect(introSound({ style: "neon", sound: "kazoo" })).toBe("shine");
    expect(introSound(null)).toBeNull();
    expect(isIntroSound("boom") && !isIntroSound("kazoo")).toBe(true);
  });

  it("fades its sound out as the video starts", () => {
    const { from, frames } = introFade("slam", 30);
    expect(from).toBe(48);
    expect(frames).toBe(8 + 24);
    expect(introVolume(0, "slam", 30)).toBe(1);
    expect(introVolume(48, "slam", 30)).toBe(1);
    expect(introVolume(48 + 16, "slam", 30)).toBeCloseTo(0.5);
    expect(introVolume(200, "slam", 30)).toBe(0);
  });

  it("cuts the title in lines that fit, smaller when it is long", () => {
    expect(titleLines("De calme à débordés", "Luckiest Guy")).toEqual({ lines: ["DE CALME À", "DÉBORDÉS"], size: 139 });
    const long = titleLines("Brigade du tigre, bagarres et pétages de plombs", "Anton");
    expect(long.lines.length).toBeLessThanOrEqual(4);
    expect(long.lines.join(" ")).toBe("BRIGADE DU TIGRE, BAGARRES ET PÉTAGES DE PLOMBS");
    // The longest line still fits in the 860 px it has (Anton's letters are about 0.47 of their size wide)
    expect(Math.max(...long.lines.map((line) => line.length)) * 0.47 * long.size).toBeLessThanOrEqual(861);
    // One short word: big, but not bigger than the frame bears
    expect(titleLines("GG", "Anton").size).toBe(190);
    // A font nobody measured: a safe width
    expect(titleLines("De calme à débordés", "Comic Sans").size).toBe(139);
    expect(titleLines("   ").lines).toEqual([]);
  });

  it("moves between two frames, and bounces past its place", () => {
    expect([between(5, 10, 20), between(15, 10, 20), between(30, 10, 20)]).toEqual([0, 0.5, 1]);
    expect(backOut(0)).toBeCloseTo(0);
    expect(backOut(1)).toBeCloseTo(1);
    // Past its place on the way
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => backOut(t)))).toBeGreaterThan(1.05);
  });
});
