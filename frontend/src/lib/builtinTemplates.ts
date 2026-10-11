/**
 * Cuttie's 7 layouts, as element templates: built like the streamer's own
 * (buildFromSpec), with the channel's subtitle style and widget settings, so
 * they get the same widgets, animations and frames.
 *
 * Drawn from what works for Twitch clips on TikTok / Shorts / Reels (Oct 2026):
 * two clips out of three stack the webcam on top of the game, full width, with
 * the subtitles on the seam; subtitles are 1 to 3 condensed words with a black
 * outline, the spoken word popping; a hook line sits on the first frame (the
 * clip's cover) and goes after a few seconds; branding stays small.
 */

import type { SubtitleStyle } from "./api";
import type { Layer } from "./editorTypes";
import type { FontId } from "./fonts";
import {
  buildFromSpec,
  DEFAULT_CHAT,
  newSpecId,
  SHOW_PRESETS,
  timingOf,
  type Box,
  type ChatSpec,
  type ColorRef,
  type EnterId,
  type ExitId,
  type FrameStyle,
  type HookStyle,
  type SpecWidget,
  type TemplateSpec,
  type WidgetKind,
  type WidgetShow,
  type WidgetTimingKind,
} from "./templateSpec";
import type { CustomTemplate, TemplateContext, TemplateId, TemplateLook } from "./templates";

const frame = (radius: number, border = 0, borderColor = "white", shadow = false): FrameStyle => ({ radius, border, borderColor, shadow });

interface Subtitles {
  box: Box;
  font: FontId;
  size: number;
  uppercase: boolean;
  /** Words on screen at a time */
  words: number;
  /** Black outline around the letters (else a soft shadow) */
  stroke: boolean;
  /** One color per speaker */
  speakers?: boolean;
}

interface Hook {
  box: Box;
  style: HookStyle;
  font: FontId;
  size: number;
  /** Seconds on screen from the first frame, half the clip, or the whole clip */
  until: number | "half" | null;
}

interface BrandWidget {
  kind: WidgetKind;
  box: Box;
  enter: EnterId;
  exit: ExitId;
  fields?: Record<string, string>;
}

/** A widget with its own timing (a follow button at the end...) */
interface Extra extends BrandWidget {
  id: string;
  show: WidgetShow;
}

/** Where things sit in a layout and how they look (the subtitle style comes from the channel) */
interface Layout {
  background: TemplateSpec["background"]["kind"];
  /** For a "color" background */
  bgColor?: ColorRef;
  /** Darkening over the blurred clip */
  dim: number;
  game: { box: Box; frame: FrameStyle; whole?: boolean };
  cam: { box: Box; frame: FrameStyle } | null;
  subtitles: Subtitles;
  hook: Hook;
  /** The Twitch chat, shown when set */
  chat?: Omit<ChatSpec, "visible">;
  /** The channel's widget, timed by the channel settings */
  brand: BrandWidget | null;
  extras?: Extra[];
  /** Stacking when it isn't game, cam, chat, subtitles, hook (bottom to top) */
  order?: string[];
}

/** A follow button that a cursor clicks, the last seconds of the clip */
const followAtEnd = (box: Box): Extra => ({
  id: "w-follow",
  kind: "follow-button",
  box,
  show: { in: 3, inFrom: "end", out: null, outFrom: "end" },
  enter: "bounce",
  exit: "none",
});

/*
 * Text, webcam and brand stay out of what TikTok / Shorts / Reels cover
 * (COVERED_ZONES): the tabs above y 200, the description below y 1440, the
 * buttons right of x 930 between y 760 and 1440. Subtitles sit centered
 * between x 150 and 930. Only the game runs under them.
 */
