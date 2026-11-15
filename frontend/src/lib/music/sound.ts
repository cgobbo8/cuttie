/**
 * The sound of a video beyond its clips' own: its background music and its intro, as the
 * montage plays them. Shared by the compilations and by the classic clips (Monter): the same
 * level curve, the same way of playing them in the page.
 */
import { hookLook, introSeconds, introSound, isIntro, type IntroChoice } from "../intro/intros";
import type { MontageIntro, MontageMusic, MontageProps, MontageSegment } from "../montage";
import { trackOf } from "./library";
import { musicCurve, musicUrl, passageLevel, PROGRAM_LUFS, speechShare, trackGain, type MusicChoice, type MusicKind, type MusicTrack } from "./mix";

/** Where an intro's sound is served from (frontend/public/sounds) */
export const introSoundUrl = (id: string) => `/sounds/intro-${id}.mp3`;

/** The kind of video a clip is, from the category its analysis gave it (see llm_analyzer.py) */
const CLIP_KINDS: Record<string, MusicKind> = {
  fun: "funny",
  fail: "funny",
  awkward: "funny",
  clutch: "skill",
  skill: "skill",
  rage: "hype",
  reaction: "hype",
  hype: "hype",
  emotional: "chill",
  storytelling: "chill",
};
export const kindOfClip = (category: string | null | undefined): MusicKind | null => CLIP_KINDS[category ?? ""] ?? null;

/** The streamer's favourite music for a kind of video, when they have one that can be played here */
export function favouriteFor(kind: string | null, favourites: Record<string, string> | undefined, tracks: MusicTrack[]): MusicTrack | undefined {
  return kind ? trackOf(tracks, favourites?.[kind]) : undefined;
}

/** A piece of a video as the music needs to know it: its dated words, the part of its clip it plays, and whether something is said in it */
export interface SoundPiece {
  words: { start: number; end: number }[];
  start: number;
  end: number;
  /** It has a text although its clip has no dated words (never transcribed): people talk in it */
  said?: boolean;
}

/**
 * The music of a montage: its track and its level over the video, lower where people talk,
 * more present where the game plays alone. `intro`: seconds the intro holds the screen (0: none).
 * `hook`: the moment a "hook" intro plays first, and how long: a passage like the others, the
 * music sits under it as under them (not up front, as during a jingle).
 */
export function montageMusic(segments: { duration: number }[], pieces: SoundPiece[], choice: MusicChoice, intro = 0, hook?: { seconds: number; piece: SoundPiece }): MontageMusic {
  const level = (piece: SoundPiece) => passageLevel(speechShare(piece.words, piece.start, piece.end), piece.words.length === 0 && !!piece.said);
  const levels = pieces.map(level);
  const passages = segments.map((segment, i) => ({ seconds: segment.duration, level: levels[i] ?? levels[0] ?? 0 }));
  return { track: choice.track, curve: musicCurve(hook ? [{ seconds: hook.seconds, level: level(hook.piece) }, ...passages] : passages, hook ? 0 : intro, choice.volume ?? 1) };
}

/**
 * The intro of a montage with all it draws (null: none, a style this app doesn't know, or a
 * "hook" without its moment). `hook`: the moment a "hook" intro plays, built like a piece.
 */
export function montageIntro(choice: IntroChoice | null | undefined, drawn: Omit<MontageIntro, "style" | "sound" | "gain" | "title" | "hook" | "look"> & { title: string }, hook?: MontageSegment | null): MontageIntro | null {
  if (!choice || !isIntro(choice.style) || (choice.style === "hook" && !hook)) return null;
  const sound = introSound(choice);
  // The follow button is the caller's to word (`drawn.follow`); an intro can do without it
  const { follow, ...rest } = drawn;
  return {
    ...rest,
    style: choice.style,
    title: choice.title?.trim() || drawn.title,
    ...(follow && choice.follow !== false ? { follow } : {}),
    ...(sound ? { sound } : {}),
    // (a hook: its moment, and the look that frames it)
    ...(choice.style === "hook" && hook ? { hook, look: hookLook(choice) } : {}),
  };
}

/** Seconds a montage's intro holds the screen (a hook: as long as its moment) */
export const introOf = (montage: Pick<MontageProps, "intro">): number => (montage.intro ? (montage.intro.hook?.duration ?? introSeconds({ style: montage.intro.style })) : 0);

/**
 * A montage as the page's player takes it: the intro's sound and the music become files it
 * plays. The export levels the clips' sound before adding them; here the clips play as they
 * are, so both come down by as much (`liveLufs`: how loud this live's clips are, null: unknown).
 */
export function playable(montage: MontageProps, tracks: MusicTrack[], liveLufs: number | null): MontageProps {
  const track = trackOf(tracks, montage.music?.track);
  const trim = liveLufs === null ? 0.3 : Math.min(1, 10 ** ((liveLufs - PROGRAM_LUFS) / 20));
  return {
    ...montage,
    ...(montage.intro?.sound ? { intro: { ...montage.intro, sound: introSoundUrl(montage.intro.sound), ...(liveLufs === null ? {} : { gain: trim }) } } : {}),
    ...(montage.music && track ? { music: { ...montage.music, src: musicUrl(track.id), from: track.start, gain: trackGain(track) * trim } } : { music: undefined }),
  };
}
