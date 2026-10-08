/**
 * The 6 base clip templates, as editor layers (1080x1920 canvas).
 * Built from the clip (size, webcam, words) and the streamer's brand kit, so
 * the preview (Remotion Player) and the export (server renderer) are the same.
 */

import type { BrandColors, SubtitleStyle, WidgetTiming } from "./api";
import { DEFAULT_STYLE, type Layer, type LayerAnimation, type LayerTransform, type SubtitleWord } from "./editorTypes";

export type TemplateId = "signature" | "plein" | "reaction" | "discussion" | "sanscam" | "accroche";

export const TEMPLATE_IDS: TemplateId[] = ["signature", "plein", "reaction", "discussion", "sanscam", "accroche"];

/** Templates built around the webcam */
export const NEEDS_WEBCAM: TemplateId[] = ["reaction", "discussion"];

/** Templates that show the hook line at the top */
export const HAS_HOOK: TemplateId[] = ["sanscam", "accroche"];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateContext {
  /** Clip video URL (the renderer swaps it for a signed one) */
  src: string;
  /** The clip's blurred 9:16 version (see clipBackgroundUrl) */
  backgroundSrc: string;
  frameW: number;
  frameH: number;
  /** Webcam overlay in clip pixels, null = none */
  facecam: Rect | null;
  words: SubtitleWord[];
  /** Trimmed range of the clip, in clip seconds (the render keeps clip time) */
  startAt: number;
  endAt: number;
  colors: BrandColors;
  subtitleStyle: SubtitleStyle;
  widget: { enabled: boolean; timing: WidgetTiming };
  login: string | null;
  avatarUrl: string | null;
  /** Hook line for the templates that show one */
  hook: string;
}

const W = 1080;
const H = 1920;
const GEIST = '"Geist Variable", "Geist", system-ui, sans-serif';

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** Largest window of `region` with the box's aspect ratio, centered */
export function coverCrop(region: Rect, boxAspect: number, cy = 0.5): Rect {
  if (region.w / region.h > boxAspect) {
    const w = region.h * boxAspect;
    return { x: Math.round(region.x + (region.w - w) / 2), y: region.y, w: Math.round(w), h: region.h };
  }
  const h = region.w / boxAspect;
  return { x: region.x, y: Math.round(region.y + (region.h - h) * cy), w: region.w, h: Math.round(h) };
}

/** Gameplay next to the webcam column (the whole frame when there is no webcam) */
export function gameRegion(ctx: Pick<TemplateContext, "facecam" | "frameW" | "frameH">): Rect {
  const cam = ctx.facecam;
  const full = { x: 0, y: 0, w: ctx.frameW, h: ctx.frameH };
  if (!cam || cam.w > ctx.frameW * 0.6) return full;
  return cam.x + cam.w / 2 > ctx.frameW / 2
    ? { x: 0, y: 0, w: cam.x, h: ctx.frameH }
    : { x: cam.x + cam.w, y: 0, w: ctx.frameW - cam.x - cam.w, h: ctx.frameH };
}

function base(name: string, type: Layer["type"], t: LayerTransform): Layer {
  return { id: uid(type), name, type, visible: true, locked: false, transform: t, style: { ...DEFAULT_STYLE } };
}

function video(ctx: TemplateContext, name: string, type: "gameplay" | "facecam", region: Rect, t: LayerTransform, radius = 0, blur = 0): Layer {
  const layer = base(name, type, t);
  layer.video = { src: ctx.src, crop: coverCrop(region, t.width / t.height), nativeWidth: ctx.frameW, nativeHeight: ctx.frameH };
  layer.style = { ...layer.style, borderRadius: radius, blur };
  return layer;
}

function shape(name: string, t: LayerTransform, color: string, alpha: number, radius: number, shadow = "none", circle = false): Layer {
  const layer = base(name, "shape", t);
  layer.shape = { shapeType: circle ? "circle" : "rectangle", backgroundColor: color, backgroundAlpha: alpha, backdropBlur: 0, boxShadowPreset: shadow };
  layer.style = { ...layer.style, borderRadius: radius };
  return layer;
}