const LAYOUTS: Record<TemplateId, Layout> = {
  // The webcam on top, full width, the game below: the most common Twitch clip
  empile: {
    background: "dark",
    dim: 0.42,
    cam: { box: { x: 0, y: 0, w: 1080, h: 740 }, frame: frame(0) },
    // Runs past the sides and the bottom, so its outline only draws the seam, in the channel color
    game: { box: { x: -12, y: 746, w: 1104, h: 1186 }, frame: frame(0, 6, "accent") },
    subtitles: { box: { x: 150, y: 650, w: 780, h: 240 }, font: "anton", size: 84, uppercase: true, words: 3, stroke: true },
    // Titles go on the game, never on the face
    hook: { box: { x: 100, y: 910, w: 880, h: 150 }, style: "box", font: "poppins", size: 52, until: 3.5 },
    // Centered over the webcam, like everything else here
    brand: { kind: "channel-pill", box: { x: 220, y: 216, w: 640, h: 68 }, enter: "pop", exit: "shrink" },
    extras: [followAtEnd({ x: 290, y: 1200, w: 500, h: 160 })],
  },
  // The game scene on top with a round webcam, the talk below: who speaks, in color, and the chat
  discussion: {
    background: "dark",
    dim: 0.42,
    game: { box: { x: 0, y: 200, w: 1080, h: 820 }, frame: frame(0) },
    cam: { box: { x: 40, y: 230, w: 230, h: 230 }, frame: frame(115, 6, "accent", true) },
    subtitles: { box: { x: 150, y: 1035, w: 780, h: 200 }, font: "poppins", size: 60, uppercase: false, words: 5, stroke: true, speakers: true },
    hook: { box: { x: 100, y: 870, w: 880, h: 130 }, style: "box", font: "poppins", size: 48, until: 3.5 },
    chat: { box: { x: 60, y: 1245, w: 760, h: 190 }, size: 40, max: 2 },
    // Hangs under the webcam
    brand: { kind: "channel-pill", box: { x: 5, y: 438, w: 300, h: 56 }, enter: "pop", exit: "shrink" },
  },
  // The face, big, the game in a card over the bottom of the webcam
  reaction: {
    background: "blur",
    dim: 0.5,
    cam: { box: { x: 0, y: 0, w: 1080, h: 1300 }, frame: frame(0) },
    game: { box: { x: 150, y: 1040, w: 780, h: 400 }, frame: frame(32, 5, "accent", true) },
    subtitles: { box: { x: 150, y: 930, w: 780, h: 200 }, font: "anton", size: 100, uppercase: true, words: 2, stroke: true },
    hook: { box: { x: 170, y: 1290, w: 740, h: 130 }, style: "box", font: "poppins", size: 46, until: 3.5 },
    brand: { kind: "live-badge", box: { x: 60, y: 216, w: 600, h: 76 }, enter: "pop", exit: "shrink" },
    order: ["cam", "game", "chat", "subtitles", "hook"],
  },
  // The game fills the frame, a round webcam in the corner: fails, clutches
  plein: {
    background: "dark",
    dim: 0.42,
    game: { box: { x: 0, y: 0, w: 1080, h: 1920 }, frame: frame(0) },
    cam: { box: { x: 60, y: 1090, w: 300, h: 300 }, frame: frame(150, 8, "accent", true) },
    subtitles: { box: { x: 150, y: 800, w: 780, h: 240 }, font: "luckiest", size: 84, uppercase: true, words: 3, stroke: true },
    hook: { box: { x: 60, y: 230, w: 960, h: 170 }, style: "outline", font: "anton", size: 76, until: 3.5 },
    // Hangs under the webcam
    brand: { kind: "channel-pill", box: { x: 30, y: 1360, w: 360, h: 60 }, enter: "pop", exit: "shrink" },
  },
  // The whole stream picture (webcam included) between two black bands, like a film: the title above, the subtitles below
  accroche: {
    background: "color",
    bgColor: "#000000",
    dim: 0,
    cam: null,
    game: { box: { x: 0, y: 660, w: 1080, h: 608 }, frame: frame(0), whole: true },
    subtitles: { box: { x: 150, y: 1290, w: 780, h: 140 }, font: "poppins", size: 50, uppercase: false, words: 5, stroke: false },
    hook: { box: { x: 60, y: 420, w: 960, h: 210 }, style: "outline", font: "bebas", size: 100, until: null },
    brand: { kind: "channel-pill", box: { x: 240, y: 290, w: 600, h: 60 }, enter: "pop", exit: "shrink" },
  },
  // Webcam and game as cards on the blurred clip, the channel pill hanging under the webcam
  signature: {
    background: "blur",
    dim: 0.55,
    cam: { box: { x: 230, y: 210, w: 620, h: 560 }, frame: frame(48, 6, "accent", true) },
    game: { box: { x: 40, y: 830, w: 1000, h: 563 }, frame: frame(32, 0, "white", true) },
    subtitles: { box: { x: 150, y: 1220, w: 780, h: 160 }, font: "montserrat", size: 64, uppercase: true, words: 3, stroke: true },
    hook: { box: { x: 100, y: 860, w: 880, h: 140 }, style: "brand", font: "poppins", size: 50, until: 3.5 },
    brand: { kind: "channel-pill", box: { x: 240, y: 740, w: 600, h: 60 }, enter: "pop", exit: "shrink" },
  },
  // Just the game, the hook line for the first half
  sanscam: {
    background: "blur",
    dim: 0.45,
    cam: null,
    game: { box: { x: 0, y: 240, w: 1080, h: 1350 }, frame: frame(0) },
    subtitles: { box: { x: 150, y: 1060, w: 780, h: 240 }, font: "montserrat", size: 66, uppercase: true, words: 3, stroke: true },
    hook: { box: { x: 100, y: 280, w: 880, h: 160 }, style: "box", font: "poppins", size: 56, until: "half" },
    brand: { kind: "channel-pill", box: { x: 190, y: 1352, w: 700, h: 68 }, enter: "bounce", exit: "shrink" },
    extras: [followAtEnd({ x: 290, y: 760, w: 500, h: 160 })],
  },
};

