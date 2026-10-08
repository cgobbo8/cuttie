import type { HttpContext } from '@adonisjs/core/http'
import path from 'node:path'
import Job from '#models/job'
import { getBrandKit, parseCustomTemplates, parseFacecamRect, saveBrandKit, type BrandKit } from '#services/brand_kit'
import { getClipDimensions } from '#services/edit_env_resolver'
import { getPresignedUrl, headObject, listObjects } from '#services/storage'
import { fetchChannel, fetchStoryboard, type TwitchChannel, type TwitchVod } from '#services/twitch'
import {
  detectFacecam,
  detectPalette,
  detectVodFacecam,
  type DetectedPalette,
  type VodFacecam,
} from '#services/worker_client'

const HEX = /^#[0-9a-fA-F]{6}$/
const LOGIN = /^[a-zA-Z0-9_]{2,25}$/
const COLOR_KEYS = ['accent', 'highlight', 'dark', 'light'] as const
const WIDGET_TIMINGS = ['start', 'always', 'end']
const SUBTITLE_STYLES = ['bold', 'karaoke', 'minimal']

/** Webcam frames saved by the worker for the brand kit */
const FACECAM_FRAME = /^brand\/webcam_\d{1,20}\.jpg$/

/** Palettes by logo + banner URL: the onboarding preview and the saved kit share them */
const palettes = new Map<string, Promise<DetectedPalette>>()

function paletteFor(channel: TwitchChannel): Promise<DetectedPalette> | null {
  const urls = [channel.avatar_url, channel.banner_url].filter((u): u is string => !!u)
  if (urls.length === 0) return null
  const key = urls.join(' ')
  let pending = palettes.get(key)
  if (!pending) {
    pending = detectPalette(urls)
    pending.catch(() => palettes.delete(key))
    palettes.set(key, pending)
  }
  return pending
}

/** Webcam detections by VOD, shared by the onboarding prefetch and the step that shows it */
const VOD_FACECAM_MS = 30 * 60_000
const vodFacecams = new Map<string, { at: number; pending: Promise<VodFacecam> }>()

function vodFacecamFor(vod: TwitchVod): Promise<VodFacecam> {
  const hit = vodFacecams.get(vod.id)
  if (hit && Date.now() - hit.at < VOD_FACECAM_MS) return hit.pending
  const pending = detectVodFacecam(vod.id, vod.duration_seconds)
  pending.catch(() => vodFacecams.delete(vod.id))
  vodFacecams.set(vod.id, { at: Date.now(), pending })
  return pending
}

/** Lives worth reading frames from: finished, long enough */
function readableVods(channel: TwitchChannel | null): TwitchVod[] {
  return (channel?.vods ?? []).filter((v) => v.thumbnail_url && v.duration_seconds >= 600)
}

/** Clips of the most recent finished analysis, for webcam detection and previews */
async function latestClips(): Promise<{ jobId: string; clips: string[] } | null> {
  const jobs = await Job.query().where('status', 'DONE').orderBy('created_at', 'desc').limit(5)
  for (const job of jobs) {
    const clips = (await listObjects(`clips/${job.id}/`))
      .map((key) => path.basename(key))
      .filter((name) => name.endsWith('.mp4') && !name.startsWith('render_'))
      .sort()
    if (clips.length > 0) return { jobId: job.id, clips }
  }
  return null
}

export default class BrandController {
  /** GET /api/brand-kit */
  async show({}: HttpContext) {
    return getBrandKit()
  }

  /** PUT /api/brand-kit — partial update */
  async update({ request, response }: HttpContext) {
    const body = request.body() as Record<string, any>
    const patch: Partial<BrandKit> = {}

    if (body.twitch_login !== undefined) {
      const login = String(body.twitch_login ?? '').trim().replace(/^@/, '')
      if (login && !LOGIN.test(login)) return response.badRequest({ error: 'Pseudo Twitch invalide' })
      patch.twitch_login = login ? login.toLowerCase() : null
      // A new channel means a new logo: detect its colors again
      patch.palette = []
      patch.palette_source = null
    }
    if (body.colors !== undefined) {
      const colors: Partial<BrandKit['colors']> = {}
      for (const key of COLOR_KEYS) {
        const value = body.colors?.[key]
        if (value === undefined) continue
        if (typeof value !== 'string' || !HEX.test(value)) {
          return response.badRequest({ error: 'Couleur invalide (format #RRGGBB)' })
        }
        colors[key] = value.toUpperCase()
      }
      patch.colors = colors as BrandKit['colors']
    }
    if (body.facecam !== undefined) {
      const f = body.facecam
      if (f === null || f === false) {
        patch.facecam = f
        patch.facecam_frame = null
      } else {
        const rect = parseFacecamRect(f)
        if (!rect) return response.badRequest({ error: 'Cadre webcam invalide' })
        patch.facecam = rect
        // The live frame it was confirmed on, for previews before any analysis
        const frame = body.facecam_frame
        patch.facecam_frame = typeof frame === 'string' && FACECAM_FRAME.test(frame) ? frame : null
      }
    }
    if (body.widget !== undefined) {
      const { enabled, timing } = body.widget ?? {}
      if ((enabled !== undefined && typeof enabled !== 'boolean') || (timing !== undefined && !WIDGET_TIMINGS.includes(timing))) {
        return response.badRequest({ error: 'Réglage du widget invalide' })
      }
      patch.widget = { ...(enabled !== undefined ? { enabled } : {}), ...(timing ? { timing } : {}) } as BrandKit['widget']
    }
    if (body.templates !== undefined) {
      const templates = parseCustomTemplates(body.templates)
      if (!templates) return response.badRequest({ error: 'Modèles invalides' })
      patch.templates = templates
    }
    if (body.subtitles !== undefined) {
      const { style } = body.subtitles ?? {}
      if (!SUBTITLE_STYLES.includes(style)) return response.badRequest({ error: 'Style de sous-titres invalide' })
      patch.subtitles = { style }
    }

    return saveBrandKit(patch)
  }

