/**
 * Cuttie's 6 layouts, as element templates: built like the streamer's own
 * (buildFromSpec), with the channel's subtitle style and widget settings, so
 * they get the same widgets, animations and frames.
 */

import type { SubtitleStyle } from "./api";
import type { Layer } from "./editorTypes";
import type { FontId } from "./fonts";
import { buildFromSpec, newSpecId, SHOW_PRESETS, type Box, type FrameStyle, type SpecWidget, type TemplateSpec, type WidgetTimingKind } from "./templateSpec";
import type { CustomTemplate, TemplateContext, TemplateId, TemplateLook } from "./templates";

const frame = (radius: number, border = 0, borderColor = "white", shadow = false): FrameStyle => ({ radius, border, borderColor, shadow });

/** Where things sit in a layout (the subtitles' look comes from the channel) */
interface Layout {
  background: TemplateSpec["background"]["kind"];
  game: { box: Box; frame: FrameStyle };
  cam: { box: Box; frame: FrameStyle } | null;
  subtitles: { box: Box; size: number; speakers?: boolean };
  hook?: { box: Box; style: "outline" | "box"; font: FontId; size: number };
  /** The channel pill */
  pill: Box | null;
}

/*
 * Text, webcam and brand stay out of what TikTok / Shorts / Reels cover
 * (COVERED_ZONES): the tabs above y 140, the description below y 1500, the
 * buttons right of x 930 between y 760 and 1500. Subtitles sit centered
 * between x 150 and 930. Only the game runs under them.
 */
const LAYOUTS: Record<TemplateId, Layout> = {
  // The channel pill hangs on the bottom edge of the webcam, like a name tag
  signature: {
    background: "blur",
    cam: { box: { x: 250, y: 150, w: 580, h: 640 }, frame: frame(44, 6) },
    game: { box: { x: 40, y: 852, w: 1000, h: 660 }, frame: frame(36) },
    subtitles: { box: { x: 150, y: 1236, w: 780, h: 250 }, size: 90 },
    pill: { x: 190, y: 748, w: 700, h: 84 },
  },
  // The game fills the frame
  plein: {
    background: "dark",
    game: { box: { x: 0, y: 0, w: 1080, h: 1920 }, frame: frame(0) },
    cam: { box: { x: 52, y: 250, w: 330, h: 366 }, frame: frame(32, 5) },
    subtitles: { box: { x: 150, y: 1180, w: 780, h: 250 }, size: 90 },
    pill: { x: 140, y: 152, w: 800, h: 76 },
  },
  reaction: {
    background: "blur",
    cam: { box: { x: 40, y: 150, w: 1000, h: 760 }, frame: frame(44) },
    game: { box: { x: 40, y: 950, w: 1000, h: 620 }, frame: frame(36) },
    subtitles: { box: { x: 150, y: 805, w: 780, h: 250 }, size: 88 },
    pill: { x: 190, y: 1404, w: 700, h: 80 },
  },
  discussion: {
    background: "blur",
    game: { box: { x: 0, y: 340, w: 1080, h: 1080 }, frame: frame(0) },
    cam: { box: { x: 60, y: 186, w: 330, h: 330 }, frame: frame(165, 10, "accent") },
    subtitles: { box: { x: 150, y: 1150, w: 780, h: 330 }, size: 80, speakers: true },
    pill: { x: 420, y: 230, w: 600, h: 80 },
  },
  sanscam: {
    background: "blur",
    game: { box: { x: 0, y: 400, w: 1080, h: 1250 }, frame: frame(0) },
    cam: null,
    hook: { box: { x: 40, y: 150, w: 1000, h: 230 }, style: "outline", font: "luckiest", size: 86 },
    subtitles: { box: { x: 150, y: 1120, w: 780, h: 250 }, size: 90 },
    pill: { x: 190, y: 1404, w: 700, h: 80 },
  },
  accroche: {
    background: "blur",
    hook: { box: { x: 80, y: 150, w: 920, h: 230 }, style: "box", font: "geist", size: 58 },
    game: { box: { x: 0, y: 410, w: 1080, h: 700 }, frame: frame(0) },
    subtitles: { box: { x: 150, y: 890, w: 780, h: 240 }, size: 84 },
    cam: { box: { x: 375, y: 1140, w: 330, h: 330 }, frame: frame(40, 6) },
    pill: { x: 240, y: 1420, w: 600, h: 72 },
  },
};

