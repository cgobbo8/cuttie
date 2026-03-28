import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class GamesController {
  // GET /api/games
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()

    // Group by game_id when available, fall back to game name
    const rows = await db
      .from('jobs')
      .where('user_id', user.id)
      .where('status', 'DONE')
      .whereNotNull('vod_game')
      .where('vod_game', '!=', '')
      .select(
        db.raw("COALESCE(NULLIF(vod_game_id, ''), vod_game) as game_key"),
        db.raw('MAX(vod_game) as vod_game'),
        db.raw("MAX(vod_game_id) as vod_game_id"),
        db.raw("MAX(vod_game_thumbnail) as vod_game_thumbnail"),
        db.raw('COUNT(*) as vod_count'),
        db.raw('COUNT(DISTINCT streamer) as streamer_count'),
        db.raw('ROUND(AVG(view_count)) as avg_views'),
        db.raw('SUM(view_count) as total_views'),
        db.raw('MAX(stream_date) as last_stream_date'),
        db.raw("GROUP_CONCAT(DISTINCT streamer) as streamers")
      )
      .groupByRaw("COALESCE(NULLIF(vod_game_id, ''), vod_game)")
      .orderBy('vod_count', 'desc')

    const games = rows.map((row) => ({
      name: row.vod_game,
      game_id: row.vod_game_id || null,
      thumbnail: row.vod_game_thumbnail || null,
      vod_count: Number(row.vod_count),
      streamer_count: Number(row.streamer_count),
      avg_views: Math.round(Number(row.avg_views) || 0),
      total_views: Number(row.total_views) || 0,
      last_stream_date: row.last_stream_date || null,
      streamers: row.streamers
        ? row.streamers.split(',').filter(Boolean)
        : [],
    }))

    // Distinct streamers with latest thumbnail
    const streamerRows = await db
      .from('jobs')
      .where('user_id', user.id)
      .where('status', 'DONE')
      .whereNotNull('streamer')
      .where('streamer', '!=', '')
      .select(
        'streamer',
        db.raw('MAX(streamer_thumbnail) as streamer_thumbnail'),
        db.raw('COUNT(*) as vod_count')
      )
      .groupBy('streamer')
      .orderBy('vod_count', 'desc')

    const streamers = streamerRows.map((row) => ({
      name: row.streamer,
      thumbnail: row.streamer_thumbnail || null,
      vod_count: Number(row.vod_count),
    }))

    return { data: games, streamers }
  }
}
