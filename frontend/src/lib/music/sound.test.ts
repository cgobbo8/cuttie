import { describe, expect, it } from "vitest";
import type { MontageProps } from "../montage";
import { gainAt, MUSIC_LEVELS, MUSICS, trackGain } from "./mix";
import { favouriteFor, introOf, introSoundUrl, kindOfClip, montageIntro, montageMusic, playable } from "./sound";

const phonk = MUSICS.find((track) => track.id === "phonk")!;
const lofi = MUSICS.find((track) => track.id === "lofi")!;
const drawn = { title: "Tigre cache-cache", name: "Falkarst", logo: null, colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" }, font: "Anton" };

describe("the sound of a video beyond its clips' own", () => {
  it("knows what kind of video a clip is from what its analysis called it", () => {
    expect([kindOfClip("fun"), kindOfClip("fail"), kindOfClip("awkward")]).toEqual(["funny", "funny", "funny"]);
    expect([kindOfClip("clutch"), kindOfClip("skill")]).toEqual(["skill", "skill"]);
    expect([kindOfClip("rage"), kindOfClip("reaction"), kindOfClip("hype")]).toEqual(["hype", "hype", "hype"]);
    expect([kindOfClip("emotional"), kindOfClip("storytelling")]).toEqual(["chill", "chill"]);
    // Never analysed, or called something new: no kind, so no music chosen for it
    expect([kindOfClip(undefined), kindOfClip(""), kindOfClip("cooking")]).toEqual([null, null, null]);
  });

  it("gives a clip the streamer's favourite for its kind, and nothing when they have none", () => {
    const tracks = [phonk, lofi];
    expect(favouriteFor("skill", { skill: "phonk" }, tracks)).toBe(phonk);
    expect(favouriteFor("chill", { skill: "phonk" }, tracks)).toBeUndefined();
    expect(favouriteFor(null, { skill: "phonk" }, tracks)).toBeUndefined();
    // A favourite whose file is not on this machine can't be played
    expect(favouriteFor("funny", { funny: "chiptune" }, tracks)).toBeUndefined();
    expect(favouriteFor("skill", undefined, tracks)).toBeUndefined();
  });

  it("plays the music low under the pieces where people talk and more present under the game, with or without an intro", () => {
    const talk = { words: [{ start: 0, end: 4 }, { start: 4.2, end: 9 }], start: 0, end: 10 };
    const game = { words: [], start: 20, end: 26 };
    const segments = [{ duration: 10 }, { duration: 6 }];
    const without = montageMusic(segments, [talk, game], { track: "phonk" });
    expect(without.track).toBe("phonk");
    expect(gainAt(without.curve, 0)).toBe(0);
    expect(gainAt(without.curve, 5)).toBe(MUSIC_LEVELS.talk);
    expect(gainAt(without.curve, 13)).toBe(MUSIC_LEVELS.action);
    const opened = montageMusic(segments, [talk, game], { track: "phonk" }, 1.6);
    expect(gainAt(opened.curve, 0)).toBe(MUSIC_LEVELS.intro);
    expect(gainAt(opened.curve, 1.6 + 5)).toBe(MUSIC_LEVELS.talk);
    expect(gainAt(opened.curve, 1.6 + 13)).toBe(MUSIC_LEVELS.action);
    // The streamer's own setting, on everything
    expect(gainAt(montageMusic(segments, [talk, game], { track: "phonk", volume: 1.6 }).curve, 5)).toBeCloseTo(MUSIC_LEVELS.talk * 1.6);
    // A clip never transcribed has no words: what is said in it is talk, not silence
    expect(gainAt(montageMusic([{ duration: 10 }], [{ words: [], start: 0, end: 10, said: true }], { track: "phonk" }).curve, 5)).toBe(MUSIC_LEVELS.talk);
  });

  it("draws an intro with the video's title unless it has its own, and its style's sound unless another or none", () => {
    expect(montageIntro({ style: "slam" }, drawn)).toEqual({ ...drawn, style: "slam", sound: "boom" });
    expect(montageIntro({ style: "slam", title: " Le tigre ", sound: "none" }, drawn)).toEqual({ ...drawn, style: "slam", title: "Le tigre" });
    expect(montageIntro({ style: "bands", sound: "clash" }, drawn)?.sound).toBe("clash");
    // The channel's follow button, worded by the caller: there unless this intro does without it
    const worded = { ...drawn, follow: ["Suivre", "Suivi"] as [string, string] };
    expect(montageIntro({ style: "slam" }, worded)?.follow).toEqual(["Suivre", "Suivi"]);
    expect(montageIntro({ style: "slam", follow: false }, worded)).toEqual({ ...drawn, style: "slam", sound: "boom" });
    expect(montageIntro(null, drawn)).toBeNull();
    expect(montageIntro({ style: "wobble" }, drawn)).toBeNull();
    expect(introOf({ intro: { ...drawn, style: "slam" } })).toBe(1.6);
    expect(introOf({})).toBe(0);
  });

  it("opens on a hook only when it has its moment, as long as that moment, with the music under it as under a passage", () => {
    const moment = { from: 12, duration: 4.2, layers: [] };
    // No moment to play (a video of one passage): no intro
    expect(montageIntro({ style: "hook" }, drawn)).toBeNull();
    expect(montageIntro({ style: "hook" }, drawn, null)).toBeNull();
    // With it: the intro carries the moment, and no sound of its own
    const opened = montageIntro({ style: "hook", title: "Le tigre", sound: "boom" }, drawn, moment);
    expect(opened).toEqual({ ...drawn, style: "hook", title: "Le tigre", hook: moment, look: "fuse" });
    // ...framed by the look chosen for it
    expect(montageIntro({ style: "hook", look: "neon" }, drawn, moment)?.look).toBe("neon");
    expect(introOf({ intro: opened! })).toBe(4.2);
    // A jingle ignores a moment
    expect(montageIntro({ style: "slam" }, drawn, moment)).toEqual({ ...drawn, style: "slam", sound: "boom" });

    // The music: not up front as during a jingle, but under the moment as under any passage, then under the video
    const talk = { words: [{ start: 0, end: 4 }, { start: 4.2, end: 9 }], start: 0, end: 10 };
    const game = { words: [], start: 20, end: 26 };
    const music = montageMusic([{ duration: 10 }, { duration: 6 }], [talk, game], { track: "phonk" }, 4.2, { seconds: 4.2, piece: game });
    expect(gainAt(music.curve, 0)).toBe(0);
    expect(gainAt(music.curve, 2.5)).toBe(MUSIC_LEVELS.action);
    expect(gainAt(music.curve, 4.2 + 5)).toBe(MUSIC_LEVELS.talk);
    expect(gainAt(music.curve, 4.2 + 13)).toBe(MUSIC_LEVELS.action);
  });

  it("gives the page's player files to play, brought down to the level of the clips as they are", () => {
    const montage: MontageProps = {
      segments: [],
      overlays: [],
      intro: { ...drawn, style: "slam", sound: "boom" },
      music: { track: "phonk", curve: { start: 0.7, ramps: [] } },
    };
    // A live recorded at -26 LUFS: the export will bring it up by 12 dB, so here the music comes down by 12 dB
    const quiet = playable(montage, [phonk], -26);
    expect(quiet.intro).toMatchObject({ sound: introSoundUrl("boom") });
    expect(quiet.intro!.gain).toBeCloseTo(0.251, 2);
    expect(quiet.music).toMatchObject({ src: "/api/musics/phonk", from: phonk.start, track: "phonk" });
    expect(quiet.music!.gain).toBeCloseTo(trackGain(phonk) * 0.251, 2);
    // Never louder than recorded, and a guess while the live's level is not known
    expect(playable(montage, [phonk], -8).music!.gain).toBeCloseTo(trackGain(phonk));
    expect(playable(montage, [phonk], null).music!.gain).toBeCloseTo(trackGain(phonk) * 0.3);
    expect(playable(montage, [phonk], null).intro!.gain).toBeUndefined();
    // A track that can't be played here: no music, the rest untouched
    const without = playable(montage, [lofi], -26);
    expect(without.music).toBeUndefined();
    expect(without.segments).toBe(montage.segments);
  });
});
