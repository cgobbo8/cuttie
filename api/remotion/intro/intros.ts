/**
 * The ready-made intros of a compilation: a short jingle before the first
 * passage, with the channel's logo and colours and the video's title. The
 * numbers here are the only ones: the preview, the export (this folder is
 * copied to api/remotion/intro by scripts/sync-remotion.mjs) and the small
 * drawings of the picker all count with them.
 *
 * An intro holds the screen for `hold` frames, during which the video has not
 * started; it then leaves over the first `out` frames of the first passage,
 * which is already playing underneath (nothing of the video is covered for
 * long, and its sound starts on time).
 *
 * An intro is one of two kinds. A jingle: one of twelve ready-made openings
 * drawn over the whole screen. Or the "hook": no jingle, the best few seconds
 * of the video play first (a moment of the video, shown again at its place
 * later), then the video starts; it holds the screen for as long as that
 * moment lasts, and is framed by one of twelve looks, each with the name and
 * the feel of a jingle (`look`).
 */
export const JINGLE_IDS = ["slam", "bands", "glitch", "neon", "rush", "sticker", "split", "arcade", "news", "shatter", "countdown", "fuse"] as const;
export type JingleId = (typeof JINGLE_IDS)[number];
export const isJingle = (value: unknown): value is JingleId => typeof value === "string" && (JINGLE_IDS as readonly string[]).includes(value);
export const INTRO_IDS = ["hook", ...JINGLE_IDS] as const;
export type IntroId = (typeof INTRO_IDS)[number];
export const isIntro = (value: unknown): value is IntroId => typeof value === "string" && (INTRO_IDS as readonly string[]).includes(value);
/** The look a hook has when none is chosen: the fuse that burns round the picture */
export const DEFAULT_HOOK_LOOK: JingleId = "fuse";

/** The sound effects made for the intros, one timed on each (frontend/public/sounds/intro-<id>.mp3, made by scripts/make-intro-sounds.py) */
export const INTRO_SOUND_IDS = ["boom", "swish", "zap", "shine", "rush", "drum", "clash", "coin", "sting", "glass", "beep", "fizz"] as const;
export type IntroSoundId = (typeof INTRO_SOUND_IDS)[number];
export const isIntroSound = (value: unknown): value is IntroSoundId => typeof value === "string" && (INTRO_SOUND_IDS as readonly string[]).includes(value);
/** `intro.sound` when the intro is silent */
export const NO_SOUND = "none";

/** Frames at 30 fps, and the sound each intro plays unless another is chosen (the hook has none: its moment is heard) */
const SPANS: Record<IntroId, { hold: number; out: number; sound: IntroSoundId | null }> = {
  // (as long as its moment in a video: these 5 seconds are what the picker's sketch plays)
  hook: { hold: 150, out: 8, sound: null },
  slam: { hold: 48, out: 8, sound: "boom" },
  bands: { hold: 54, out: 12, sound: "swish" },
  glitch: { hold: 45, out: 6, sound: "zap" },
  neon: { hold: 60, out: 10, sound: "shine" },
  rush: { hold: 46, out: 7, sound: "rush" },
  sticker: { hold: 54, out: 10, sound: "drum" },
  split: { hold: 50, out: 12, sound: "clash" },
  arcade: { hold: 56, out: 8, sound: "coin" },
  news: { hold: 54, out: 10, sound: "sting" },
  shatter: { hold: 50, out: 12, sound: "glass" },
  countdown: { hold: 60, out: 8, sound: "beep" },
  fuse: { hold: 54, out: 10, sound: "fizz" },
};

/** The intro a compilation keeps: its style, its own title (else the video's name), its sound (else its style's; "none": silent) */
export interface IntroChoice {
  style: string;
  title?: string;
  sound?: string;
  /** False: without the channel's follow button (it is there unless said otherwise) */
  follow?: boolean;
  /** The "hook" intro: the moment of the video it plays first */
  hook?: HookChoice;
  /** The "hook" intro: the look that frames its moment, by the name of a jingle (absent: the fuse) */
  look?: string;
}

/** The look that frames a hook's moment */
export const hookLook = (intro: Pick<IntroChoice, "look"> | null | undefined): JingleId => (isJingle(intro?.look) ? intro.look : DEFAULT_HOOK_LOOK);

