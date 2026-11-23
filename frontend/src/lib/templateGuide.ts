/**
 * What each template ("display mode") is, in words, for the AI that chooses
 * one for a passage: where every element sits, how it looks, what comes in
 * when, and what the template is good for.
 *
 * The structure is read from the template itself (the 7 layouts and the
 * streamer's own are the same kind of object), so it is always exact; only
 * "what it is good for" is written by hand (the 7 layouts) or by the AI and
 * the streamer (their own templates, `usage`).
 */

import type { SubtitleStyle } from "./api";
import { builtInSpec } from "./builtinTemplates";
import { chatOf, enterOf, exitOf, orderOf, showOf, type Box, type FrameStyle, type SpecWidget, type TemplateSpec } from "./templateSpec";
import { H, NEEDS_WEBCAM, TEMPLATE_IDS, W, type TemplateId } from "./templates";

/** A template as the AI is told about it */
export interface TemplateGuide {
  key: string;
  name: string;
  description: string;
  /** Built around the webcam: not for a passage where nobody is in it */
  needs_cam: boolean;
}

/** What each of the 7 layouts is good for */
export const BUILTIN_USES: Record<TemplateId, string> = {
  empile:
    "The default for a streamer who talks or reacts while playing: the face and the game get equal weight. The most common Twitch-clip format. Best when the webcam is big enough in the stream to be enlarged to the full width.",
  signature:
    "A composed, branded look: webcam and game as cards over the blurred clip, in the channel's colors. Good when the webcam is small in the stream (it is hardly enlarged), for calm moments, talk to the camera, intros.",
  reaction: "The face is the show: big reactions, fits of laughter, shock, emotion. The game is only a small card. Needs an expressive face in the webcam.",
  discussion:
    "Conversations and role-play scenes: the scene on top with a small round webcam, the dialogue (one color per speaker) and the chat below. Good when what several people say matters more than the action.",
  plein: "The game is the show: action, fails, clutches, chases, anything that must be seen in detail. The webcam is only a small round in a corner.",
  accroche:
    "The whole stream picture between two black bands, like a film, with the title above for the whole video: when the entire screen matters (interface, things to read, wide shots) or to give a moment a story-telling feel.",
  sanscam: "Only the game: when nobody is in the webcam, or when the face adds nothing to the moment.",
  gta: "The look of Grand Theft Auto for a live on that game: the face cam big on top of the game with a strip of sunset on the seam (two framed panels in front of a Vice City sunset when the cam is small in the stream, the game alone when nobody is in it), the title in a leaning black plate, the subtitles in heavy small letters with a black outline, the channel on a GTA tag, six stars that light up as the video plays. For any moment of a GTA live; not for another game unless the streamer asks for it.",
};

const FONT_NAMES: Record<string, string> = {
  luckiest: "Luckiest Guy (fat cartoon letters)",
  bangers: "Bangers (comic letters)",
  anton: "Anton (tall condensed letters)",
  bebas: "Bebas Neue (tall condensed capitals)",
  montserrat: "Montserrat Black (wide heavy letters)",
  poppins: "Poppins ExtraBold (round heavy letters)",
  marker: "Permanent Marker (handwritten)",
  archivo: "Archivo (heavy letters)",
  rammetto: "Rammetto (very heavy, playful letters, like a GTA title)",
  dafoe: "Mr Dafoe (a neon-sign script, 80s Miami)",
  geist: "Geist (plain interface letters)",
};

const WIDGET_NAMES: Record<string, string> = {
  "channel-pill": "channel pill (the channel's logo and name)",
  logo: "the channel's logo",
  "channel-name": "the channel's name",
  handle: "the channel's handle",
  "live-badge": "a \"live on Twitch\" badge with the channel's name",
  "follow-button": "a follow button that a cursor clicks",
  "follow-banner": "a follow banner",
  "lower-third": "a lower-third name banner",
  socials: "the streamer's social handles",
  "follower-count": "the follower count",
  "clip-sticker": "a sticker label",
  "corner-logo": "a small logo in a corner",
  "progress-bar": "a progress bar of the video",
  "gta-wanted": "six wanted stars that light up one by one as the video plays, and blink red and blue at the end",
  "gta-seam": "a strip of sunset colours between the webcam and the game",
  "gta-wasted": "the picture going grey with a red WASTED stamped across it (for a fail, a death, a plan gone wrong)",
  "gta-mission": "a yellow script « Mission réussie » stamped across the picture (for a win, a clutch, a plan that worked)",
  "gta-plate": "a leaning black plate with a white edge and a strip of sunset under it, like the box of a game's title on its cover",
  "gta-tag": "the channel signed the GTA way: its logo ringed in white and black, its address on a leaning black plate",
  "gta-frame": "a frame round a picture: a line of sunset between two black ones, with a hard shadow",
  "gta-sky": "an evening in Vice City as a backdrop: a sunset sky, a low sun, hotels and two palms",
};

