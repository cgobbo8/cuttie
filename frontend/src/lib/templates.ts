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

/** What a streamer can adjust on top of a base template (the simple template editor) */
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

const LOOK: TemplateLook = {
  camSize: "m",
  camShape: "rounded",
  camBorder: "white",
  background: "blur",
  subtitlePosition: "auto",
  subtitleSize: "m",
  widgetPosition: "auto",
  hook: "on",
};

/** How each base template looks out of the box */
export const NATIVE_LOOKS: Record<TemplateId, TemplateLook> = {
  signature: LOOK,
  plein: LOOK,
  reaction: { ...LOOK, camBorder: "none" },
  discussion: { ...LOOK, camShape: "circle", camBorder: "accent" },
  sanscam: LOOK,
  accroche: LOOK,
};

/** A streamer's own template: a base layout and their adjustments */
export interface CustomTemplate {
  id: string;
  name: string;
  base: TemplateId;
  look: TemplateLook;
}

const SIZE = { s: 0.82, m: 1, l: 1.18 } as const;
const FONT = { s: 0.82, m: 1, l: 1.2 } as const;
const FULL: LayerTransform = { x: 0, y: 0, width: W, height: H };

function backdrop(ctx: TemplateContext, look: TemplateLook): Layer[] {
  if (look.background === "blur") return blurredBackground(ctx);
  const layers = [shape("Fond", FULL, ctx.colors.dark, 1, 0)];
  if (look.background === "brand") layers.push(shape("Teinte", FULL, ctx.colors.accent, 0.55, 0));
  for (const l of layers) l.locked = true;
  return layers;
}

/** Where the webcam sits in a base template, and its rounded corners / frame width */
interface CamSpot {
  box: LayerTransform;
  radius: number;
  border: number;
}

/** The webcam in its spot, resized / reshaped / framed as the look says */
function cam(ctx: TemplateContext, spot: CamSpot, look: TemplateLook): Layer[] {
  if (!ctx.facecam) return [];
  const { box } = spot;
  const border = look.camBorder === "none" ? 0 : spot.border;
  // Bigger, but never wider than the frame (the "Reaction" cam is already 1000 px)
  const scale = Math.min(SIZE[look.camSize], (W - 2 * border) / box.width, (H - 2 * border) / box.height);
  let w = box.width * scale;
  let h = box.height * scale;
  if (look.camShape === "circle") w = h = Math.min(w, h);
  const x = Math.round(Math.min(Math.max(box.x + (box.width - w) / 2, border), W - w - border));
  const y = Math.round(Math.min(Math.max(box.y + (box.height - h) / 2, border), H - h - border));
  const t = { x, y, width: Math.round(w), height: Math.round(h) };
  const circle = look.camShape === "circle";
  const radius = circle ? t.width / 2 : spot.radius;

  const layers: Layer[] = [];
  if (border) {
    const frame = { x: t.x - border, y: t.y - border, width: t.width + border * 2, height: t.height + border * 2 };
    layers.push(
      look.camBorder === "accent"
        ? shape("Anneau de la cam", frame, ctx.colors.accent, 1, radius + border, "none", circle)
        : shape("Cadre de la cam", frame, "#FFFFFF", 1, radius + border, "none", circle),
    );
  }
  layers.push(video(ctx, "Webcam", "facecam", ctx.facecam, t, radius));
  return layers;
}

const SUBTITLE_CENTER = { top: 420, middle: 960, bottom: 1540 } as const;

function placedSubtitles(ctx: TemplateContext, t: LayerTransform, fontSize: number, look: TemplateLook, speakers = false): Layer {
  const y = look.subtitlePosition === "auto" ? t.y : SUBTITLE_CENTER[look.subtitlePosition] - t.height / 2;
  return subtitles(ctx, { ...t, y: Math.round(y) }, Math.round(fontSize * FONT[look.subtitleSize]), speakers);
}

function placedWidget(ctx: TemplateContext, t: LayerTransform, look: TemplateLook): Layer[] {
  if (look.widgetPosition === "none") return [];
  if (look.widgetPosition === "top") return channelWidget(ctx, { x: 140, y: 62, width: 800, height: 82 });
  if (look.widgetPosition === "bottom") return channelWidget(ctx, { x: 140, y: 1770, width: 800, height: 82 });
  return channelWidget(ctx, t);
}

/**
 * Layer ids from their names (unique within a template): rebuilding after a
 * setting changes keeps the same React keys, so the preview's videos stay put.
 */
function stableIds(layers: Layer[]): Layer[] {
  return layers.map((l) => ({ ...l, id: `tpl-${l.name.normalize("NFD").replace(/[^\w]+/g, "-").toLowerCase()}` }));
}

export function buildTemplate(id: TemplateId, ctx: TemplateContext, look: TemplateLook = NATIVE_LOOKS[id]): Layer[] {
  return stableIds(layout(id, ctx, look));
}

