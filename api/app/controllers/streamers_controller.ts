import type { HttpContext } from '@adonisjs/core/http'
import Streamer from '#models/streamer'

export default class StreamersController {
  /** GET /api/streamers — list streamers owned by the authenticated user */
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const streamers = await Streamer.query()
      .where('user_id', user.id)
      .orderBy('display_name', 'asc')

    return streamers.map((s) => ({
      id: s.id,
      twitch_login: s.twitchLogin,
      display_name: s.displayName,
      avatar_url: s.avatarUrl,
    }))
  }

  /** GET /api/streamers/:id — get a single streamer (must belong to user) */
  async show({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const streamer = await Streamer.query()
      .where('id', params.id)
      .where('user_id', user.id)
      .first()

    if (!streamer) return response.notFound({ error: 'streamer not found' })

    return {
      id: streamer.id,
      twitch_login: streamer.twitchLogin,
      display_name: streamer.displayName,
      avatar_url: streamer.avatarUrl,
    }
  }
}
