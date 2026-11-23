/**
 * The music a video plays in the background, and how loud it is from one moment
 * to the next: up front during the intro, turned down under passages where
 * people talk, kept more present on passages that are mostly the game (kills,
 * action), where the streamer and the game's loud sounds must still be heard.
 *
 * The page works the curve out (it knows the words of each passage) and plays
 * it with the preview; the export gets the same curve and mixes the music in
 * once the video's own sound is levelled (api/app/services/sound_level.ts).
 */
import catalogue from "./catalogue.json";
import type { MusicCurve } from "./curve";

export { gainAt, type MusicCurve } from "./curve";

/** What a video is, for choosing its music: the streamer has a favourite for each (brand kit) */
export const MUSIC_KINDS = ["funny", "skill", "suspense", "chill", "hype"] as const;
export type MusicKind = (typeof MUSIC_KINDS)[number];
export const isMusicKind = (value: unknown): value is MusicKind => typeof value === "string" && (MUSIC_KINDS as readonly string[]).includes(value);

export interface MusicTrack {
  id: string;
  name: string;
  author: string;
  genre: string;
  /** The kinds of video it suits */
  kinds: string[];
  bpm: number;
  seconds: number;
  /** Its strong moment: where a video starts it (measured when it is added; the streamer can point at another) */
  start: number;
  /**
   * It builds up to that moment: a video that opens with an intro starts the track that much
   * earlier, so that the moment falls on the first picture of the video (see `musicFrom`)
   */
  build?: boolean;
  /** Its loudness as recorded (LUFS) */
  lufs: number;
  /** What it sounds like and what it is for, in English: read by the AI */
  about: string;
  /** One the streamer added: its description is theirs (the AI wrote a first one, they can change it) */
  own?: boolean;
  description?: string;
}

/** The tracks that ship with the app (the streamer's own come from the API: see library.ts) */
export const MUSICS: MusicTrack[] = catalogue.tracks;
export const musicOf = (id: string | null | undefined): MusicTrack | undefined => (id ? MUSICS.find((track) => track.id === id) : undefined);

/** The music a compilation keeps: its track, and how present it is (1: as Cuttie sets it) */
export interface MusicChoice {
  track: string;
  volume?: number;
}
export const MUSIC_VOLUMES = { low: 0.6, normal: 1, high: 1.6 } as const;

/** The level every sound of an export is brought to (LUFS): a track is brought there first, then turned down */
export const PROGRAM_LUFS = -14;
/** What a track is multiplied by to sit at the program's level */
export const trackGain = (track: Pick<MusicTrack, "lufs">): number => 10 ** ((PROGRAM_LUFS - track.lufs) / 20);

/**
 * How loud the music is against the video's levelled sound (1: as loud as the voice):
 * nearly that during the intro, far under people talking, well under a game being played.
 */
export const MUSIC_LEVELS = { intro: 0.7, talk: 0.09, action: 0.3 };
/** A passage is "people talking" from this share of speech in it, "the game" under that one */
const TALK = 0.45;
const ACTION = 0.12;

/** The share of a passage during which somebody speaks (0 to 1), from its dated words */
export function speechShare(words: { start: number; end: number }[], from: number, to: number): number {
  const length = to - from;
  if (length <= 0) return 0;
  let spoken = 0;
  let until = from;
  for (const word of [...words].sort((a, b) => a.start - b.start)) {
    const start = Math.max(word.start, until);
    const end = Math.min(word.end, to);
    if (end > start) {
      spoken += end - start;
      until = end;
    }
  }
  return Math.min(1, spoken / length);
}

/**
 * How loud the music is under a passage: the more is said, the lower. `said`: the passage
 * has a text but no dated words (its clip was never transcribed): taken as people talking,
 * not as silence.
 */
export function passageLevel(share: number, said = false): number {
  if (said && share === 0) return MUSIC_LEVELS.talk;
  const k = Math.min(1, Math.max(0, (share - ACTION) / (TALK - ACTION)));
  return MUSIC_LEVELS.action + (MUSIC_LEVELS.talk - MUSIC_LEVELS.action) * k;
}

const RAMP = 0.4;
const FADE_OUT = 1;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A track that builds up to its strong moment, in a video that opens with an intro (`opening`
 * seconds: a jingle, or the moment a hook plays), is started that much earlier: the intro plays
 * what leads to the moment, which falls on the first picture of the video. Not when the moment
 * is too near the start of the track to have that much before it.
 */
export const musicLeads = (track: Pick<MusicTrack, "start" | "build"> | null | undefined, opening: number): boolean => !!track?.build && opening > 0 && track.start >= opening;

/** Where a video starts reading a track, seconds (the server counts the same way: api/app/services/musics.ts) */
export const musicFrom = (track: Pick<MusicTrack, "start" | "build">, opening: number): number => (musicLeads(track, opening) ? round(track.start - opening) : track.start);

/**
 * When a track's strong moment falls on the start of the video, it is heard: the music comes up
 * front just before it (if it was not), stays there this long, then takes this long to go down
 * under the first passage. Shorter when that passage is.
 */
const DROP = { rise: 0.15, hold: 0.45, fall: 0.9 };

/**
 * The curve of a video: `intro` seconds up front (0: none; the music then comes in under the
 * first passage), then each passage at its level (changes are spread over a moment around the
 * cut, never a step), down to nothing at the end.
 * `volume`: the streamer's own setting, on everything.
 * `drop`: the second of the video the track's strong moment falls on, when it builds up to it
 * (where the video starts after its intro): the music is up front there, whatever is said.
 */
export function musicCurve(passages: { seconds: number; level: number }[], intro = 0, volume = 1, drop?: number): MusicCurve {
  const loud = (level: number) => round(Math.min(1, Math.max(0, level * volume)));
  const total = intro + passages.reduce((sum, p) => sum + p.seconds, 0);
  const levels = passages.map((p) => loud(p.level));
  const ramps: MusicCurve["ramps"] = [];
  // With an intro it is there from the first frame, up front. Without one it comes in under the
  // first passage, at that passage's own level (low under talk, more present under the game)
  let now = intro > 0 ? loud(MUSIC_LEVELS.intro) : 0;
  const start = now;
  let at = intro;
  passages.forEach((passage, i) => {
    if (drop !== undefined && Math.abs(at - drop) < 0.01) {
      // The moment the track built up to lands here: up front as it does, then down to this passage's level before its end
      const front = loud(MUSIC_LEVELS.intro);
      if (Math.abs(front - now) > 0.004) ramps.push([round(Math.max(0, at - DROP.rise)), DROP.rise, front]);
      const room = Math.max(0.2, passage.seconds - RAMP / 2 - 0.05);
      const hold = Math.min(DROP.hold, room / 3);
      ramps.push([round(at + hold), round(Math.min(DROP.fall, room - hold)), levels[i]]);
      now = levels[i];
      at += passage.seconds;
      return;
    }
    // Down from the intro just as the first passage starts (or in from nothing); between passages, astride the cut
    const from = i === 0 ? at - (intro > 0 ? 0.1 : 0) : at - RAMP / 2;
    if (Math.abs(levels[i] - now) > 0.004) {
      ramps.push([round(Math.max(0, from)), i === 0 ? 0.5 : RAMP, levels[i]]);
      now = levels[i];
    }
    at += passage.seconds;
  });
  if (total > 0) ramps.push([round(Math.max(0, total - FADE_OUT)), round(Math.min(FADE_OUT, total)), 0]);
  return { start, ramps };
}

/** Where a track is read from when it plays in the page */
export const musicUrl = (id: string) => `/api/musics/${encodeURIComponent(id)}`;