/** Signature on a clip without webcam: the game centered, the pill above it */
const SIGNATURE_NO_CAM: Layout = {
  background: "blur",
  cam: null,
  game: { box: { x: 0, y: 520, w: 1080, h: 608 }, frame: frame(0) },
  subtitles: { box: { x: 150, y: 1160, w: 780, h: 250 }, size: 90 },
  pill: { x: 190, y: 400, w: 700, h: 84 },
};

/** A webcam spot for layouts without one (shown again in the editor) */
const SPARE_CAM = { box: { x: 250, y: 150, w: 580, h: 640 }, frame: frame(44, 6) };
const SPARE_HOOK = { box: { x: 40, y: 150, w: 1000, h: 230 }, style: "outline" as const, font: "luckiest" as FontId, size: 86 };

export interface BuiltInOptions {
  /** The clip has a webcam (Signature moves things around without one) */
  hasCam?: boolean;
  subtitleStyle?: SubtitleStyle;
  /** The channel pill: shown or not, and when */
  widget?: { enabled: boolean; timing: WidgetTimingKind };
  /** Adjustments of a template saved by the first version of the editor */
  look?: TemplateLook;
  id?: string;
  name?: string;
}

/** One of the 6 layouts as an element template */
export function builtInSpec(id: TemplateId, o: BuiltInOptions = {}): TemplateSpec {
  const l = id === "signature" && o.hasCam === false ? SIGNATURE_NO_CAM : LAYOUTS[id];
  const style = o.subtitleStyle ?? "bold";
  const minimal = style === "minimal";
  const speakers = !!l.subtitles.speakers;
  const widget = o.widget ?? { enabled: true, timing: "start" };
  const pill: SpecWidget[] =
    widget.enabled && l.pill
      ? [{ id: "w-pill", kind: "channel-pill", box: { ...l.pill }, timing: widget.timing, show: SHOW_PRESETS[widget.timing], enter: "pop", exit: "shrink", fields: {} }]
      : [];
  const spec: TemplateSpec = {
    version: 2,
    id: o.id ?? newSpecId(),
    name: o.name ?? "",
    base: id,
    background: { kind: l.background, color: "dark", dim: 0.42 },
    game: { box: { ...l.game.box }, frame: { ...l.game.frame } },
    cam: l.cam ? { visible: true, box: { ...l.cam.box }, frame: { ...l.cam.frame } } : { visible: false, box: { ...SPARE_CAM.box }, frame: { ...SPARE_CAM.frame } },
    subtitles: {
      box: { ...l.subtitles.box },
      font: minimal ? "geist" : "luckiest",
      size: Math.round(l.subtitles.size * (minimal ? 0.6 : 1)),
      color: "white",
      highlight: style === "karaoke" && !speakers ? "highlight" : "none",
      uppercase: !minimal,
      stroke: !minimal,
      boxed: minimal,
      speakers,
    },
    hook: l.hook ? { visible: true, ...l.hook, box: { ...l.hook.box } } : { visible: false, ...SPARE_HOOK, box: { ...SPARE_HOOK.box } },
    widgets: pill,
  };
  return o.look ? applyLook(spec, o.look) : spec;
}

/** The layers of one of the 6 layouts for a clip */
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
const SUBTITLE_CENTER = { top: 420, middle: 960, bottom: 1365 } as const;

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
    radius: look.camShape === "circle" ? Math.round(w) / 2 : next.cam.frame.radius,
  };
  next.background.kind = look.background;
  // Subtitles: moved and resized
  const subs = next.subtitles;
  if (look.subtitlePosition !== "auto") subs.box.y = Math.round(SUBTITLE_CENTER[look.subtitlePosition] - subs.box.h / 2);
  subs.size = Math.round(subs.size * FONT[look.subtitleSize]);
  // Channel pill: moved or dropped
  if (look.widgetPosition === "none") next.widgets = [];
  else if (look.widgetPosition === "top") next.widgets.forEach((w) => (w.box = { x: 140, y: 152, w: 800, h: 76 }));
  else if (look.widgetPosition === "bottom") next.widgets.forEach((w) => (w.box = { x: 190, y: 1410, w: 700, h: 76 }));
  if (look.hook === "off") next.hook.visible = false;
  return next;
}

/** Templates saved by the first version of the editor, in the current format */
export function upgradeTemplate(t: TemplateSpec | CustomTemplate): TemplateSpec {
  if ((t as TemplateSpec).version === 2) return t as TemplateSpec;
  const old = t as CustomTemplate;
  return builtInSpec(old.base, { look: old.look, id: old.id, name: old.name });
}
