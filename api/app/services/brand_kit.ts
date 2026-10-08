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
