import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class CreatorsController {
  // GET /api/creators
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()

    const creators = await db
      .from('creators')
      .where('creators.user_id', user.id)
      .leftJoin('jobs', (join) => {
        join.on('jobs.creator_id', 'creators.id').andOnVal('jobs.status', '=', 'DONE')
      })
      .select(
        'creators.id',
        'creators.twitch_id',
        'creators.login',
        'creators.display_name',
        'creators.thumbnail',
        db.raw('COUNT(jobs.id) as vod_count'),
        db.raw('ROUND(AVG(jobs.view_count)) as avg_views'),
        db.raw('SUM(jobs.view_count) as total_views'),
        db.raw('MAX(jobs.stream_date) as last_stream_date'),
        db.raw("GROUP_CONCAT(DISTINCT jobs.vod_game) as games")
      )
      .groupBy('creators.id')
      .orderBy('vod_count', 'desc')

    const data = creators.map((row) => ({
      id: row.id,
      twitch_id: row.twitch_id || null,
      login: row.login,
      display_name: row.display_name,
      thumbnail: row.thumbnail || null,
      vod_count: Number(row.vod_count),
      avg_views: Math.round(Number(row.avg_views) || 0),
      total_views: Number(row.total_views) || 0,
      last_stream_date: row.last_stream_date || null,
      games: row.games ? row.games.split(',').filter(Boolean) : [],
    }))

    return { data }
  }
}