function layout(id: TemplateId, ctx: TemplateContext, look: TemplateLook): Layer[] {
  const game = gameRegion(ctx);
  const hasCam = !!ctx.facecam;
  const hook = look.hook === "on";

  switch (id) {
    case "signature":
      return [
        ...backdrop(ctx, look),
        ...cam(ctx, { box: { x: 240, y: 150, width: 600, height: 666 }, radius: 44, border: 6 }, look),
        hasCam
          ? video(ctx, "Jeu", "gameplay", game, { x: 40, y: 868, width: 1000, height: 711 }, 36)
          : video(ctx, "Jeu", "gameplay", game, { x: 0, y: 656, width: W, height: 608 }),
        placedSubtitles(ctx, { x: 60, y: 1310, width: 960, height: 190 }, 96, look),
        ...placedWidget(ctx, { x: 140, y: 1640, width: 800, height: 96 }, look),
      ];

    case "plein":
      // The game fills the frame: no backdrop to pick
      return [
        video(ctx, "Jeu", "gameplay", game, FULL),
        ...cam(ctx, { box: { x: 52, y: 190, width: 330, height: 366 }, radius: 32, border: 5 }, look),
        placedSubtitles(ctx, { x: 60, y: 1200, width: 960, height: 190 }, 94, look),
        ...placedWidget(ctx, { x: 140, y: 62, width: 800, height: 82 }, look),
      ];

    case "reaction":
      return [
        ...backdrop(ctx, look),
        ...cam(ctx, { box: { x: 40, y: 56, width: 1000, height: 900 }, radius: 44, border: 6 }, look),
        video(ctx, "Jeu", "gameplay", game, { x: 40, y: 1010, width: 1000, height: 711 }, 36),
        placedSubtitles(ctx, { x: 60, y: 890, width: 960, height: 190 }, 90, look),
        ...placedWidget(ctx, { x: 140, y: 1770, width: 800, height: 82 }, look),
      ];

    case "discussion":
      return [
        ...backdrop(ctx, look),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 330, width: W, height: 1080 }),
        ...cam(ctx, { box: { x: 60, y: 196, width: 330, height: 330 }, radius: 40, border: 10 }, look),
        placedSubtitles(ctx, { x: 60, y: 1460, width: 960, height: 300 }, 82, look, true),
        ...placedWidget(ctx, { x: 260, y: 62, width: 800, height: 82 }, look),
      ];

    case "sanscam":
      return [
        ...backdrop(ctx, look),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 330, width: W, height: 1350 }),
        ...(hook ? hookText(ctx, { x: 40, y: 70, width: 1000, height: 230 }, "outline") : []),
        placedSubtitles(ctx, { x: 60, y: 1310, width: 960, height: 190 }, 92, look),
        ...placedWidget(ctx, { x: 140, y: 1730, width: 800, height: 82 }, look),
      ];

    case "accroche":
      return [
        ...backdrop(ctx, look),
        ...(hook ? hookText(ctx, { x: 80, y: 135, width: 920, height: 240 }, "box") : []),
        video(ctx, "Jeu", "gameplay", game, { x: 0, y: 470, width: W, height: 768 }),
        placedSubtitles(ctx, { x: 60, y: 1050, width: 960, height: 190 }, 88, look),
        ...cam(ctx, { box: { x: 340, y: 1300, width: 400, height: 444 }, radius: 40, border: 6 }, look),
        ...placedWidget(ctx, { x: 140, y: 1790, width: 800, height: 82 }, look),
      ];
  }
}

/** One of the 6 base templates, or the id of a streamer's own template */
export type TemplateKey = string;

export function findCustom(key: TemplateKey, customs: CustomTemplate[]): CustomTemplate | undefined {
  return customs.find((t) => t.id === key);
}

/** The base layout behind a template key (unknown keys fall back to Signature) */
export function baseOf(key: TemplateKey, customs: CustomTemplate[]): TemplateId {
  const custom = findCustom(key, customs);
  if (custom) return custom.base;
  return (TEMPLATE_IDS as string[]).includes(key) ? (key as TemplateId) : "signature";
}

export function lookOf(key: TemplateKey, customs: CustomTemplate[]): TemplateLook {
  return findCustom(key, customs)?.look ?? NATIVE_LOOKS[baseOf(key, customs)];
}

/** Layers of any template: one of the 6, or a streamer's own */
export function buildAny(key: TemplateKey, ctx: TemplateContext, customs: CustomTemplate[]): Layer[] {
  return buildTemplate(baseOf(key, customs), ctx, lookOf(key, customs));
}

/** The template shows a hook line (the input in Montage only applies then) */
export function showsHook(key: TemplateKey, customs: CustomTemplate[]): boolean {
  return HAS_HOOK.includes(baseOf(key, customs)) && lookOf(key, customs).hook === "on";
}

export function newTemplateId(): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `custom-${random}`;
}

/** A sensible template for a moment, from what happens in it */
export function suggestTemplate(category: string | undefined, hasWebcam: boolean, excitement = 0, speech = 0): TemplateId {
  if (!hasWebcam) return "sanscam";
  if (category === "storytelling" || category === "awkward" || speech >= 0.7) return "discussion";
  if (category === "reaction" || category === "emotional" || excitement >= 0.9) return "reaction";
  if (category === "fail" || category === "clutch" || category === "skill") return "plein";
  return "signature";
}
