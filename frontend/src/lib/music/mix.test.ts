import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import es from "../i18n/es.json";
import fr from "../i18n/fr.json";
import { gainAt, MUSIC_KINDS, MUSIC_LEVELS, MUSICS, musicCurve, musicOf, passageLevel, speechShare, trackGain } from "./mix";

describe("the background music of a video", () => {
  it("has a catalogue where every track says what it is and what it suits", () => {
    expect(MUSICS.length).toBeGreaterThanOrEqual(13);
    expect(new Set(MUSICS.map((track) => track.id)).size).toBe(MUSICS.length);
    for (const track of MUSICS) {
      expect(track.id).toMatch(/^[a-z0-9]{2,24}$/);
      expect(track.kinds.length).toBeGreaterThan(0);
      for (const kind of track.kinds) expect(MUSIC_KINDS).toContain(kind);
      // Started where it is in full swing, well before it ends
      expect(track.start).toBeGreaterThanOrEqual(0);
      expect(track.start).toBeLessThan(track.seconds - 30);
      expect(track.about.length).toBeGreaterThan(30);
      // Described to the streamer in the three languages of the app
      for (const texts of [fr, en, es]) expect((texts.compilation.music.about as Record<string, string>)[track.id], track.id).toBeTruthy();
    }
    expect(musicOf("phonk")?.name).toBe("Drift Phonk");
    expect(musicOf("kazoo")).toBeUndefined();
    expect(musicOf(null)).toBeUndefined();
  });

  it("brings a track to the level of the video before turning it down", () => {
    // Recorded at -8 LUFS, the video's sound is at -14: half as loud, about
    expect(trackGain({ lufs: -8 })).toBeCloseTo(0.501, 3);
    expect(trackGain({ lufs: -14 })).toBe(1);
    // A quiet recording is brought up
    expect(trackGain({ lufs: -20 })).toBeCloseTo(1.995, 3);
  });

  it("measures how much of a passage is spoken", () => {
    const words = [
      { start: 10, end: 10.5 },
      { start: 10.4, end: 11 },
      { start: 13, end: 14 },
      // Outside the passage, or over its edge
      { start: 2, end: 3 },
      { start: 19.5, end: 21 },
    ];
    // 10 to 11 (two words that overlap count once), 13 to 14, 19.5 to 20: 2.5 s of 10
    expect(speechShare(words, 10, 20)).toBeCloseTo(0.25);
    expect(speechShare([], 10, 20)).toBe(0);
    expect(speechShare(words, 20, 20)).toBe(0);
  });

  it("plays lower under people talking than under the game alone", () => {
    expect(passageLevel(0.8)).toBe(MUSIC_LEVELS.talk);
    expect(passageLevel(0.45)).toBe(MUSIC_LEVELS.talk);
    expect(passageLevel(0)).toBe(MUSIC_LEVELS.action);
    expect(passageLevel(0.1)).toBe(MUSIC_LEVELS.action);
    // In between: in between
    const some = passageLevel(0.28);
    expect(some).toBeLessThan(MUSIC_LEVELS.action);
    expect(some).toBeGreaterThan(MUSIC_LEVELS.talk);
    // Under a voice it stays far below it; under a game it is clearly there, and still below
    expect(MUSIC_LEVELS.talk).toBeLessThan(0.15);
    expect(MUSIC_LEVELS.action).toBeGreaterThan(2 * MUSIC_LEVELS.talk);
    expect(MUSIC_LEVELS.action).toBeLessThan(0.5);
    // A clip never transcribed has no words: what is said in it is talk, not silence
    expect(passageLevel(0, true)).toBe(MUSIC_LEVELS.talk);
  });

  it("is up front during the intro, follows each passage, and ends with the video", () => {
    const talk = MUSIC_LEVELS.talk;
    const action = MUSIC_LEVELS.action;
    const curve = musicCurve(
      [
        { seconds: 4, level: talk },
        { seconds: 3, level: talk },
        { seconds: 5, level: action },
      ],
      1.6,
    );
    expect(curve.start).toBe(MUSIC_LEVELS.intro);
    // Down as the first passage starts, up astride the cut before the action, out over the last second
    expect(curve.ramps).toEqual([
      [1.5, 0.5, talk],
      [8.4, 0.4, action],
      [12.6, 1, 0],
    ]);
    expect(gainAt(curve, 0)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(curve, 1.5)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(curve, 1.75)).toBeCloseTo((MUSIC_LEVELS.intro + talk) / 2);
    expect(gainAt(curve, 5)).toBe(talk);
    expect(gainAt(curve, 8.6)).toBeCloseTo((talk + action) / 2);
    expect(gainAt(curve, 11)).toBe(action);
    expect(gainAt(curve, 13.1)).toBeCloseTo(action / 2);
    expect(gainAt(curve, 13.6)).toBe(0);
    expect(gainAt(curve, 99)).toBe(0);
  });

  it("comes in under the first passage at that passage's level without an intro, and follows the streamer's own setting", () => {
    // No intro: nothing up front. It rises in half a second to what the first passage calls for: low under talk...
    const quiet = musicCurve([{ seconds: 6, level: MUSIC_LEVELS.talk }], 0);
    expect(quiet).toEqual({ start: 0, ramps: [[0, 0.5, MUSIC_LEVELS.talk], [5, 1, 0]] });
    expect(gainAt(quiet, 0.25)).toBeCloseTo(MUSIC_LEVELS.talk / 2);
    expect(gainAt(quiet, 3)).toBe(MUSIC_LEVELS.talk);
    // ...more present under the game, and it still follows each passage after that
    const game = musicCurve([{ seconds: 6, level: MUSIC_LEVELS.action }, { seconds: 4, level: MUSIC_LEVELS.talk }], 0);
    expect(game.ramps).toEqual([[0, 0.5, MUSIC_LEVELS.action], [5.8, 0.4, MUSIC_LEVELS.talk], [9, 1, 0]]);
    // With or without an intro, a passage plays at the same level: only the opening differs
    const opened = musicCurve([{ seconds: 6, level: MUSIC_LEVELS.action }, { seconds: 4, level: MUSIC_LEVELS.talk }], 1.6);
    expect(gainAt(opened, 1.6 + 3)).toBe(gainAt(game, 3));
    expect(gainAt(opened, 1.6 + 8)).toBe(gainAt(game, 8));
    const strong = musicCurve([{ seconds: 6, level: MUSIC_LEVELS.action }], 1.6, 1.6);
    expect(strong.start).toBe(1);
    expect(strong.ramps[0]).toEqual([1.5, 0.5, 0.48]);
    const low = musicCurve([{ seconds: 6, level: MUSIC_LEVELS.action }], 1.6, 0.6);
    expect(low.start).toBeCloseTo(0.42);
    expect(low.ramps[0][2]).toBeCloseTo(0.18);
    // Nothing to play under: nothing to say
    expect(musicCurve([], 0)).toEqual({ start: 0, ramps: [] });
  });
});
