import { describe, expect, it } from "vitest";
import { backOut, beatSeconds, BEATS, between, CLASSIC_JINGLES, DEFAULT_HOOK_LOOK, defaultIntroSound, GTA_JINGLES, hookLook, INTRO_IDS, INTRO_PACKS, INTRO_SOUND_IDS, introFade, introPack, introRate, introSeconds, introSound, introSpan, introVolume, isIntro, isIntroSound, isJingle, JINGLE_IDS, NO_SOUND, titleLines } from "./intros";

describe("the intros of a compilation", () => {
  it("knows its styles and how long each holds the screen, at any frame rate", () => {
    // Cuttie's twelve jingles: three full rows of four in the picker
    expect(CLASSIC_JINGLES).toEqual(["slam", "bands", "glitch", "neon", "rush", "sticker", "split", "arcade", "news", "shatter", "countdown", "fuse"]);
    // The GTA pack: one more row of four
    expect(GTA_JINGLES).toEqual(["sunset", "miami", "wanted", "cover"]);
    expect(JINGLE_IDS).toEqual([...CLASSIC_JINGLES, ...GTA_JINGLES]);
    // Every jingle is in one pack, shown in full rows of four
    expect(INTRO_PACKS.flatMap((pack) => pack.jingles)).toEqual([...JINGLE_IDS]);
    for (const pack of INTRO_PACKS) expect(pack.jingles.length % 4).toBe(0);
    expect([introPack("fuse"), introPack("wanted"), introPack("wobble"), introPack(null)]).toEqual(["cuttie", "gta", "cuttie", "cuttie"]);
    // An intro is one of them, or the hook (which is no jingle)
    expect(INTRO_IDS).toEqual(["hook", ...JINGLE_IDS]);
    expect(isJingle("fuse") && isJingle("sticker") && !isJingle("hook") && !isJingle("wobble")).toBe(true);
    expect(isIntro("slam") && !isIntro("wobble") && !isIntro(undefined)).toBe(true);
    expect(introSpan("slam", 30)).toEqual({ hold: 48, out: 8 });
    // Twice the frames at 60 a second: the same time on screen
    expect(introSpan("slam", 60)).toEqual({ hold: 96, out: 16 });
    // Every jingle is short: the video starts within about two seconds
    for (const id of JINGLE_IDS) {
      const { hold, out } = introSpan(id, 30);
      expect(hold).toBeGreaterThanOrEqual(40);
      expect(hold).toBeLessThanOrEqual(62);
      expect(out).toBeGreaterThan(0);
    }
  });

  it("holds the screen for as long as its moment when it is a hook", () => {
    // The moment of the video it plays lasts 4.2 s: so does the intro, at any frame rate; it leaves as fast as a jingle
    expect(introSpan("hook", 30, 4.2)).toEqual({ hold: 126, out: 8 });
    expect(introSpan("hook", 60, 4.2)).toEqual({ hold: 252, out: 16 });
    // Without a moment (the picker's sketch): five seconds
    expect(introSpan("hook", 30)).toEqual({ hold: 150, out: 8 });
    // A jingle is as long as it is, whatever is said
    expect(introSpan("slam", 30, 4.2)).toEqual({ hold: 48, out: 8 });
    // What it adds to the video: its moment, nothing while it has none
    expect(introSeconds({ style: "hook", hook: { item: "a", start: 100, end: 104.5 } })).toBe(4.5);
    expect(introSeconds({ style: "hook" })).toBe(0);
    // Its moment is heard: it plays no sound of its own, even one chosen for another style before
    expect(defaultIntroSound("hook")).toBeNull();
    expect(introSound({ style: "hook" })).toBeNull();
    expect(introSound({ style: "hook", sound: "boom" })).toBeNull();
    // What frames its moment: one of twelve looks, each named after a jingle; none said, or one nobody knows: the fuse
    expect(hookLook({ look: "neon" })).toBe("neon");
    expect([hookLook({}), hookLook(null), hookLook({ look: "wobble" }), hookLook({ look: "hook" })]).toEqual(["fuse", "fuse", "fuse", "fuse"]);
    expect(DEFAULT_HOOK_LOOK).toBe("fuse");
  });

  it("follows the music it plays on: a few of its beats, so that the video starts on one", () => {
    // 120 beats a minute: four beats are two seconds, a length this jingle can have
    expect(beatSeconds("sunset", 120)).toBe(2);
    expect(introSpan("sunset", 30, 2)).toEqual({ hold: 60, out: 10 });
    expect(introSpan("sunset", 60, 2)).toEqual({ hold: 120, out: 20 });
    // It was written on 56 frames: it plays that much slower, and its sound with it
    expect(introRate("sunset", 2)).toBeCloseTo(56 / 60);
    expect(introRate("sunset")).toBe(1);
    // A slow track: two of its beats; a very fast one: eight
    expect(beatSeconds("sunset", 72)).toBe(1.667);
    expect(beatSeconds("sunset", 200)).toBe(2.4);
    // Whatever the tempo of a track, the jingle lasts 2, 4 or 8 of its beats and is never played far from how it was written
    for (const id of JINGLE_IDS) {
      const written = introSpan(id, 30).hold / 30;
      for (let bpm = 60; bpm <= 200; bpm++) {
        const seconds = beatSeconds(id, bpm);
        expect(seconds, `${id} at ${bpm}`).not.toBeNull();
        expect(BEATS.counts).toContain(Math.round((seconds! * bpm) / 60));
        expect(seconds! / written).toBeGreaterThanOrEqual(BEATS.fastest - 0.001);
        expect(seconds! / written).toBeLessThanOrEqual(BEATS.slowest + 0.001);
      }
    }
    // No music, no tempo, a tempo nobody plays at, or a hook (its moment says how long it is): as written
    expect([beatSeconds("sunset", null), beatSeconds("sunset", undefined), beatSeconds("sunset", 0), beatSeconds("sunset", 900), beatSeconds("hook", 120), beatSeconds("wobble", 120)]).toEqual([null, null, null, null, null, null]);
    // The video is that much longer, and the jingle's sound fades from where the video starts
    expect(introSeconds({ style: "sunset" }, 120)).toBe(2);
    expect(introSeconds({ style: "sunset" })).toBeCloseTo(56 / 30);
    expect(introSeconds({ style: "sunset" }, null)).toBeCloseTo(56 / 30);
    expect(introFade("sunset", 30, 2)).toEqual({ from: 60, frames: 10 + 24 });
    expect(introVolume(60, "sunset", 30, 2)).toBe(1);
    expect(introVolume(60 + 17, "sunset", 30, 2)).toBeCloseTo(0.5);
    // A length no jingle can be played at is not followed
    expect(introSpan("sunset", 30, 4.2)).toEqual({ hold: 56, out: 10 });
    expect(introRate("sunset", 4.2)).toBe(1);
  });

  it("adds its length to the video, and nothing when there is none", () => {
    expect(introSeconds({ style: "slam" })).toBe(1.6);
    expect(introSeconds(undefined)).toBe(0);
    expect(introSeconds(null)).toBe(0);
    // An intro of a newer version this app doesn't draw: not counted
    expect(introSeconds({ style: "wobble" })).toBe(0);
  });

  it("plays the sound of its style unless another is chosen, or none", () => {
    // Each jingle has its own
    expect(JINGLE_IDS.map(defaultIntroSound)).toEqual([...INTRO_SOUND_IDS]);
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
    // Written in small letters, which are narrower: the caller says how wide they are, and the title is bigger for it
    expect(titleLines("Brigade du tigre", "", 12, 4, 0.7).size).toBeGreaterThan(titleLines("Brigade du tigre", "Rammetto One").size);
  });

  it("moves between two frames, and bounces past its place", () => {
    expect([between(5, 10, 20), between(15, 10, 20), between(30, 10, 20)]).toEqual([0, 0.5, 1]);
    expect(backOut(0)).toBeCloseTo(0);
    expect(backOut(1)).toBeCloseTo(1);
    // Past its place on the way
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => backOut(t)))).toBeGreaterThan(1.05);
  });
});
