/**
 * Templates made in the simple editor: a fixed set of elements (background,
 * game, webcam, subtitles, hook line, widgets) the streamer moves, resizes and
 * styles on the 1080x1920 frame. Turned into editor layers for the Remotion
 * Player and the server render, like the 6 built-in templates.
 */

import type { BrandColors } from "./api";
import type { AnimationType, EasingPreset, Layer, LayerAnimation } from "./editorTypes";
import { fontFamily, type FontId } from "./fonts";
import { base, blurredBackground, gameRegion, H, shape, stableIds, uid, video, W, type Rect, type TemplateContext, type TemplateId } from "./templates";
import { kitWidget, type KitWidgetId } from "../components/editor/widgets/kit";
import { inkOn } from "../components/editor/widgets/kit/shared";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** "accent" | "highlight" | "dark" | "light" (the channel's colors), "white", or a #RRGGBB */
export type ColorRef = string;

export interface FrameStyle {
  /** Corner radius, frame pixels */
  radius: number;
  /** Outline width, 0 = none */
  border: number;
  borderColor: ColorRef;
  shadow: boolean;
}

export type WidgetKind = KitWidgetId | "channel-pill";
/** When a widget is on screen, roughly: at the start, all along, at the end */
export type WidgetTimingKind = "start" | "always" | "end";

/** When a widget comes in and goes, to the tenth of a second */
export interface WidgetShow {
  /** Comes in this many seconds after the clip starts, or before it ends */
  in: number;
  inFrom: "start" | "end";
  /** Goes this many seconds before the clip ends, or after it came in; null: stays to the very end */
  out: number | null;
  outFrom: "end" | "in";
}

export const SHOW_PRESETS: Record<WidgetTimingKind, WidgetShow> = {
  start: { in: 0.3, inFrom: "start", out: 3.3, outFrom: "in" },
  always: { in: 1, inFrom: "start", out: 1, outFrom: "end" },
  end: { in: 3.5, inFrom: "end", out: null, outFrom: "end" },
};

export type EnterId = "pop" | "bounce" | "elastic" | "drop" | "rise" | "slideLeft" | "slideRight" | "zoom" | "fade" | "none";
export type ExitId = "fade" | "shrink" | "sink" | "slideLeft" | "slideRight" | "none";

interface Motion {
  type: AnimationType;
  easing: EasingPreset;
  duration: number;
}

/** Ways a widget comes in */
export const ENTERS: Record<EnterId, Motion | null> = {
  pop: { type: "scaleIn", easing: "back", duration: 0.5 },
  bounce: { type: "scaleIn", easing: "bounce", duration: 0.8 },
  elastic: { type: "scaleIn", easing: "elasticOut", duration: 1.1 },
  drop: { type: "slideInTop", easing: "bounce", duration: 0.85 },
  rise: { type: "slideInBottom", easing: "back", duration: 0.55 },
  slideLeft: { type: "slideInLeft", easing: "back", duration: 0.55 },
  slideRight: { type: "slideInRight", easing: "back", duration: 0.55 },
  zoom: { type: "scaleIn", easing: "easeOut.power3", duration: 0.45 },
  fade: { type: "fadeIn", easing: "easeOut", duration: 0.45 },
  none: null,
};

/** Ways a widget goes ("none": it just cuts) */
export const EXITS: Record<ExitId, Motion> = {
  fade: { type: "fadeOut", easing: "easeIn", duration: 0.35 },
  shrink: { type: "scaleOut", easing: "easeIn.power3", duration: 0.35 },
  sink: { type: "slideOutBottom", easing: "easeIn.power3", duration: 0.4 },
  slideLeft: { type: "slideOutLeft", easing: "easeIn.power3", duration: 0.4 },
  slideRight: { type: "slideOutRight", easing: "easeIn.power3", duration: 0.4 },
  none: { type: "fadeOut", easing: "linear", duration: 0.01 },
};

/** The kit's entrances, as editor choices */
const KIT_ENTER: Record<string, EnterId> = {
  bounceIn: "pop",
  scaleIn: "zoom",
  fadeIn: "fade",
  slideInBottom: "rise",
  slideInLeft: "slideLeft",
  slideInRight: "slideRight",
};

export interface SpecWidget {
  id: string;
  kind: WidgetKind;
  box: Box;
  /** Rough timing (kept in step with `show`) */
  timing: WidgetTimingKind;
  /** Precise timing (older templates: the `timing` preset) */
  show?: WidgetShow;
  enter?: EnterId;
  exit?: ExitId;
  /** Texts the streamer filled in (sticker label, social handles...) */
  fields: Record<string, string>;
}

/** How a widget is timed when added: its kit timing, the whole clip for the progress bar, to the end for the corner logo */
export function defaultShow(kind: WidgetKind, timing: WidgetTimingKind): WidgetShow {
  if (kind === "progress-bar") return { in: 0, inFrom: "start", out: null, outFrom: "end" };
  if (kind === "corner-logo") return { in: 0.5, inFrom: "start", out: null, outFrom: "end" };
  return SHOW_PRESETS[timing];
}

export const showOf = (w: SpecWidget): WidgetShow => w.show ?? defaultShow(w.kind, w.timing);
export const enterOf = (w: SpecWidget): EnterId =>
  w.enter ?? (w.kind === "channel-pill" ? "rise" : (KIT_ENTER[kitWidget(w.kind)?.enter ?? ""] ?? (kitWidget(w.kind)?.enter === null ? "none" : "fade")));
export const exitOf = (w: SpecWidget): ExitId => w.exit ?? "fade";

/** The rough timing a precise one falls under */
export function timingOf(show: WidgetShow): WidgetTimingKind {
  if (show.inFrom === "end") return "end";
  return show.out !== null && show.outFrom === "in" ? "start" : "always";
}

/** When a widget is on screen in a clip: comes in at `appearAt`, starts leaving at `leaveAt` (null: stays) */
export function widgetWindow(w: SpecWidget, startAt: number, endAt: number): { appearAt: number; leaveAt: number | null } {
  const s = showOf(w);
  const appearAt = Math.min(Math.max(startAt, s.inFrom === "end" ? endAt - s.in : startAt + s.in), Math.max(startAt, endAt - 0.5));
  if (s.out === null) return { appearAt, leaveAt: null };
  const leave = s.outFrom === "end" ? endAt - s.out : appearAt + s.out;
  return { appearAt, leaveAt: Math.min(endAt, Math.max(appearAt + 0.5, leave)) };
}

export interface TemplateSpec {
  version: 2;
  id: string;
  name: string;
  /** The layout it started from */
  base: TemplateId;
  background: { kind: "blur" | "dark" | "brand" | "color"; color: ColorRef; /** Darkening over the blurred clip, 0-0.8 */ dim: number };
  game: {
    box: Box;
    frame: FrameStyle;
    /** The whole stream picture, webcam included (else the game next to the webcam) */
    whole?: boolean;
  };
  cam: { visible: boolean; box: Box; frame: FrameStyle };
  /** The Twitch chat, message bubbles (older templates: none) */
  chat?: ChatSpec;
  subtitles: {
    box: Box;
    font: FontId;
    size: number;
    color: ColorRef;
    /** Color of the word being spoken, "none" = all the same */
    highlight: ColorRef | "none";
    uppercase: boolean;
    /** Black outline around the letters */
    stroke: boolean;
    /** Small text on a dark box */
    boxed: boolean;
    /** One color per speaker */
    speakers: boolean;
    /** The spoken word pops a little bigger (older templates: off) */
    pop?: boolean;
    /** Words on screen at a time (older templates: 4) */
    words?: number;
  };
  hook: {
    visible: boolean;
    box: Box;
    /** White letters with a black outline, dark text on a white box, or white text on the channel color */
    style: HookStyle;
    font: FontId;
    size: number;
    /** On screen from the first frame (the cover) until: seconds, half the clip, or null = the whole clip */
    until?: number | "half" | null;
  };
  widgets: SpecWidget[];
  /** Stacking, bottom to top: "game", "cam", "chat", "subtitles", "hook", "widget:<id>" (the background stays under everything) */
  order?: string[];
}

export interface ChatSpec {
  visible: boolean;
  box: Box;
  /** Text size, frame pixels */
  size: number;
  /** Messages on screen at once */
  max: number;
}

/** Where the chat goes when a template didn't have one yet */
export const DEFAULT_CHAT: ChatSpec = { visible: false, box: { x: 60, y: 1150, w: 720, h: 270 }, size: 38, max: 3 };

export const chatOf = (spec: TemplateSpec): ChatSpec => spec.chat ?? { ...DEFAULT_CHAT, box: { ...DEFAULT_CHAT.box } };

/** Seconds a chat message stays */
const CHAT_SECONDS = 5;

const BASE_ORDER = ["game", "cam", "chat", "subtitles", "hook"];

/** Every element of the template once, bottom to top (new widgets land on top) */
export function orderOf(spec: TemplateSpec): string[] {
  const keys = [...BASE_ORDER, ...spec.widgets.map((w) => `widget:${w.id}`)];
  const kept = (spec.order ?? []).filter((k, i, all) => keys.includes(k) && all.indexOf(k) === i);
  return [...kept, ...keys.filter((k) => !kept.includes(k))];
}

/** Moves an element up or down the stack ("front" / "back": all the way) */
export function restack(spec: TemplateSpec, key: string, to: "up" | "down" | "front" | "back" | number): string[] {
  const order = orderOf(spec).filter((k) => k !== key);
  const at = orderOf(spec).indexOf(key);
  const index =
    to === "front" ? order.length : to === "back" ? 0 : to === "up" ? Math.min(order.length, at + 1) : to === "down" ? Math.max(0, at - 1) : Math.max(0, Math.min(order.length, to));
  order.splice(index, 0, key);
  return order;
}

export type HookStyle = "outline" | "box" | "brand";

export const BRAND_COLOR_REFS = ["white", "accent", "highlight", "dark", "light"] as const;

export function resolveColor(ref: ColorRef, colors: BrandColors): string {
  switch (ref) {
    case "white":
      return "#FFFFFF";
    case "accent":
    case "highlight":
    case "dark":
    case "light":
      return colors[ref];
    default:
      return /^#[0-9a-f]{6}$/i.test(ref) ? ref : "#FFFFFF";
  }
}

const toTransform = (b: Box) => ({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.w), height: Math.round(b.h) });

