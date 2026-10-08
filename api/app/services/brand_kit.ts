/**
 * The streamer's brand kit ("DA"): who they are on Twitch, their colors, and
 * where their webcam sits on stream. Stored in settings.json (single local user).
 */

import Job from '#models/job'
import { readSettings, writeSettings } from '#services/user_settings'

export interface BrandKit {
  twitch_login: string | null
  colors: { primary: string; secondary: string }
  /** Webcam overlay rectangle in source-video pixels, false = no webcam, null = not set yet */
  facecam: { x: number; y: number; w: number; h: number } | false | null
}

const DEFAULTS: BrandKit = {
  twitch_login: null,
  colors: { primary: '#8b7bff', secondary: '#4fbf73' },
  facecam: null,
}

export async function getBrandKit(): Promise<BrandKit> {
  const stored = (readSettings().brand_kit ?? {}) as Partial<BrandKit>
  const kit: BrandKit = {
    ...DEFAULTS,
    ...stored,
    colors: { ...DEFAULTS.colors, ...(stored.colors ?? {}) },
  }
  if (!kit.twitch_login) {
    // Until the kit is set up, assume the streamer of the latest analysis
    const latest = await Job.query().whereNotNull('streamer').orderBy('created_at', 'desc').first()
    kit.twitch_login = latest?.streamer?.toLowerCase() ?? null
  }
  return kit
}

export function saveBrandKit(patch: Partial<BrandKit>): BrandKit {
  const settings = readSettings()
  const current = (settings.brand_kit ?? {}) as Partial<BrandKit>
  const next = {
    ...current,
    ...patch,
    colors: { ...DEFAULTS.colors, ...(current.colors ?? {}), ...(patch.colors ?? {}) },
  }
  settings.brand_kit = next
  writeSettings(settings)
  return { ...DEFAULTS, ...next } as BrandKit
}
