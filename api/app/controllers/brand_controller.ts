import type { HttpContext } from '@adonisjs/core/http'
import Job from '#models/job'
import { getBrandKit, saveBrandKit, type BrandKit } from '#services/brand_kit'
import { fetchChannel } from '#services/twitch'

const HEX = /^#[0-9a-fA-F]{6}$/
const LOGIN = /^[a-zA-Z0-9_]{2,25}$/

export default class BrandController {
  /** GET /api/brand-kit */
  async show({}: HttpContext) {
    return getBrandKit()
  }

  /** PUT /api/brand-kit — partial update */
  async update({ request, response }: HttpContext) {
    const body = request.body() as Partial<BrandKit>
    const patch: Partial<BrandKit> = {}

    if (body.twitch_login !== undefined) {
      const login = (body.twitch_login ?? '').trim().replace(/^@/, '')
      if (login && !LOGIN.test(login)) return response.badRequest({ error: 'Pseudo Twitch invalide' })
      patch.twitch_login = login ? login.toLowerCase() : null
    }
    if (body.colors !== undefined) {
      const { primary, secondary } = body.colors ?? ({} as BrandKit['colors'])
      if ((primary && !HEX.test(primary)) || (secondary && !HEX.test(secondary))) {
        return response.badRequest({ error: 'Couleur invalide (format #RRGGBB)' })
      }
      patch.colors = { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) } as BrandKit['colors']
    }
    if (body.facecam !== undefined) {
      const f = body.facecam
      const valid = f === null || f === false || (f && [f.x, f.y, f.w, f.h].every((v) => Number.isFinite(v) && v >= 0))
      if (!valid) return response.badRequest({ error: 'Cadre webcam invalide' })
      patch.facecam = f === null || f === false ? f : { x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) }
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

    const jobs = await Job.query().select('id', 'url', 'status', 'hot_points', 'created_at').orderBy('created_at', 'desc')
    const vods = channel.vods.map((vod) => {
      const job = jobs.find((j) => j.url?.includes(`/videos/${vod.id}`))
      return {
        ...vod,
        job: job
          ? { id: job.id, status: job.status, clip_count: (job.hotPoints ?? []).filter((h: any) => h.clip_filename).length }
          : null,
      }
    })
    return { channel: { ...channel, vods } }
  }
}
