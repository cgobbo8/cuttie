import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Streamer from '#models/streamer'

export default class StreamersController {
  /** GET /api/streamers — list streamers for the authenticated user */
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const rows = await db
      .from('streamers')
      .join('user_streamers', 'streamers.id', 'user_streamers.streamer_id')
      .where('user_streamers.user_id', user.id)
      .select('streamers.*')
      .orderBy('streamers.display_name', 'asc')

    return rows.map((row) => ({
      id: row.id,
      twitch_login: row.twitch_login,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
    }))
  }

  /** GET /api/streamers/:id — get a single streamer */
  async show({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const pivot = await db
      .from('user_streamers')
      .where('user_id', user.id)
      .where('streamer_id', params.id)
      .first()

    if (!pivot) return response.notFound({ error: 'streamer not found' })

    const streamer = await Streamer.find(params.id)
    if (!streamer) return response.notFound({ error: 'streamer not found' })

    return {
      id: streamer.id,
      twitch_login: streamer.twitchLogin,
      display_name: streamer.displayName,
      avatar_url: streamer.avatarUrl,
    }
  }
}