/**
 * The clip enlarged and blurred behind everything, darkened. The blur is baked
 * into a small video by the API: blurring the full clip in the renderer cost
 * ~150 ms per frame.
 */
function blurredBackground(ctx: TemplateContext): Layer[] {
  const bg = base("Fond flouté", "gameplay", { x: 0, y: 0, width: W, height: H });
  bg.video = { src: ctx.backgroundSrc, background: true };
  bg.locked = true;
  return [bg, shape("Assombrir", { x: 0, y: 0, width: W, height: H }, "#000000", 0.42, 0)];
}

function subtitles(ctx: TemplateContext, t: LayerTransform, fontSize: number, speakers = false): Layer {
  const layer = base("Sous-titres", "subtitles", t);
  const minimal = ctx.subtitleStyle === "minimal";
  layer.subtitle = {
    words: ctx.words,
    fontFamily: minimal ? "Geist Variable" : "Luckiest Guy",
    fontSize: minimal ? Math.round(fontSize * 0.6) : fontSize,
    colorMode: "custom",
    customColor: speakers ? ctx.colors.accent : "#FFFFFF",
    autoColor: "#FFFFFF",
    uppercase: !minimal,
    showSpeaker: speakers && !minimal,
    ...(ctx.subtitleStyle === "karaoke" && !speakers ? { activeColor: ctx.colors.highlight, restColor: "#FFFFFF" } : {}),
    ...(minimal ? { boxed: true } : {}),
  };
  return layer;
}

function channelWidget(ctx: TemplateContext, t: LayerTransform): Layer[] {
  if (!ctx.widget.enabled || !ctx.login) return [];
  const layer = base("Widget de chaîne", "widget", t);
  layer.widget = {
    widgetId: "channel-pill",
    props: { login: ctx.login, avatarUrl: ctx.avatarUrl ?? "", darkColor: ctx.colors.dark, lightColor: ctx.colors.light },
  };
  const anim = (type: LayerAnimation["type"], time: number, duration = 0.45): LayerAnimation => ({
    id: uid("anim"),
    type,
    time: Math.max(0, time),
    duration,
    easing: "easeOut.power3",
  });
  if (ctx.widget.timing === "start") layer.animations = [anim("slideInBottom", ctx.startAt + 0.25), anim("fadeOut", ctx.startAt + 3.25, 0.35)];
  else if (ctx.widget.timing === "end") layer.animations = [anim("slideInBottom", ctx.endAt - 3.5)];
  else layer.animations = [anim("slideInBottom", ctx.startAt + 0.25)];
  return [layer];
}

function hookText(ctx: TemplateContext, t: LayerTransform, style: "outline" | "box"): Layer[] {
  if (!ctx.hook.trim()) return [];
  const layers: Layer[] = [];
  if (style === "box") layers.push(shape("Fond de l'accroche", t, "#FFFFFF", 1, 30, "soft"));
  const text = base("Accroche", "text", style === "box" ? { x: t.x + 30, y: t.y + 10, width: t.width - 60, height: t.height - 20 } : t);
  text.text = {
    content: ctx.hook,
    fontFamily: style === "box" ? GEIST : '"Luckiest Guy", system-ui, sans-serif',
    fontSize: style === "box" ? 58 : 86,
    color: style === "box" ? "#0C0C0E" : "#FFFFFF",
    fontWeight: "bold",
    textAlign: "center",
    uppercase: style !== "box",
    lineHeight: style === "box" ? 1.18 : 1.08,
  };
  layers.push(text);
  return layers;
}

/** Webcam with a white frame around it */
function framedCam(ctx: TemplateContext, t: LayerTransform, radius: number, border: number): Layer[] {
  if (!ctx.facecam) return [];
  return [
    shape("Cadre de la cam", { x: t.x - border, y: t.y - border, width: t.width + border * 2, height: t.height + border * 2 }, "#FFFFFF", 1, radius + border),
    video(ctx, "Webcam", "facecam", ctx.facecam, t, radius),
  ];
}