/** Layouts on a clip where nobody is in the webcam (mode réalisateur, a break...) */
const WITHOUT_CAM: Partial<Record<TemplateId, Layout>> = {
  // The game card moves up, the hook line above it like a title
  signature: {
    ...LAYOUTS.signature,
    cam: null,
    game: { box: { x: 40, y: 600, w: 1000, h: 563 }, frame: frame(32, 0, "white", true) },
    subtitles: { ...LAYOUTS.signature.subtitles, box: { x: 150, y: 1180, w: 780, h: 160 } },
    hook: { ...LAYOUTS.signature.hook, box: { x: 100, y: 400, w: 880, h: 160 } },
    brand: { kind: "channel-pill", box: { x: 240, y: 1360, w: 600, h: 60 }, enter: "bounce", exit: "shrink" },
  },
  // The pill becomes a name tag on the scene
  discussion: {
    ...LAYOUTS.discussion,
    cam: null,
    brand: { kind: "channel-pill", box: { x: 40, y: 230, w: 600, h: 64 }, enter: "slideLeft", exit: "slideLeft", fields: { align: "left" } },
  },
  plein: { ...LAYOUTS.plein, cam: null },
};

/** A layout for this clip: the stacked ones fall back on "Sans cam" with their own lettering */
function layoutFor(id: TemplateId, hasCam: boolean): Layout {
  const l = LAYOUTS[id];
  if (hasCam || !l.cam) return l;
  const own = WITHOUT_CAM[id];
  if (own) return own;
  const s = LAYOUTS.sanscam;
  return { ...s, subtitles: { ...l.subtitles, box: s.subtitles.box }, hook: { ...l.hook, box: s.hook.box } };
}

/** A webcam spot for layouts without one (shown again in the editor) */
const SPARE_CAM = { box: { x: 230, y: 210, w: 620, h: 560 }, frame: frame(48, 6, "accent", true) };

export interface BuiltInOptions {
  /** The clip has a webcam (layouts built around it move things around without one) */
  hasCam?: boolean;
  subtitleStyle?: SubtitleStyle;
  /** The channel's widgets: shown or not, and when */
  widget?: { enabled: boolean; timing: WidgetTimingKind };
  /** Adjustments of a template saved by the first version of the editor */
  look?: TemplateLook;
  id?: string;
  name?: string;
}

function subtitlesSpec(s: Subtitles, style: SubtitleStyle): TemplateSpec["subtitles"] {
  const speakers = !!s.speakers;
  // "Discret": small text on a dark box, whatever the layout
  if (style === "minimal") {
    return { box: { ...s.box }, font: "geist", size: 50, color: "white", highlight: "none", uppercase: false, stroke: false, boxed: true, speakers, pop: false, words: 5 };
  }
  return {
    box: { ...s.box },
    font: s.font,
    size: s.size,
    color: "white",
    highlight: style === "karaoke" && !speakers ? "highlight" : "none",
    uppercase: s.uppercase,
    stroke: s.stroke,
    boxed: false,
    speakers,
    pop: true,
    words: s.words,
  };
}

/** One of the 7 layouts as an element template */
export function builtInSpec(id: TemplateId, o: BuiltInOptions = {}): TemplateSpec {
  const l = layoutFor(id, o.hasCam !== false);
  const widget = o.widget ?? { enabled: true, timing: "start" };
  const widgets: SpecWidget[] = [];
  if (widget.enabled && l.brand) {
    const b = l.brand;
    widgets.push({
      id: b.kind === "channel-pill" ? "w-pill" : "w-brand",
      kind: b.kind,
      box: { ...b.box },
      timing: widget.timing,
      show: SHOW_PRESETS[widget.timing],
      enter: b.enter,
      exit: b.exit,
      fields: { ...b.fields },
    });
  }
  for (const e of widget.enabled ? (l.extras ?? []) : []) {
    // The channel's widget already comes at the end: no follow button on top of it
    if (widget.timing === "end" && timingOf(e.show) === "end") continue;
    widgets.push({ id: e.id, kind: e.kind, box: { ...e.box }, timing: timingOf(e.show), show: { ...e.show }, enter: e.enter, exit: e.exit, fields: { ...e.fields } });
  }
  const spec: TemplateSpec = {
    version: 2,
    id: o.id ?? newSpecId(),
    name: o.name ?? "",
    base: id,
    background: { kind: l.background, color: l.bgColor ?? "dark", dim: l.dim },
    game: { box: { ...l.game.box }, frame: { ...l.game.frame }, ...(l.game.whole ? { whole: true } : {}) },
    cam: l.cam ? { visible: true, box: { ...l.cam.box }, frame: { ...l.cam.frame } } : { visible: false, box: { ...SPARE_CAM.box }, frame: { ...SPARE_CAM.frame } },
    chat: l.chat ? { visible: true, ...l.chat, box: { ...l.chat.box } } : { ...DEFAULT_CHAT, box: { ...DEFAULT_CHAT.box } },
    subtitles: subtitlesSpec(l.subtitles, o.subtitleStyle ?? "bold"),
    hook: { visible: true, ...l.hook, box: { ...l.hook.box } },
    widgets,
    ...(l.order ? { order: [...l.order] } : {}),
  };
  return o.look ? applyLook(spec, o.look) : spec;
}

