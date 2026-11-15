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
 */
export const INTRO_IDS = ["slam", "bands", "glitch", "neon", "rush", "sticker", "split"] as const;
export type IntroId = (typeof INTRO_IDS)[number];
export const isIntro = (value: unknown): value is IntroId => typeof value === "string" && (INTRO_IDS as readonly string[]).includes(value);

/** The sound effects made for the intros, one timed on each (frontend/public/sounds/intro-<id>.mp3, made by scripts/make-intro-sounds.py) */
export const INTRO_SOUND_IDS = ["boom", "swish", "zap", "shine", "rush", "drum", "clash"] as const;
export type IntroSoundId = (typeof INTRO_SOUND_IDS)[number];
export const isIntroSound = (value: unknown): value is IntroSoundId => typeof value === "string" && (INTRO_SOUND_IDS as readonly string[]).includes(value);
/** `intro.sound` when the intro is silent */
export const NO_SOUND = "none";

/** Frames at 30 fps, and the sound each intro plays unless another is chosen */
const SPANS: Record<IntroId, { hold: number; out: number; sound: IntroSoundId }> = {
  slam: { hold: 48, out: 8, sound: "boom" },
  bands: { hold: 54, out: 12, sound: "swish" },
  glitch: { hold: 45, out: 6, sound: "zap" },
  neon: { hold: 60, out: 10, sound: "shine" },
  rush: { hold: 46, out: 7, sound: "rush" },
  sticker: { hold: 54, out: 10, sound: "drum" },
  split: { hold: 50, out: 12, sound: "clash" },
};

/** The intro a compilation keeps: its style, its own title (else the video's name), its sound (else its style's; "none": silent) */
export interface IntroChoice {
  style: string;
  title?: string;
  sound?: string;
}

/** How long an intro holds the screen and how long it takes to leave, in frames */
export function introSpan(id: IntroId, fps: number): { hold: number; out: number } {
  const frames = (at30: number) => Math.max(1, Math.round((at30 * fps) / 30));
  return { hold: frames(SPANS[id].hold), out: frames(SPANS[id].out) };
}

/** Seconds an intro adds to the video (0: no intro, or one this app doesn't know) */
export const introSeconds = (intro: IntroChoice | null | undefined): number => (intro && isIntro(intro.style) ? SPANS[intro.style].hold / 30 : 0);

/** The sound an intro plays, null when it is silent */
export function introSound(intro: IntroChoice | null | undefined): IntroSoundId | null {
  if (!intro || !isIntro(intro.style) || intro.sound === NO_SOUND) return null;
  return isIntroSound(intro.sound) ? intro.sound : SPANS[intro.style].sound;
}

/** The sound of a style when none is chosen */
export const defaultIntroSound = (id: IntroId): IntroSoundId => SPANS[id].sound;

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