  /** GET /api/twitch/channel — the brand kit's channel with its recent VODs, linked to existing analyses */
  async channel({ response }: HttpContext) {
    const kit = await getBrandKit()
    if (!kit.twitch_login) return { channel: null }

    let channel
    try {
      channel = await fetchChannel(kit.twitch_login)
    } catch (err: any) {
      return response.status(502).json({ error: `Twitch ne répond pas (${err.message})` })
    }
    if (!channel) return { channel: null }

    const jobs = await Job.query()
      .select('id', 'url', 'status', 'progress', 'hot_points', 'created_at')
      .orderBy('created_at', 'desc')
    const vods = channel.vods.map((vod) => {
      const job = jobs.find((j) => j.url?.includes(`/videos/${vod.id}`))
      return {
        ...vod,
        job: job
          ? {
              id: job.id,
              status: job.status,
              progress: job.progress,
              clip_count: (job.hotPoints ?? []).filter((h: any) => h.clip_filename).length,
            }
          : null,
      }
    })
    return { channel: { ...channel, vods } }
  }

  /** GET /api/twitch/vods/:id/storyboard — seek preview sprite sheets of a VOD */
  async storyboard({ params, response }: HttpContext) {
    if (!/^\d{1,20}$/.test(params.id)) return response.badRequest({ error: 'VOD invalide' })
    try {
      return { storyboard: await fetchStoryboard(params.id) }
    } catch (err: any) {
      return response.status(502).json({ error: `Twitch ne répond pas (${err.message})` })
    }
  }

  /** POST /api/brand-kit/detect-colors — brand colors from the channel's logo and banner */
  async detectColors({ response }: HttpContext) {
    const kit = await getBrandKit()
    if (!kit.twitch_login) return response.badRequest({ error: 'Aucune chaîne Twitch configurée' })
    const channel = await fetchChannel(kit.twitch_login).catch(() => null)
    const pending = channel ? paletteFor(channel) : null
    if (!pending) return response.unprocessableEntity({ error: 'Pas de logo sur cette chaîne' })

    const detected = await pending
    return saveBrandKit({
      colors: detected.roles,
      palette: detected.palette,
      palette_source: channel?.avatar_url ?? null,
    })
  }

  /** GET /api/twitch/lookup?login= — a channel's public info, before saving it (first launch) */
  async lookup({ request, response }: HttpContext) {
    const login = String(request.input('login', '')).trim().replace(/^@/, '').toLowerCase()
    if (!LOGIN.test(login)) return response.badRequest({ error: 'Pseudo Twitch invalide' })
    try {
      return { channel: await fetchChannel(login) }
    } catch (err: any) {
      return response.status(502).json({ error: `Twitch ne répond pas (${err.message})` })
    }
  }

  /** GET /api/twitch/lookup/colors?login= — the colors of a channel's logo, not saved */
  async lookupColors({ request, response }: HttpContext) {
    const login = String(request.input('login', '')).trim().replace(/^@/, '').toLowerCase()
    if (!LOGIN.test(login)) return response.badRequest({ error: 'Pseudo Twitch invalide' })
    const channel = await fetchChannel(login).catch(() => null)
    const pending = channel ? paletteFor(channel) : null
    if (!pending) return response.unprocessableEntity({ error: 'Pas de logo sur cette chaîne' })
    try {
      return await pending
    } catch (err: any) {
      return response.status(502).json({ error: `Couleurs indisponibles (${err.message})` })
    }
  }

  /**
   * POST /api/brand-kit/detect-facecam — find the webcam on the latest live
   * (frames read straight from Twitch), else on the latest analysis.
   * Not saved: the streamer confirms (or adjusts) it first.
   */
  async detectFacecam({ response }: HttpContext) {
    const kit = await getBrandKit()
    const channel = kit.twitch_login ? await fetchChannel(kit.twitch_login).catch(() => null) : null

    let lastError: string | null = null
    for (const vod of readableVods(channel).slice(0, 2)) {
      try {
        const found = await vodFacecamFor(vod)
        return {
          facecam: found.facecam ? { ...found.facecam, ref_w: found.frame_w, ref_h: found.frame_h } : null,
          frame_url: await getPresignedUrl(found.frame_key),
          frame_key: found.frame_key,
          vod: { id: vod.id, title: vod.title },
        }
      } catch (err: any) {
        lastError = err.message
      }
    }

    const latest = await latestClips()
    if (latest) {
      const sample = latest.clips.slice(0, 5)
      const rect = await detectFacecam(latest.jobId, sample)
      const { width, height } = await getClipDimensions(latest.jobId, sample[0])
      return {
        facecam: rect ? { ...rect, ref_w: width, ref_h: height } : null,
        frame_url: `/api/clips/${latest.jobId}/${encodeURIComponent(sample[0])}/thumb?w=1280`,
        frame_key: null,
        vod: null,
      }
    }

    return response.unprocessableEntity({
      error: lastError
        ? "Impossible de lire ton dernier live pour l'instant"
        : "Aucun live à regarder : lance d'abord une analyse",
    })
  }

  /** GET /api/brand-kit/frame — the live frame the webcam was confirmed on */
  async frame({ response }: HttpContext) {
    const kit = await getBrandKit()
    if (!kit.facecam_frame || !(await headObject(kit.facecam_frame))) {
      return response.notFound({ error: 'no frame' })
    }
    return response.redirect(await getPresignedUrl(kit.facecam_frame))
  }
}
