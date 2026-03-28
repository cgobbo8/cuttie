import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class DashboardController {
  // GET /api/dashboard?creator_id=
  async index({ auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const creatorId = request.input('creator_id') ? Number(request.input('creator_id')) : null

    if (creatorId) {
      return this.creatorDashboard(user.id, creatorId)
    }
    return this.allDashboard(user.id)
  }

  private async allDashboard(userId: number) {
    const [statsRow] = await db
      .from('jobs')
      .where('user_id', userId)
      .select(
        db.raw('COUNT(*) as total_projects'),
        db.raw("SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as completed_projects")
      )

    const [rendersCount] = await db
      .from('renders')
      .where('user_id', userId)
      .select(db.raw('COUNT(*) as total_exports'))

    const [creatorsCount] = await db
      .from('creators')
      .where('user_id', userId)
      .select(db.raw('COUNT(*) as total_creators'))

    const topCreators = await db
      .from('creators')
      .where('creators.user_id', userId)
      .leftJoin('jobs', (join) => {
        join.on('jobs.creator_id', 'creators.id').andOnVal('jobs.status', '=', 'DONE')
      })
      .select(
        'creators.id',
        'creators.display_name',
        'creators.thumbnail',
        'creators.login',
        db.raw('COUNT(jobs.id) as vod_count')
      )
      .groupBy('creators.id')
      .orderBy('vod_count', 'desc')
      .limit(5)

    const latestProjects = await db
      .from('jobs')
      .where('user_id', userId)
      .where('status', 'DONE')
      .select('id', 'vod_title', 'streamer', 'streamer_thumbnail', 'vod_game', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5)

    const latestExports = await db
      .from('renders')
      .join('jobs', 'renders.job_id', 'jobs.id')
      .select('renders.id as render_id', 'renders.clip_name', 'renders.status', 'renders.created_at', 'jobs.vod_title', 'jobs.vod_game')
      .where('renders.user_id', userId)
      .orderBy('renders.created_at', 'desc')
      .limit(5)

    return {
      stats: {
        total_projects: Number(statsRow.total_projects),
        completed_projects: Number(statsRow.completed_projects),
        total_exports: Number(rendersCount.total_exports),
        total_creators: Number(creatorsCount.total_creators),
      },
      top_creators: topCreators.map((c) => ({
        id: c.id,
        display_name: c.display_name,
        thumbnail: c.thumbnail || null,
        login: c.login,
        vod_count: Number(c.vod_count),
      })),
      latest_projects: latestProjects.map((j) => ({
        id: j.id,
        vod_title: j.vod_title,
        streamer: j.streamer,
        streamer_thumbnail: j.streamer_thumbnail || null,
        vod_game: j.vod_game,
        created_at: j.created_at,
      })),
      latest_exports: latestExports.map((r) => ({
        render_id: r.render_id,
        clip_name: r.clip_name,
        status: r.status,
        vod_title: r.vod_title,
        vod_game: r.vod_game,
        created_at: r.created_at,
      })),
    }
  }

  private async creatorDashboard(userId: number, creatorId: number) {
    const creator = await db
      .from('creators')
      .where('id', creatorId)
      .where('user_id', userId)
      .first()

    if (!creator) {
      return { error: 'Creator not found' }
    }

    const [stats] = await db
      .from('jobs')
      .where('user_id', userId)
      .where('creator_id', creatorId)
      .select(
        db.raw('COUNT(*) as total_projects'),
        db.raw("SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as completed_projects"),
        db.raw('ROUND(AVG(view_count)) as avg_views'),
        db.raw('SUM(view_count) as total_views')
      )

    const [rendersCount] = await db
      .from('renders')
      .join('jobs', 'renders.job_id', 'jobs.id')
      .where('renders.user_id', userId)
      .where('jobs.creator_id', creatorId)
      .select(db.raw('COUNT(*) as total_exports'))

    const topGames = await db
      .from('jobs')
      .where('user_id', userId)
      .where('creator_id', creatorId)
      .where('status', 'DONE')
      .whereNotNull('vod_game')
      .where('vod_game', '!=', '')
      .select(
        db.raw('MAX(vod_game) as name'),
        db.raw('MAX(vod_game_thumbnail) as thumbnail'),
        db.raw('COUNT(*) as vod_count'),
        db.raw('ROUND(AVG(view_count)) as avg_views')
      )
      .groupByRaw("COALESCE(NULLIF(vod_game_id, ''), vod_game)")
      .orderBy('vod_count', 'desc')
      .limit(5)

    const latestProjects = await db
      .from('jobs')
      .where('user_id', userId)
      .where('creator_id', creatorId)
      .where('status', 'DONE')
      .select('id', 'vod_title', 'streamer', 'streamer_thumbnail', 'vod_game', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5)

    const latestExports = await db
      .from('renders')
      .join('jobs', 'renders.job_id', 'jobs.id')
      .select('renders.id as render_id', 'renders.clip_name', 'renders.status', 'renders.created_at', 'jobs.vod_title', 'jobs.vod_game')
      .where('renders.user_id', userId)
      .where('jobs.creator_id', creatorId)
      .orderBy('renders.created_at', 'desc')
      .limit(5)

    const gamesCount = await db
      .from('jobs')
      .where('user_id', userId)
      .where('creator_id', creatorId)
      .where('status', 'DONE')
      .whereNotNull('vod_game')
      .where('vod_game', '!=', '')
      .countDistinct('vod_game as total')
      .first()

    return {
      creator: {
        id: creator.id,
        display_name: creator.display_name,
        thumbnail: creator.thumbnail || null,
        login: creator.login,
        twitch_id: creator.twitch_id || null,
      },
      stats: {
        total_projects: Number(stats.total_projects),
        completed_projects: Number(stats.completed_projects),
        total_exports: Number(rendersCount.total_exports),
        total_games: Number(gamesCount?.total || 0),
        avg_views: Math.round(Number(stats.avg_views) || 0),
        total_views: Number(stats.total_views) || 0,
      },
      top_games: topGames.map((g) => ({
        name: g.name,
        thumbnail: g.thumbnail || null,
        vod_count: Number(g.vod_count),
        avg_views: Math.round(Number(g.avg_views) || 0),
      })),
      latest_projects: latestProjects.map((j) => ({
        id: j.id,
        vod_title: j.vod_title,
        streamer: j.streamer,
        streamer_thumbnail: j.streamer_thumbnail || null,
        vod_game: j.vod_game,
        created_at: j.created_at,
      })),
      latest_exports: latestExports.map((r) => ({
        render_id: r.render_id,
        clip_name: r.clip_name,
        status: r.status,
        vod_title: r.vod_title,
        vod_game: r.vod_game,
        created_at: r.created_at,
      })),
    }
  }
}
