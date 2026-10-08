/**
 * The streamer's brand kit ("DA"): who they are on Twitch, their colors, their
 * clip widget / subtitle style, and where their webcam sits on stream.
 * Stored in settings.json (single local user).
 */

import Job from '#models/job'
import { readSettings, writeSettings } from '#services/user_settings'

export interface FacecamRect {
  x: number
  y: number
  w: number
  h: number
  /** Size of the stream the rectangle was measured on (defaults to 1920x1080) */
  ref_w?: number
  ref_h?: number
}

export interface BrandColors {
  /** Main brand color: app accent, widget ring, speaker labels */
  accent: string
  /** Pop color: the word being spoken in subtitles */
  highlight: string
  /** Dark brand color: widget text */
  dark: string
  /** Light brand color: logo background */
  light: string
}

export type WidgetTiming = 'start' | 'always' | 'end'
export type SubtitleStyle = 'bold' | 'karaoke' | 'minimal'

/** Allowed values of a custom template (mirrors frontend/src/lib/templates.ts) */
export const TEMPLATE_BASES = ['empile', 'signature', 'reaction', 'discussion', 'plein', 'accroche', 'sanscam'] as const
const LOOK_VALUES = {
  camSize: ['s', 'm', 'l'],
  camShape: ['rounded', 'circle'],
  camBorder: ['white', 'accent', 'none'],
  background: ['blur', 'dark', 'brand'],
  subtitlePosition: ['auto', 'top', 'middle', 'bottom'],
  subtitleSize: ['s', 'm', 'l'],
  widgetPosition: ['auto', 'top', 'bottom', 'none'],
  hook: ['on', 'off'],
} as const

export type TemplateLook = { [K in keyof typeof LOOK_VALUES]: (typeof LOOK_VALUES)[K][number] }

/** A template made in the simple template editor: a base layout and its adjustments */
export interface CustomTemplate {
  id: string
  name: string
  base: (typeof TEMPLATE_BASES)[number]
  look: TemplateLook
}

const MAX_TEMPLATES = 30
const MAX_WIDGETS = 16

/** Allowed values of an element template (mirrors frontend/src/lib/templateSpec.ts) */
const FONT_IDS = ['luckiest', 'bangers', 'anton', 'bebas', 'montserrat', 'poppins', 'marker', 'archivo', 'geist']
const WIDGET_KINDS = [
  'channel-pill',
  'logo',
  'channel-name',
  'handle',
  'live-badge',
  'follow-button',
  'follow-banner',
  'lower-third',
  'socials',
  'follower-count',
  'clip-sticker',
  'corner-logo',
  'progress-bar',
]
const COLOR_REFS = ['white', 'accent', 'highlight', 'dark', 'light']
const ENTER_IDS = ['pop', 'bounce', 'elastic', 'drop', 'rise', 'slideLeft', 'slideRight', 'zoom', 'fade', 'none']
const EXIT_IDS = ['fade', 'shrink', 'sink', 'slideLeft', 'slideRight', 'none']

/** A template made in the element editor (version 2) */
export interface TemplateSpec {
  version: 2
  id: string
  name: string
  base: (typeof TEMPLATE_BASES)[number]
  [element: string]: unknown
}

type Json = Record<string, any>
class Invalid extends Error {}