const ENTER_WORDS: Record<string, string> = {
  pop: "pops in",
  bounce: "bounces in",
  elastic: "springs in",
  drop: "drops in from the top",
  rise: "rises from the bottom",
  slideLeft: "slides in from the left",
  slideRight: "slides in from the right",
  zoom: "zooms in",
  fade: "fades in",
  none: "appears at once",
};

const EXIT_WORDS: Record<string, string> = {
  fade: "fades out",
  shrink: "shrinks away",
  sink: "sinks down",
  slideLeft: "slides out to the left",
  slideRight: "slides out to the right",
  none: "cuts out",
};

const round = (n: number) => Math.round(n * 10) / 10;
const percent = (share: number) => `${Math.round(Math.min(1, Math.max(0, share)) * 100)} %`;

/** The part of the frame a box really shows (it may run past the edges) */
function shown(b: Box): Box {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return { x, y, w: Math.max(0, Math.min(W, b.x + b.w) - x), h: Math.max(0, Math.min(H, b.y + b.h) - y) };
}

/** Where a box sits on the 1080x1920 frame, in words then in numbers */
export function placeOf(box: Box): string {
  const b = shown(box);
  if (b.w >= W * 0.97 && b.h >= H * 0.95) return "fills the whole frame";
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const row = cy < H * 0.2 ? "at the top" : cy < H * 0.4 ? "in the upper part" : cy < H * 0.6 ? "in the middle" : cy < H * 0.8 ? "in the lower part" : "at the bottom";
  const column = b.w >= W * 0.93 ? "across the full width" : cx < W * 0.38 ? "on the left" : cx > W * 0.62 ? "on the right" : "centered";
  return `${row}, ${column} (y ${Math.round(b.y)} to ${Math.round(b.y + b.h)}, ${percent(b.w / W)} of the width, ${percent(b.h / H)} of the height)`;
}

function frameWords(box: Box, frame: FrameStyle): string {
  const shape = frame.radius >= Math.min(box.w, box.h) / 2 - 2 ? "round" : frame.radius >= 20 ? "a card with rounded corners" : "with square corners";
  const outline = frame.border > 0 ? `, an outline of ${Math.round(frame.border)} px in ${colorWords(frame.borderColor)}` : "";
  return `${shape}${outline}${frame.shadow ? ", a shadow" : ""}`;
}

function colorWords(ref: string): string {
  if (ref === "accent") return "the channel's main color";
  if (ref === "highlight") return "the channel's highlight color";
  if (ref === "dark") return "the channel's dark color";
  if (ref === "light") return "the channel's light color";
  return ref === "white" ? "white" : ref;
}

/** How two boxes stand to each other: "above", "below", "over" (they overlap) */
function relation(a: Box, b: Box): "above" | "below" | "over" | "beside" {
  if (a.y + a.h <= b.y + 30) return "above";
  if (a.y >= b.y + b.h - 30) return "below";
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  return overlapX > 0 ? "over" : "beside";
}

function whenWords(w: SpecWidget): string {
  const s = showOf(w);
  const comes = s.inFrom === "end" ? `${round(s.in)} s before the end` : s.in <= 0.05 ? "from the first frame" : `${round(s.in)} s after the start`;
  const goes = s.out === null ? "stays to the end" : s.outFrom === "in" ? `${EXIT_WORDS[exitOf(w)]} ${round(s.out)} s later` : `${EXIT_WORDS[exitOf(w)]} ${round(s.out)} s before the end`;
  return `${ENTER_WORDS[enterOf(w)]} ${comes}, ${goes}`;
}

