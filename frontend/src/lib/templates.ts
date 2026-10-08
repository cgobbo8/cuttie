/**
 * Building blocks of the clip templates (1080x1920 canvas): the clip context,
 * video crops, shapes, the blurred backdrop. The layouts themselves are in
 * builtinTemplates.ts, the element templates in templateSpec.ts.
 */

import type { BrandColors, SubtitleStyle, WidgetTiming } from "./api";
import { DEFAULT_STYLE, type Layer, type LayerTransform, type SubtitleWord } from "./editorTypes";

/** Ids kept from the first layouts: "plein" is shown as Action, "accroche" as Cinéma */
export type TemplateId = "empile" | "signature" | "reaction" | "discussion" | "plein" | "accroche" | "sanscam";

export const TEMPLATE_IDS: TemplateId[] = ["empile", "signature", "reaction", "discussion", "plein", "accroche", "sanscam"];

/** Templates built around the webcam */
export const NEEDS_WEBCAM: TemplateId[] = ["empile", "reaction", "discussion"];

/** Templates that show the hook line (all of them: it's the clip's cover) */
export const HAS_HOOK: TemplateId[] = [...TEMPLATE_IDS];

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
  /** For the brand widgets */
  displayName?: string | null;
  followers?: number | null;
  game?: string | null;
}

export const W = 1080;
export const H = 1920;
export const GEIST = '"Geist Variable", "Geist", system-ui, sans-serif';

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

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

export function base(name: string, type: Layer["type"], t: LayerTransform): Layer {
  return { id: uid(type), name, type, visible: true, locked: false, transform: t, style: { ...DEFAULT_STYLE } };
}

export function video(ctx: TemplateContext, name: string, type: "gameplay" | "facecam", region: Rect, t: LayerTransform, radius = 0, blur = 0): Layer {
  const layer = base(name, type, t);
  layer.video = { src: ctx.src, crop: coverCrop(region, t.width / t.height), nativeWidth: ctx.frameW, nativeHeight: ctx.frameH };
  layer.style = { ...layer.style, borderRadius: radius, blur };
  return layer;
}

export function shape(name: string, t: LayerTransform, color: string, alpha: number, radius: number, shadow = "none", circle = false): Layer {
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
export function blurredBackground(ctx: TemplateContext): Layer[] {
  const bg = base("Fond flouté", "gameplay", { x: 0, y: 0, width: W, height: H });
  bg.video = { src: ctx.backgroundSrc, background: true };
  bg.locked = true;
  return [bg, shape("Assombrir", { x: 0, y: 0, width: W, height: H }, "#000000", 0.42, 0)];
}

/** What a streamer could adjust on a base template in the first version of the editor */
export interface TemplateLook {
  camSize: "s" | "m" | "l";
  camShape: "rounded" | "circle";
  camBorder: "white" | "accent" | "none";
  background: "blur" | "dark" | "brand";
  /** "auto": where the base template puts them */
  subtitlePosition: "auto" | "top" | "middle" | "bottom";
  subtitleSize: "s" | "m" | "l";
  widgetPosition: "auto" | "top" | "bottom" | "none";
  /** Only for the templates built around a hook line */
  hook: "on" | "off";
}

/** A template saved by the first version of the editor: a base layout and adjustments */
export interface CustomTemplate {
  id: string;
  name: string;
  base: TemplateId;
  look: TemplateLook;
}

/**
 * Layer ids from their names (unique within a template): rebuilding after a
 * setting changes keeps the same React keys, so the preview's videos stay put.
 */
export function stableIds(layers: Layer[]): Layer[] {
  // Layers built with their own stable id (template widgets) keep it
  return layers.map((l) => (l.id.startsWith("tpl-") ? l : { ...l, id: `tpl-${l.name.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}` }));
}

/**
 * A sensible template for a moment, from what happens in it. `camWidth`: the
 * stream's webcam width in clip pixels; enlarged more than twice to fill the
 * frame's width, it gets soft, so small webcams go in a card instead.
 */
export function suggestTemplate(category: string | undefined, hasWebcam: boolean, excitement = 0, speech = 0, camWidth = 0): TemplateId {
  if (!hasWebcam) return "sanscam";
  const bigCam = camWidth * 2 >= W;
  if (category === "storytelling" || category === "awkward" || speech >= 0.7) return bigCam ? "discussion" : "accroche";
  if (category === "reaction" || category === "emotional" || excitement >= 0.9) return bigCam ? "reaction" : "signature";
  if (category === "fail" || category === "clutch" || category === "skill") return "plein";
  return bigCam ? "empile" : "signature";
}