export function newSpecId(): string {
  return `custom-${randomHex(6)}`;
}

export function newWidgetId(): string {
  return `w-${randomHex(4)}`;
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── To layers ────────────────────────────────────────────── */

/** A video cut out of the clip (game or webcam) with its outline and shadow */
function framedVideo(ctx: TemplateContext, name: string, type: "gameplay" | "facecam", region: Rect, box: Box, frame: FrameStyle): Layer[] {
  const t = toTransform(box);
  const radius = Math.min(frame.radius, Math.min(t.width, t.height) / 2);
  const round = radius >= Math.min(t.width, t.height) / 2 - 0.5 && t.width === t.height;
  const layers: Layer[] = [];
  if (frame.border > 0 || frame.shadow) {
    const b = frame.border;
    layers.push(
      shape(
        `${name} · contour`,
        { x: t.x - b, y: t.y - b, width: t.width + b * 2, height: t.height + b * 2 },
        frame.border > 0 ? resolveColor(frame.borderColor, ctx.colors) : "#000000",
        1,
        radius + b,
        frame.shadow ? "strong" : "none",
        round,
      ),
    );
  }
  layers.push(video(ctx, name, type, region, t, radius));
  return layers;
}

function subtitleLayer(ctx: TemplateContext, s: TemplateSpec["subtitles"]): Layer {
  const layer = base("Sous-titres", "subtitles", toTransform(s.box));
  const color = resolveColor(s.color, ctx.colors);
  layer.subtitle = {
    words: ctx.words,
    fontFamily: fontFamily(s.font),
    fontSize: Math.round(s.size),
    colorMode: "custom",
    customColor: s.speakers ? ctx.colors.accent : color,
    autoColor: color,
    uppercase: s.uppercase,
    showSpeaker: s.speakers && !s.boxed,
    ...(s.highlight !== "none" && !s.speakers ? { activeColor: resolveColor(s.highlight, ctx.colors), restColor: color } : {}),
    ...(s.boxed ? { boxed: true } : {}),
    ...(s.stroke ? {} : { noStroke: true }),
    ...(s.pop ? { pop: true } : {}),
    ...(s.words ? { maxWords: s.words } : {}),
  };
  return layer;
}

function chatLayer(ctx: TemplateContext, c: ChatSpec): Layer {
  const layer = base("Chat", "chat", toTransform(c.box));
  layer.chat = { messages: ctx.chat ?? [], maxVisible: Math.round(c.max), fontSize: Math.round(c.size), fontFamily: fontFamily("geist"), showDuration: CHAT_SECONDS, style: "bubbles" };
  return layer;
}

/** When the hook line goes (it's on screen from the first frame: the clip's cover) */
export function hookLeavesAt(h: TemplateSpec["hook"], startAt: number, endAt: number): number | null {
  if (h.until === undefined || h.until === null) return null;
  const at = h.until === "half" ? startAt + (endAt - startAt) / 2 : startAt + h.until;
  return Math.min(at, endAt);
}

function hookLayers(ctx: TemplateContext, h: TemplateSpec["hook"]): Layer[] {
  const t = toTransform(h.box);
  const layers: Layer[] = [];
  const boxed = h.style === "box" || h.style === "brand";
  if (h.style === "box") layers.push(shape("Fond de l'accroche", t, "#FFFFFF", 1, 30, "soft"));
  if (h.style === "brand") layers.push(shape("Fond de l'accroche", t, ctx.colors.accent, 0.94, 26, "soft"));
  const textLayer = base("Accroche", "text", boxed ? { x: t.x + 30, y: t.y + 10, width: t.width - 60, height: t.height - 20 } : t);
  textLayer.text = {
    content: ctx.hook,
    fontFamily: `"${fontFamily(h.font)}", system-ui, sans-serif`,
    fontSize: Math.round(h.size),
    color: h.style === "box" ? "#0C0C0E" : h.style === "brand" ? inkOn(ctx.colors.accent) : "#FFFFFF",
    fontWeight: "bold",
    textAlign: "center",
    uppercase: h.style === "outline",
    lineHeight: boxed ? 1.18 : 1.08,
    ...(h.style === "outline" ? { stroke: true } : {}),
  };
  layers.push(textLayer);
  // No entrance: it's the cover. Fades out when its time is up
  const leaveAt = hookLeavesAt(h, ctx.startAt, ctx.endAt);
  if (leaveAt !== null) {
    for (const layer of layers) layer.animations = [{ id: uid("anim"), type: "fadeOut", time: Math.max(0, leaveAt), duration: 0.3, easing: "easeIn" }];
  }
  return layers;
}

/** When a widget shows up and how it comes in / goes out */
function widgetAnimations(w: SpecWidget, ctx: TemplateContext): { appearAt: number; animations: LayerAnimation[] } {
  const { appearAt, leaveAt } = widgetWindow(w, ctx.startAt, ctx.endAt);
  const anim = (m: Motion, time: number): LayerAnimation => ({ id: uid("anim"), type: m.type, time: Math.max(0, time), duration: m.duration, easing: m.easing });
  // No entrance: it still pops in at its time, not before
  const enter = ENTERS[enterOf(w)] ?? { type: "fadeIn" as const, easing: "linear" as const, duration: 0.01 };
  const animations = [anim(enter, appearAt)];
  if (leaveAt !== null) animations.push(anim(EXITS[exitOf(w)], leaveAt));
  return { appearAt, animations };
}

function widgetLayer(ctx: TemplateContext, w: SpecWidget): Layer {
  const layer = base(`Widget ${w.kind}`, "widget", toTransform(w.box));
  layer.id = `tpl-widget-${w.id}`;
  const { appearAt, animations } = widgetAnimations(w, ctx);
  const brandProps = {
    login: ctx.login ?? "",
    displayName: ctx.displayName ?? ctx.login ?? "",
    avatarUrl: ctx.avatarUrl ?? "",
    accent: ctx.colors.accent,
    highlight: ctx.colors.highlight,
    dark: ctx.colors.dark,
    light: ctx.colors.light,
    followers: ctx.followers ?? 0,
    game: ctx.game ?? "",
    appearAt,
    startAt: ctx.startAt,
    endAt: ctx.endAt,
  };
  layer.widget =
    w.kind === "channel-pill"
      ? { widgetId: "channel-pill", props: { login: ctx.login ?? "", avatarUrl: ctx.avatarUrl ?? "", darkColor: ctx.colors.dark, lightColor: ctx.colors.light, ...w.fields } }
      : { widgetId: w.kind, props: { ...brandProps, ...w.fields } };
  layer.animations = animations;
  return layer;
}

/** Layers of a template made in the simple editor, for one clip */
export function buildFromSpec(spec: TemplateSpec, ctx: TemplateContext): Layer[] {
  const layers: Layer[] = [];
  const full = { x: 0, y: 0, width: W, height: H };

  const bg = spec.background;
  if (bg.kind === "blur") {
    const [blurred, darken] = blurredBackground(ctx);
    darken.shape!.backgroundAlpha = Math.min(0.8, Math.max(0, bg.dim));
    layers.push(blurred, darken);
  } else {
    const fill = bg.kind === "color" ? resolveColor(bg.color, ctx.colors) : ctx.colors.dark;
    const solid = shape("Fond", full, fill, 1, 0);
    solid.locked = true;
    layers.push(solid);
    if (bg.kind === "brand") {
      const tint = shape("Teinte", full, ctx.colors.accent, 0.55, 0);
      tint.locked = true;
      layers.push(tint);
    }
  }

  for (const key of orderOf(spec)) {
    if (key === "game") {
      const region = spec.game.whole ? { x: 0, y: 0, w: ctx.frameW, h: ctx.frameH } : gameRegion(ctx);
      layers.push(...framedVideo(ctx, "Jeu", "gameplay", region, spec.game.box, spec.game.frame));
    }
    // A clip where nobody is in the webcam: no webcam, the rest stays put
    else if (key === "cam") {
      if (spec.cam.visible && ctx.facecam) layers.push(...framedVideo(ctx, "Webcam", "facecam", ctx.facecam, spec.cam.box, spec.cam.frame));
    } else if (key === "chat") {
      if (chatOf(spec).visible) layers.push(chatLayer(ctx, chatOf(spec)));
    } else if (key === "subtitles") layers.push(subtitleLayer(ctx, spec.subtitles));
    else if (key === "hook") {
      if (spec.hook.visible && ctx.hook.trim()) layers.push(...hookLayers(ctx, spec.hook));
    } else {
      const w = spec.widgets.find((x) => `widget:${x.id}` === key);
      if (w) layers.push(widgetLayer(ctx, w));
    }
  }
  return stableIds(layers);
}

/* ── What TikTok, Shorts and Reels cover ──────────────────── */

export type ZoneId = "top" | "bottom" | "right";

/**
 * Parts of the 1080x1920 frame the apps cover with their own interface: tabs
 * at the top, description / username / sound at the bottom, like-comment-share
 * buttons on the right. Text and brand elements should stay out of them.
 */
export const SAFE_TOP = 200;
export const SAFE_BOTTOM = 1440;

export const COVERED_ZONES: { id: ZoneId; box: Box }[] = [
  { id: "top", box: { x: 0, y: 0, w: 1080, h: SAFE_TOP } },
  { id: "bottom", box: { x: 0, y: SAFE_BOTTOM, w: 1080, h: 1920 - SAFE_BOTTOM } },
  { id: "right", box: { x: 930, y: 760, w: 150, h: SAFE_BOTTOM - 760 } },
];

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Zones that hide a real part of the box (more than a sliver) */
export function coveredBy(box: Box): ZoneId[] {
  const area = Math.max(1, box.w * box.h);
  return COVERED_ZONES.filter((z) => overlap(box, z.box) / area > 0.08).map((z) => z.id);
}

/** Centered and clear of the buttons on the right */
const SAFE_COLUMN = { x: 150, w: 780 };

/**
 * Where a widget (or the hook line) added to the template lands: its usual
 * spot when free, else the nearest free height, if need be narrowed to the
 * safe column, else where it hides the least. Free = clear of the webcam,
 * subtitles, hook and the widgets on screen at the same time, and of what the
 * apps cover.
 */
export function placeWidget(spec: TemplateSpec, box: Box, timing: WidgetTimingKind): Box {
  const taken = [
    spec.subtitles.box,
    ...(spec.cam.visible ? [spec.cam.box] : []),
    ...(spec.hook.visible ? [spec.hook.box] : []),
    ...(chatOf(spec).visible ? [chatOf(spec).box] : []),
    ...spec.widgets.filter((w) => w.timing === timing || w.timing === "always" || timing === "always").map((w) => w.box),
  ];
  const free = (b: Box) => coveredBy(b).length === 0 && taken.every((o) => overlap(b, o) === 0);
  const nearest = (b: Box): Box | null => {
    if (free(b)) return b;
    for (let d = 10; d < H; d += 10) {
      for (const y of [b.y - d, b.y + d]) {
        if (y < SAFE_TOP || y + b.h > SAFE_BOTTOM) continue;
        if (free({ ...b, y })) return { ...b, y };
      }
    }
    return null;
  };
  const found = nearest(box) ?? (box.w > SAFE_COLUMN.w ? nearest({ ...box, ...SAFE_COLUMN }) : null);
  if (found) return found;
  // A crowded frame: the visible height where it hides the least of the rest
  let best = box;
  let bestCost = Infinity;
  for (let y = SAFE_TOP; y + box.h <= SAFE_BOTTOM; y += 10) {
    const b = { ...box, y };
    const cost = taken.reduce((sum, o) => sum + overlap(b, o), 0) + (coveredBy(b).length ? box.w * box.h : 0) + Math.abs(y - box.y);
    if (cost < bestCost) [best, bestCost] = [b, cost];
  }
  return best;
}

/* ── Moving and resizing on the frame ─────────────────────── */

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** A line the box snapped to, to draw while dragging */
export interface Guide {
  axis: "x" | "y";
  at: number;
}

const SNAP = 14;
const MIN_SIZE = 40;
/** Elements can be pushed past the frame's edges, this much stays in it */
const KEEP_IN = 60;
const MAX_W = 3 * W;
const MAX_H = 3 * H;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Lines boxes stick to: frame edges, margins, center, and the other elements' edges and centers */
function snapLines(others: Box[]): { x: number[]; y: number[] } {
  // Frame edges, margins, center, and the edges of the zones the apps cover
  const x = [0, 40, W / 2, W - 40, W, 930];
  const y = [0, 40, H / 2, H - 40, H, SAFE_TOP, SAFE_BOTTOM];
  for (const b of others) {
    x.push(b.x, b.x + b.w / 2, b.x + b.w);
    y.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { x, y };
}

function nearest(values: number[], lines: number[]): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const line of lines) {
      const delta = line - v;
      if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: line };
    }
  }
  return best;
}

