import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import es from "../i18n/es.json";
import fr from "../i18n/fr.json";
import { gainAt, MUSIC_KINDS, MUSIC_LEVELS, MUSICS, musicCurve, musicFrom, musicLeads, musicOf, passageLevel, speechShare, trackGain } from "./mix";

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

  it("starts a track that builds up to its strong moment earlier, so that the moment falls where the video starts", () => {
    // A riff that comes in at 35.1 s after a long build: with an intro of 1.79 s (four beats), the track is read from 33.31 s
    const riff = { start: 35.1, build: true };
    expect(musicLeads(riff, 1.79)).toBe(true);
    expect(musicFrom(riff, 1.79)).toBe(33.31);
    // No intro: nothing to build during, the video starts on the moment itself. So does a track that doesn't build up
    expect([musicFrom(riff, 0), musicFrom({ start: 35.1 }, 1.79), musicFrom({ start: 35.1, build: false }, 1.79)]).toEqual([35.1, 35.1, 35.1]);
    expect([musicLeads(riff, 0), musicLeads({ start: 35.1 }, 1.79), musicLeads(null, 1.79), musicLeads(undefined, 1.79)]).toEqual([false, false, false, false]);
    // A moment too near the start of the track to have that much before it: on the moment
    expect(musicFrom({ start: 0.4, build: true }, 1.79)).toBe(0.4);
    expect(musicLeads({ start: 0.4, build: true }, 1.79)).toBe(false);
    // A hook plays a moment of the video first: the track builds under it just the same
    expect(musicFrom(riff, 4.2)).toBe(30.9);
  });

  it("lets the moment a track built up to be heard where the video starts, then goes down under what is said", () => {
    const talk = MUSIC_LEVELS.talk;
    // A jingle of 1.8 s, then people talking for 10 s. Without a build-up the music is already going down as the video starts...
    const plain = musicCurve([{ seconds: 10, level: talk }], 1.8);
    expect(plain.ramps[0]).toEqual([1.7, 0.5, talk]);
    expect(gainAt(plain, 2.3)).toBeCloseTo(talk);
    // ...with one, it stays up front as the moment lands, for a moment, then takes its time to go down
    const dropped = musicCurve([{ seconds: 10, level: talk }], 1.8, 1, 1.8);
    expect(dropped.start).toBe(MUSIC_LEVELS.intro);
    expect(dropped.ramps[0]).toEqual([2.25, 0.9, talk]);
    expect(gainAt(dropped, 1.8)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(dropped, 2.2)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(dropped, 2.7)).toBeCloseTo((MUSIC_LEVELS.intro + talk) / 2);
    expect(gainAt(dropped, 3.2)).toBeCloseTo(talk);
    // What follows is as it was: the next passage, the end of the video
    const two = musicCurve([{ seconds: 10, level: talk }, { seconds: 6, level: MUSIC_LEVELS.action }], 1.8, 1, 1.8);
    expect(two.ramps.slice(1)).toEqual(musicCurve([{ seconds: 10, level: talk }, { seconds: 6, level: MUSIC_LEVELS.action }], 1.8).ramps.slice(1));
    // A first passage of a second: the moment is heard for less long, and the music is down before the next cut (never two changes at once)
    const short = musicCurve([{ seconds: 1, level: talk }, { seconds: 6, level: MUSIC_LEVELS.action }], 1.8, 1, 1.8);
    const [at, over] = short.ramps[0];
    expect(at).toBeGreaterThan(1.8);
    expect(at + over).toBeLessThanOrEqual(short.ramps[1][0] + 1e-9);
    for (let i = 1; i < short.ramps.length; i++) expect(short.ramps[i][0]).toBeGreaterThanOrEqual(short.ramps[i - 1][0]);
    // After a hook (a moment of the video played first, the music low under it): the music comes up front just before the moment lands
    const hooked = musicCurve([{ seconds: 4.2, level: talk }, { seconds: 10, level: talk }], 0, 1, 4.2);
    expect(hooked.start).toBe(0);
    expect(hooked.ramps.slice(0, 3)).toEqual([
      [0, 0.5, talk],
      [4.05, 0.15, MUSIC_LEVELS.intro],
      [4.65, 0.9, talk],
    ]);
    expect(gainAt(hooked, 3)).toBeCloseTo(talk);
    expect(gainAt(hooked, 4.3)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(hooked, 6)).toBeCloseTo(talk);
    // The streamer's own setting is on everything
    expect(musicCurve([{ seconds: 10, level: talk }], 1.8, 0.6, 1.8).ramps[0][2]).toBeCloseTo(talk * 0.6);
  });
});