export function buildTemplate(id: TemplateId, ctx: TemplateContext): Layer[] {
  const game = gameRegion(ctx);
  const hasCam = !!ctx.facecam;

  switch (id) {
    case "signature":
      return [
        ...blurredBackground(ctx),
        ...framedCam(ctx, { x: 240, y: 150, width: 600, height: 666 }, 44, 6),
        hasCam
          ? video(ctx, "Jeu", "gameplay", game, { x: 40, y: 868, width: 1000, height: 711 }, 36)
          : video(ctx, "Jeu", "gameplay", game, { x: 0, y: 656, width: W, height: 608 }),
        subtitles(ctx, { x: 60, y: 1310, width: 960, height: 190 }, 96),
        ...channelWidget(ctx, { x: 140, y: 1640, width: 800, height: 96 }),
      ];

    case "plein":
      return [
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 0, width: W, height: H }),
        ...framedCam(ctx, { x: 52, y: 190, width: 330, height: 366 }, 32, 5),
        subtitles(ctx, { x: 60, y: 1200, width: 960, height: 190 }, 94),
        ...channelWidget(ctx, { x: 140, y: 62, width: 800, height: 82 }),
      ];

    case "reaction":
      return [
        ...blurredBackground(ctx),
        ...(hasCam ? [video(ctx, "Webcam", "facecam", ctx.facecam!, { x: 40, y: 56, width: 1000, height: 900 }, 44)] : []),
        video(ctx, "Jeu", "gameplay", game, { x: 40, y: 1010, width: 1000, height: 711 }, 36),
        subtitles(ctx, { x: 60, y: 890, width: 960, height: 190 }, 90),
        ...channelWidget(ctx, { x: 140, y: 1770, width: 800, height: 82 }),
      ];

    case "discussion":
      return [
        ...blurredBackground(ctx),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 330, width: W, height: 1080 }),
        ...(hasCam
          ? [
              shape("Anneau de la cam", { x: 50, y: 186, width: 350, height: 350 }, ctx.colors.accent, 1, 175, "none", true),
              video(ctx, "Webcam", "facecam", ctx.facecam!, { x: 60, y: 196, width: 330, height: 330 }, 165),
            ]
          : []),
        subtitles(ctx, { x: 60, y: 1460, width: 960, height: 300 }, 82, true),
        ...channelWidget(ctx, { x: 260, y: 62, width: 800, height: 82 }),
      ];

    case "sanscam":
      return [
        ...blurredBackground(ctx),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 330, width: W, height: 1350 }),
        ...hookText(ctx, { x: 40, y: 70, width: 1000, height: 230 }, "outline"),
        subtitles(ctx, { x: 60, y: 1310, width: 960, height: 190 }, 92),
        ...channelWidget(ctx, { x: 140, y: 1730, width: 800, height: 82 }),
      ];

    case "accroche":
      return [
        ...blurredBackground(ctx),
        ...hookText(ctx, { x: 80, y: 135, width: 920, height: 240 }, "box"),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 470, width: W, height: 768 }),
        subtitles(ctx, { x: 60, y: 1050, width: 960, height: 190 }, 88),
        ...framedCam(ctx, { x: 340, y: 1300, width: 400, height: 444 }, 40, 6),
        ...channelWidget(ctx, { x: 140, y: 1790, width: 800, height: 82 }),
      ];
  }
}

/** A sensible template for a moment, from what happens in it */
export function suggestTemplate(category: string | undefined, hasWebcam: boolean, excitement = 0, speech = 0): TemplateId {
  if (!hasWebcam) return "sanscam";
  if (category === "storytelling" || category === "awkward" || speech >= 0.7) return "discussion";
  if (category === "reaction" || category === "emotional" || excitement >= 0.9) return "reaction";
  if (category === "fail" || category === "clutch" || category === "skill") return "plein";
  return "signature";
}
