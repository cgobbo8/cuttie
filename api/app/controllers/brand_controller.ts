import type { HttpContext } from '@adonisjs/core/http'
import path from 'node:path'
import Job from '#models/job'
import { getBrandKit, saveBrandKit, type BrandKit, type FacecamRect } from '#services/brand_kit'
import { getClipDimensions } from '#services/edit_env_resolver'
import { listObjects } from '#services/storage'
import { fetchChannel, fetchStoryboard } from '#services/twitch'
import { detectFacecam, detectPalette } from '#services/worker_client'

const HEX = /^#[0-9a-fA-F]{6}$/
const LOGIN = /^[a-zA-Z0-9_]{2,25}$/
const COLOR_KEYS = ['accent', 'highlight', 'dark', 'light'] as const
const WIDGET_TIMINGS = ['start', 'always', 'end']
const SUBTITLE_STYLES = ['bold', 'karaoke', 'minimal']

function validRect(f: any): f is FacecamRect {
  return !!f && [f.x, f.y, f.w, f.h].every((v) => Number.isFinite(v) && v >= 0) && f.w > 0 && f.h > 0
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
      if (f !== null && f !== false && !validRect(f)) return response.badRequest({ error: 'Cadre webcam invalide' })
      patch.facecam =
        f === null || f === false
          ? f
          : {
              x: Math.round(f.x),
              y: Math.round(f.y),
              w: Math.round(f.w),
              h: Math.round(f.h),
              ref_w: Math.round(f.ref_w || 1920),
              ref_h: Math.round(f.ref_h || 1080),
            }
    }
    if (body.widget !== undefined) {
      const { enabled, timing } = body.widget ?? {}
      if ((enabled !== undefined && typeof enabled !== 'boolean') || (timing !== undefined && !WIDGET_TIMINGS.includes(timing))) {
        return response.badRequest({ error: 'Réglage du widget invalide' })
      }
      patch.widget = { ...(enabled !== undefined ? { enabled } : {}), ...(timing ? { timing } : {}) } as BrandKit['widget']
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
    const urls = [channel?.avatar_url, channel?.banner_url].filter((u): u is string => !!u)
    if (urls.length === 0) return response.unprocessableEntity({ error: 'Pas de logo sur cette chaîne' })

    const detected = await detectPalette(urls)
    return saveBrandKit({
      colors: detected.roles,
      palette: detected.palette,
      palette_source: channel?.avatar_url ?? null,
    })
  }

  /**
   * POST /api/brand-kit/detect-facecam — find the webcam on the latest analysis.
   * Not saved: the streamer confirms (or adjusts) it first.
   */
  async detectFacecam({ response }: HttpContext) {
    const latest = await latestClips()
    if (!latest) return response.unprocessableEntity({ error: "Lance d'abord une analyse pour repérer ta webcam" })
    const sample = latest.clips.slice(0, 5)
    const rect = await detectFacecam(latest.jobId, sample)
    const { width, height } = await getClipDimensions(latest.jobId, sample[0])
    return {
      facecam: rect ? { ...rect, ref_w: width, ref_h: height } : null,
      frame: { job_id: latest.jobId, clip_filename: sample[0] },
    }
  }
}