/**
 * The moment a "hook" intro plays: a passage of the video and the part of it that is shown
 * (seconds of that passage's live). `auto`: the app chose it (the moment the AI named as the
 * video's hook, else the best one) and chooses again when the video changes; without it, the
 * streamer did.
 */
export interface HookChoice {
  item: string;
  start: number;
  end: number;
  auto?: boolean;
}

/** A hook is a few seconds: shorter says nothing, longer is the video itself */
export const HOOK_MIN = 1.5;
export const HOOK_MAX = 8;
/** What a hook lasts when the app cuts it out of a longer moment */
export const HOOK_SECONDS = 5;

/** How long an intro holds the screen and how long it takes to leave, in frames (`seconds`: what a hook's moment lasts) */
export function introSpan(id: IntroId, fps: number, seconds?: number): { hold: number; out: number } {
  const frames = (at30: number) => Math.max(1, Math.round((at30 * fps) / 30));
  return { hold: id === "hook" && seconds ? Math.max(1, Math.round(seconds * fps)) : frames(SPANS[id].hold), out: frames(SPANS[id].out) };
}

/** Seconds an intro adds to the video (0: no intro, one this app doesn't know, or a hook without its moment) */
export function introSeconds(intro: IntroChoice | null | undefined): number {
  if (!intro || !isIntro(intro.style)) return 0;
  if (intro.style === "hook") return intro.hook ? Math.max(0, intro.hook.end - intro.hook.start) : 0;
  return SPANS[intro.style].hold / 30;
}

/** The sound an intro plays, null when it is silent */
export function introSound(intro: IntroChoice | null | undefined): IntroSoundId | null {
  if (!intro || !isIntro(intro.style) || intro.sound === NO_SOUND || !SPANS[intro.style].sound) return null;
  return isIntroSound(intro.sound) ? intro.sound : SPANS[intro.style].sound;
}

/** The sound of a style when none is chosen (null: a style that plays none) */
export const defaultIntroSound = (id: IntroId): IntroSoundId | null => SPANS[id].sound;

/**
 * When an intro's sound fades out: from the frame the video starts (`from`), over `frames`
 * frames: a sound longer than its intro doesn't play on over the first words.
 */
export function introFade(id: IntroId, fps: number): { from: number; frames: number } {
  const { hold, out } = introSpan(id, fps);
  return { from: hold, frames: out + Math.round(0.8 * fps) };
}

/** How loud the intro's sound is at a frame of the video, 1 to 0 */
export function introVolume(frame: number, id: IntroId, fps: number): number {
  const { from, frames } = introFade(id, fps);
  return clamp01(1 - (frame - from) / frames);
}

/* ── Movement ─────────────────────────────────────────────── */

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** How far `frame` is between two frames, 0 to 1 */
export const between = (frame: number, from: number, to: number) => clamp01((frame - from) / Math.max(1e-6, to - from));
export const easeOut = (t: number) => 1 - (1 - t) ** 3;
export const easeIn = (t: number) => t ** 3;
/** Arrives past its place and settles back: what makes an entrance bounce */
export const backOut = (t: number, overshoot = 1.9) => 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;
/** The same number for the same seed, between 0 and 1: a glitch that looks random and renders the same twice */
export const noise = (seed: number) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/** How wide a capital letter is in each clip font, as a share of its size (measured roughly; unknown fonts: a safe middle) */
const GLYPH: Record<string, number> = {
  Anton: 0.47,
  "Bebas Neue": 0.42,
  Bangers: 0.5,
  "Luckiest Guy": 0.62,
  "Permanent Marker": 0.66,
  Poppins: 0.7,
  Montserrat: 0.74,
  "Archivo Black": 0.74,
};

/** The title in capitals, cut into lines that fit the screen (words kept whole), and the size it is written at (1080 px wide frame) */
export function titleLines(title: string, font = "", perLine = 12, maxLines = 4): { lines: string[]; size: number } {
  const words = title.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= perLine) lines[lines.length - 1] = last + " " + word;
    else lines.push(word);
  }
  // Too many lines: wider lines, smaller letters
  if (lines.length > maxLines && perLine < 44) return titleLines(title, font, perLine + 4, maxLines);
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const glyph = GLYPH[font.replace(/["']/g, "").split(",")[0].trim()] ?? 0.62;
  // A line fills at most 860 px of the 1080
  const size = Math.round(Math.min(190, Math.max(56, 860 / (longest * glyph))));
  return { lines: lines.slice(0, maxLines), size };
}