function check(condition: unknown): asserts condition {
  if (!condition) throw new Invalid()
}
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** Elements may run past the 1080x1920 frame, up to 3 frames big, never all the way out */
function box(b: unknown) {
  check(isObject(b))
  const [x, y, w, h] = [b.x, b.y, b.w, b.h].map(Number)
  check([x, y, w, h].every(Number.isFinite) && w >= 10 && h >= 10 && w <= 3 * 1080 && h <= 3 * 1920)
  check(x + w >= 20 && y + h >= 20 && x <= 1080 - 20 && y <= 1920 - 20)
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}
function color(c: unknown) {
  check(typeof c === 'string' && (COLOR_REFS.includes(c) || /^#[0-9a-f]{6}$/i.test(c)))
  return c as string
}
function num(v: unknown, min: number, max: number) {
  const n = Number(v)
  check(Number.isFinite(n) && n >= min && n <= max)
  return n
}
function bool(v: unknown) {
  check(typeof v === 'boolean')
  return v as boolean
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]) {
  check(allowed.includes(v as T))
  return v as T
}
function frame(f: unknown) {
  check(isObject(f))
  return { radius: num(f.radius, 0, 2000), border: num(f.border, 0, 60), borderColor: color(f.borderColor), shadow: bool(f.shadow) }
}

function parseSpec(item: Json): TemplateSpec {
  const { background: bg, game, cam, subtitles: subs, hook, widgets } = item
  check(isObject(bg) && isObject(game) && isObject(cam) && isObject(subs) && isObject(hook) && Array.isArray(widgets))
  check(widgets.length <= MAX_WIDGETS)
  return {
    version: 2,
    id: item.id,
    name: item.name.trim(),
    base: item.base,
    background: { kind: oneOf(bg.kind, ['blur', 'dark', 'brand', 'color']), color: color(bg.color), dim: num(bg.dim, 0, 0.8) },
    game: { box: box(game.box), frame: frame(game.frame) },
    cam: { visible: bool(cam.visible), box: box(cam.box), frame: frame(cam.frame) },
    subtitles: {
      box: box(subs.box),
      font: oneOf(subs.font, FONT_IDS),
      size: num(subs.size, 20, 240),
      color: color(subs.color),
      highlight: subs.highlight === 'none' ? 'none' : color(subs.highlight),
      uppercase: bool(subs.uppercase),
      stroke: bool(subs.stroke),
      boxed: bool(subs.boxed),
      speakers: bool(subs.speakers),
      ...(subs.pop !== undefined ? { pop: bool(subs.pop) } : {}),
      ...(subs.words !== undefined ? { words: Math.round(num(subs.words, 1, 8)) } : {}),
    },
    hook: {
      visible: bool(hook.visible),
      box: box(hook.box),
      style: oneOf(hook.style, ['outline', 'box', 'brand']),
      font: oneOf(hook.font, FONT_IDS),
      size: num(hook.size, 20, 240),
      ...(hook.until !== undefined ? { until: hookUntil(hook.until) } : {}),
    },
    widgets: widgets.map((w: unknown) => {
      check(isObject(w) && typeof w.id === 'string' && /^w-[a-z0-9-]{2,24}$/.test(w.id))
      const fields: Record<string, string> = {}
      if (w.fields !== undefined) {
        check(isObject(w.fields) && Object.keys(w.fields).length <= 8)
        for (const [key, value] of Object.entries(w.fields)) {
          check(/^[a-zA-Z]{2,20}$/.test(key) && typeof value === 'string' && value.length <= 60)
          fields[key] = value
        }
      }
      return {
        id: w.id,
        kind: oneOf(w.kind, WIDGET_KINDS),
        box: box(w.box),
        timing: oneOf(w.timing, ['start', 'always', 'end']),
        ...(w.show !== undefined ? { show: show(w.show) } : {}),
        ...(w.enter !== undefined ? { enter: oneOf(w.enter, ENTER_IDS) } : {}),
        ...(w.exit !== undefined ? { exit: oneOf(w.exit, EXIT_IDS) } : {}),
        fields,
      }
    }),
    ...(item.order !== undefined ? { order: order(item.order, widgets) } : {}),
  }
}

/** How long the hook line stays: seconds from the first frame, half the clip, or the whole clip (null) */
function hookUntil(v: unknown) {
  if (v === null || v === 'half') return v
  return num(v, 0.5, 600)
}

/** When a widget comes in and goes (seconds from the start / end of the clip, or after it came in) */
function show(s: unknown) {
  check(isObject(s))
  return {
    in: num(s.in, 0, 600),
    inFrom: oneOf(s.inFrom, ['start', 'end']),
    out: s.out === null ? null : num(s.out, 0, 600),
    outFrom: oneOf(s.outFrom, ['end', 'in']),
  }
}

/** Stacking of the elements: known keys only, each once */
function order(list: unknown, widgets: Json[]) {
  const keys = ['game', 'cam', 'subtitles', 'hook', ...widgets.map((w) => `widget:${w.id}`)]
  check(Array.isArray(list) && list.length <= keys.length)
  check(list.every((k, i) => typeof k === 'string' && keys.includes(k) && list.indexOf(k) === i))
  return list as string[]
}

function parseLook(look: unknown): TemplateLook {
  check(isObject(look))
  const clean: Record<string, string> = {}
  for (const [key, allowed] of Object.entries(LOOK_VALUES)) clean[key] = oneOf(look[key], allowed as readonly string[])
  return clean as TemplateLook
}

/** Custom templates from a request body (element templates, or first-version ones), or null when anything is off */
export function parseCustomTemplates(input: unknown): (CustomTemplate | TemplateSpec)[] | null {
  if (!Array.isArray(input) || input.length > MAX_TEMPLATES) return null
  try {
    return input.map((item) => {
      check(isObject(item))
      check(typeof item.id === 'string' && /^custom-[a-z0-9-]{4,40}$/.test(item.id))
      check(typeof item.name === 'string' && item.name.trim() && item.name.trim().length <= 40)
      check(TEMPLATE_BASES.includes(item.base))
      if (item.version === 2) return parseSpec(item)
      return { id: item.id, name: item.name.trim(), base: item.base, look: parseLook(item.look) }
    })
  } catch (err) {
    if (err instanceof Invalid) return null
    throw err
  }
}

export interface BrandKit {
  twitch_login: string | null
  colors: BrandColors
  /** Swatches detected on the logo and banner, most dominant first */
  palette: string[]
  /** Logo URL the palette was detected on (re-detect when it changes) */
  palette_source: string | null
  /**
   * Where the webcam usually sits, in stream pixels (false = no webcam, null =
   * not confirmed yet). Every analysis checks it again on its own clips.
   */
  facecam: FacecamRect | false | null
  /** Storage key of the live frame the webcam was confirmed on */
  facecam_frame: string | null
  widget: { enabled: boolean; timing: WidgetTiming }
  subtitles: { style: SubtitleStyle }
  /** Templates made in the simple template editor */
  templates: (CustomTemplate | TemplateSpec)[]
  /** Template applied to new projects: a built-in layout or a custom template id */
  default_template: string | null
}

export const DEFAULT_BRAND_KIT: BrandKit = {
  twitch_login: null,
  colors: { accent: '#3DBE8B', highlight: '#FFD21F', dark: '#111317', light: '#F5F5F2' },
  palette: [],
  palette_source: null,
  facecam: null,
  facecam_frame: null,
  widget: { enabled: true, timing: 'start' },
  subtitles: { style: 'bold' },
  templates: [],
  default_template: null,
}

/** Merge stored data over the defaults, migrating the v1 shape ({ primary, secondary }) */
function normalize(stored: Record<string, any>): BrandKit {
  const colors = { ...(stored.colors ?? {}) }
  if (!colors.accent && colors.primary && colors.primary.toLowerCase() !== '#8b7bff') {
    colors.accent = colors.primary
  }
  delete colors.primary
  delete colors.secondary
  return {
    ...DEFAULT_BRAND_KIT,
    ...stored,
    colors: { ...DEFAULT_BRAND_KIT.colors, ...colors },
    palette: Array.isArray(stored.palette) ? stored.palette : [],
    templates: parseCustomTemplates(stored.templates ?? []) ?? [],
    widget: { ...DEFAULT_BRAND_KIT.widget, ...(stored.widget ?? {}) },
    subtitles: { ...DEFAULT_BRAND_KIT.subtitles, ...(stored.subtitles ?? {}) },
  }
}

export async function getBrandKit(): Promise<BrandKit> {
  const kit = normalize(readSettings().brand_kit ?? {})
  if (!kit.twitch_login) {
    // Until the kit is set up, assume the streamer of the latest analysis
    const latest = await Job.query().whereNotNull('streamer').orderBy('created_at', 'desc').first()
    kit.twitch_login = latest?.streamer?.toLowerCase() ?? null
  }
  return kit
}

export function saveBrandKit(patch: Partial<BrandKit>): BrandKit {
  const settings = readSettings()
  const current = normalize(settings.brand_kit ?? {})
  const next: BrandKit = {
    ...current,
    ...patch,
    colors: { ...current.colors, ...(patch.colors ?? {}) },
    widget: { ...current.widget, ...(patch.widget ?? {}) },
    subtitles: { ...current.subtitles, ...(patch.subtitles ?? {}) },
  }
  settings.brand_kit = next
  writeSettings(settings)
  return next
}

/** A webcam rectangle from a request body (rounded), or null when invalid */
export function parseFacecamRect(f: any): FacecamRect | null {
  if (!f || typeof f !== 'object') return null
  const values = [f.x, f.y, f.w, f.h].map(Number)
  if (!values.every((v) => Number.isFinite(v) && v >= 0)) return null
  const [x, y, w, h] = values.map(Math.round)
  const refW = Math.round(Number(f.ref_w) || 1920)
  const refH = Math.round(Number(f.ref_h) || 1080)
  if (w < 8 || h < 8 || refW <= 0 || refH <= 0 || x + w > refW + 2 || y + h > refH + 2) return null
  return { x, y, w, h, ref_w: refW, ref_h: refH }
}

/**
 * Webcam rectangle to use for a clip of the given size: the confirmed brand kit
 * rectangle (scaled to the clip), `false` when the streamer has no webcam, or
 * `null` when nothing is confirmed (callers fall back to per-job detection).
 */
export function brandFacecamFor(kit: BrandKit, clipWidth: number, clipHeight: number) {
  const f = kit.facecam
  if (f === false) return false
  if (!f) return null
  const sx = clipWidth / (f.ref_w || 1920)
  const sy = clipHeight / (f.ref_h || 1080)
  return { x: Math.round(f.x * sx), y: Math.round(f.y * sy), w: Math.round(f.w * sx), h: Math.round(f.h * sy) }
}