/**
 * Move or resize `start` by a pointer delta (frame pixels), sticking to the
 * frame and to the other elements. `keepRatio` keeps the shape (round webcam,
 * logos). The box may run past the frame's edges, never all the way out.
 */
export function dragBox(
  start: Box,
  handle: Handle,
  dx: number,
  dy: number,
  others: Box[],
  { keepRatio = false, snap = true }: { keepRatio?: boolean; snap?: boolean } = {},
): { box: Box; guides: Guide[] } {
  const lines = snapLines(others);
  const guides: Guide[] = [];

  if (handle === "move") {
    let x = start.x + dx;
    let y = start.y + dy;
    if (snap) {
      const sx = nearest([x, x + start.w / 2, x + start.w], lines.x);
      if (sx) {
        x += sx.delta;
        guides.push({ axis: "x", at: sx.at });
      }
      const sy = nearest([y, y + start.h / 2, y + start.h], lines.y);
      if (sy) {
        y += sy.delta;
        guides.push({ axis: "y", at: sy.at });
      }
    }
    x = clamp(x, KEEP_IN - start.w, W - KEEP_IN);
    y = clamp(y, KEEP_IN - start.h, H - KEEP_IN);
    return { box: { ...start, x: Math.round(x), y: Math.round(y) }, guides };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;

  if (snap) {
    const edgeX = handle.includes("w") ? "left" : handle.includes("e") ? "right" : null;
    const edgeY = handle.includes("n") ? "top" : handle.includes("s") ? "bottom" : null;
    if (edgeX) {
      const s = nearest([edgeX === "left" ? left : right], lines.x);
      if (s) {
        if (edgeX === "left") left += s.delta;
        else right += s.delta;
        guides.push({ axis: "x", at: s.at });
      }
    }
    if (edgeY) {
      const s = nearest([edgeY === "top" ? top : bottom], lines.y);
      if (s) {
        if (edgeY === "top") top += s.delta;
        else bottom += s.delta;
        guides.push({ axis: "y", at: s.at });
      }
    }
  }

  // Only the dragged edges move: keep a minimum size, a maximum size and a bit in the frame
  if (handle.includes("w")) left = clamp(left, right - MAX_W, Math.min(right - MIN_SIZE, W - KEEP_IN));
  if (handle.includes("e")) right = clamp(right, Math.max(left + MIN_SIZE, KEEP_IN), left + MAX_W);
  if (handle.includes("n")) top = clamp(top, bottom - MAX_H, Math.min(bottom - MIN_SIZE, H - KEEP_IN));
  if (handle.includes("s")) bottom = clamp(bottom, Math.max(top + MIN_SIZE, KEEP_IN), top + MAX_H);
  let box = { x: left, y: top, w: right - left, h: bottom - top };

  if (keepRatio) {
    const ratio = start.w / start.h;
    // The dragged side leads; corners follow the larger change
    const byWidth = handle === "e" || handle === "w" || (handle.length === 2 && Math.abs(box.w - start.w) >= Math.abs(box.h - start.h) * ratio);
    let w = byWidth ? box.w : box.h * ratio;
    let h = w / ratio;
    const fit = Math.min(1, MAX_W / w, MAX_H / h);
    const grow = Math.max(1, MIN_SIZE / w, MIN_SIZE / h);
    w *= fit * grow;
    h *= fit * grow;
    // An edge handle grows the other way around the middle: the bottom one widens on both sides
    box = {
      x: handle.includes("w") ? right - w : handle === "n" || handle === "s" ? start.x + (start.w - w) / 2 : left,
      y: handle.includes("n") ? bottom - h : handle === "e" || handle === "w" ? start.y + (start.h - h) / 2 : top,
      w,
      h,
    };
  }

  return { box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) }, guides };
}

/** The boxes of all elements, to snap to while dragging another one */
export function elementBoxes(spec: TemplateSpec): Record<string, Box> {
  const boxes: Record<string, Box> = { game: spec.game.box, subtitles: spec.subtitles.box };
  if (spec.cam.visible) boxes.cam = spec.cam.box;
  if (spec.hook.visible) boxes.hook = spec.hook.box;
  if (chatOf(spec).visible) boxes.chat = chatOf(spec).box;
  for (const w of spec.widgets) boxes[`widget:${w.id}`] = w.box;
  return boxes;
}