/** Everything a template shows, in a few lines: exact, read from the template */
export function describeSpec(spec: TemplateSpec): string {
  const lines: string[] = [];
  const cam = spec.cam.visible ? spec.cam : null;
  const game = spec.game;
  const whole = !!game.whole;

  const background = { blur: `the clip itself, blurred and darkened`, dark: "plain dark", brand: "the channel's main color", color: `a plain color (${spec.background.color})` }[spec.background.kind];
  const gameWords = whole
    ? `the whole 16:9 stream picture, webcam included, not cropped, ${placeOf(game.box)}`
    : `the game (the stream picture, cropped around its center to fill its box), ${placeOf(game.box)}${shown(game.box).w < W * 0.97 ? `, ${frameWords(game.box, game.frame)}` : ""}`;
  lines.push(`Picture: ${gameWords}.`);
  if (cam) {
    const where = { above: "above the game", below: "below the game", over: "laid over the game", beside: "beside the game" }[relation(cam.box, game.box)];
    lines.push(`Webcam: the streamer's face, ${where}, ${placeOf(cam.box)}${shown(cam.box).w < W * 0.97 ? `, ${frameWords(cam.box, cam.frame)}` : ""}.`);
  } else {
    lines.push(whole ? "Webcam: not shown on its own (it is in the stream picture)." : "Webcam: not shown.");
  }
  lines.push(`Background (behind everything): ${background}.`);

  const subs = spec.subtitles;
  const seam = cam && relation(cam.box, game.box) === "above" ? cam.box.y + cam.box.h : null;
  const subsMiddle = subs.box.y + subs.box.h / 2;
  const subsWhere =
    seam !== null && Math.abs(subsMiddle - seam) <= 140
      ? `on the seam between the webcam and the game (${placeOf(subs.box)})`
      : cam && relation(subs.box, cam.box) === "over" && subsMiddle < cam.box.y + cam.box.h
        ? `over the webcam (${placeOf(subs.box)})`
        : placeOf(subs.box);
  const letters = [
    FONT_NAMES[subs.font] ?? subs.font,
    `${Math.round(subs.size)} px`,
    subs.uppercase ? "uppercase" : "lowercase",
    subs.boxed ? "small text on a dark box" : subs.stroke ? "black outline" : "soft shadow",
  ].join(", ");
  const spoken = subs.speakers ? "one color per speaker" : subs.highlight === "none" ? "all words the same color" : `the spoken word in ${colorWords(subs.highlight)}`;
  lines.push(`Captions (what is said, word by word): ${subsWhere}; ${letters}; ${subs.words ?? 4} words at a time, ${spoken}${subs.pop ? ", the spoken word pops bigger" : ""}.`);

  if (spec.hook.visible) {
    const style = { outline: "white letters with a black outline", box: "dark text on a white box", brand: "white text on a box in the channel's main color", vice: "heavy white small letters with a black outline, like a GTA title", viceplate: "heavy white small letters on a leaning black plate with a white edge, like a GTA title in its box" }[spec.hook.style];
    const until = spec.hook.until === null ? "for the whole video" : spec.hook.until === "half" ? "for the first half" : `for the first ${round(spec.hook.until ?? 3.5)} s`;
    lines.push(`Hook line (the video's title, on the first frame): ${placeOf(spec.hook.box)}; ${style}, ${FONT_NAMES[spec.hook.font] ?? spec.hook.font}, ${Math.round(spec.hook.size)} px; on screen ${until}, then it bounces away.`);
  } else {
    lines.push("Hook line: none.");
  }

  const chat = chatOf(spec);
  if (chat.visible) lines.push(`Twitch chat: message bubbles ${placeOf(chat.box)}, ${chat.max} at a time.`);

  if (spec.widgets.length > 0) {
    lines.push(`Pop-ups: ${spec.widgets.map((w) => `${WIDGET_NAMES[w.kind] ?? w.kind} ${placeOf(w.box)}, ${whenWords(w)}`).join("; ")}.`);
  } else {
    lines.push("Pop-ups: none.");
  }

  const order = orderOf(spec).map((key) => (key.startsWith("widget:") ? "pop-up" : key === "subtitles" ? "captions" : key === "cam" ? "webcam" : key));
  lines.push(`Stacking, bottom to top: ${order.filter((key, i) => key !== order[i - 1]).join(", ")}.`);
  return lines.join("\n");
}

/** The use of a template of the streamer's own: what they or the AI wrote, else what its starting layout is for */
export function usageOf(spec: TemplateSpec): string {
  return spec.usage?.trim() || `Made by the streamer from the "${spec.base}" layout, which is for this: ${BUILTIN_USES[spec.base]}`;
}

export interface GuideOptions {
  /** The 7 layouts' names as the app shows them */
  nameOf: (id: TemplateId) => string;
  /** The channel's caption style and widget settings (the 7 layouts follow them) */
  subtitleStyle?: SubtitleStyle;
  widget?: { enabled: boolean; timing: "start" | "always" | "end" };
}

/** Every template the streamer can use, as the AI is told about them: their own first, then the 7 layouts */
export function templateGuides(customs: TemplateSpec[], options: GuideOptions): TemplateGuide[] {
  const own = customs.map((spec) => ({
    key: spec.id,
    name: spec.name || spec.id,
    description: `${describeSpec(spec)}\nGood for: ${usageOf(spec)}`,
    needs_cam: false,
  }));
  const builtIn = TEMPLATE_IDS.map((id) => {
    const spec = builtInSpec(id, { hasCam: true, subtitleStyle: options.subtitleStyle, widget: options.widget, id });
    const needsCam = NEEDS_WEBCAM.includes(id);
    const without = spec.cam.visible
      ? needsCam
        ? "\nWhen nobody is in the webcam: cannot be used (it turns into the game-only layout)."
        : "\nWhen nobody is in the webcam: the same without the webcam."
      : "";
    return { key: id as string, name: options.nameOf(id), description: `${describeSpec(spec)}${without}\nGood for: ${BUILTIN_USES[id]}`, needs_cam: needsCam };
  });
  return [...own, ...builtIn];
}