/** The layers of one of the 7 layouts for a clip */
export function buildTemplate(id: TemplateId, ctx: TemplateContext, look?: TemplateLook): Layer[] {
  return buildFromSpec(
    builtInSpec(id, {
      hasCam: !!ctx.facecam,
      subtitleStyle: ctx.subtitleStyle,
      widget: { enabled: ctx.widget.enabled && !!ctx.login, timing: ctx.widget.timing },
      look,
    }),
    ctx,
  );
}

/** A layout to start a template of one's own from (the editor) */
export function specFromLayout(
  layoutId: TemplateId,
  options: { subtitleStyle?: SubtitleStyle; widgetTiming?: WidgetTimingKind; id?: string; name?: string } = {},
): TemplateSpec {
  return builtInSpec(layoutId, {
    subtitleStyle: options.subtitleStyle,
    widget: { enabled: true, timing: options.widgetTiming ?? "start" },
    id: options.id,
    name: options.name,
  });
}

/* ── Templates saved by the first version of the editor (a layout + a look) ── */

const SIZE = { s: 0.82, m: 1, l: 1.18 } as const;
const FONT = { s: 0.82, m: 1, l: 1.2 } as const;
const SUBTITLE_CENTER = { top: 420, middle: 960, bottom: 1300 } as const;

function applyLook(spec: TemplateSpec, look: TemplateLook): TemplateSpec {
  const next: TemplateSpec = structuredClone(spec);
  // Webcam: bigger or smaller around its spot, round, framed in white, the channel color or not at all
  const cam = next.cam.box;
  const border = look.camBorder === "none" ? 0 : Math.max(next.cam.frame.border, 5);
  const k = Math.min(SIZE[look.camSize], (1080 - 2 * border) / cam.w, (1920 - 2 * border) / cam.h);
  let w = cam.w * k;
  let h = cam.h * k;
  if (look.camShape === "circle") w = h = Math.min(w, h);
  next.cam.box = {
    x: Math.round(Math.min(Math.max(cam.x + (cam.w - w) / 2, border), 1080 - w - border)),
    y: Math.round(Math.min(Math.max(cam.y + (cam.h - h) / 2, border), 1920 - h - border)),
    w: Math.round(w),
    h: Math.round(h),
  };
  next.cam.frame = {
    ...next.cam.frame,
    border,
    borderColor: look.camBorder === "accent" ? "accent" : "white",
    shadow: look.camBorder !== "none" && next.cam.frame.shadow,
    radius: look.camShape === "circle" ? Math.round(w) / 2 : next.cam.frame.radius,
  };
  next.background.kind = look.background;
  // Subtitles: moved and resized
  const subs = next.subtitles;
  if (look.subtitlePosition !== "auto") subs.box.y = Math.round(SUBTITLE_CENTER[look.subtitlePosition] - subs.box.h / 2);
  subs.size = Math.round(subs.size * FONT[look.subtitleSize]);
  // Channel widget: moved or dropped
  const channel = next.widgets.filter((w) => w.id === "w-pill" || w.id === "w-brand");
  if (look.widgetPosition === "none") next.widgets = [];
  else if (look.widgetPosition === "top") channel.forEach((w) => (w.box = { x: 190, y: 216, w: 700, h: 68 }));
  else if (look.widgetPosition === "bottom") channel.forEach((w) => (w.box = { x: 190, y: 1352, w: 700, h: 68 }));
  if (look.hook === "off") next.hook.visible = false;
  return next;
}

/** Templates saved by the first version of the editor, in the current format */
export function upgradeTemplate(t: TemplateSpec | CustomTemplate): TemplateSpec {
  if ((t as TemplateSpec).version === 2) return t as TemplateSpec;
  const old = t as CustomTemplate;
  return builtInSpec(old.base, { look: old.look, id: old.id, name: old.name });
}
