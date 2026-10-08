/**
 * JobStatusBus — receives status updates from the Python worker (POSTed to
 * /api/internal/worker-events), persists them to the DB and broadcasts them via
 * @adonisjs/transmit so frontend clients get real-time updates.
 */

import Job, { type JobTimeline, type TimelineCandidate } from '#models/job'
import Creator from '#models/creator'
import transmit from '@adonisjs/transmit/services/main'

export interface HotPointData {
  clip_filename: string
  rank?: number
  clip_name?: string
  score?: number
  [key: string]: unknown
}

export interface JobStatusUpdate {
  job_id: string
  status: string
  progress?: string
  error?: string | null
  hot_points?: HotPointData[]
  clips?: string[]
  step?: string
  type?: 'clip_ready' | 'status_update' | 'timeline' | 'candidate'
  /** type "timeline": fields to merge into the job's timeline */
  timeline?: JobTimeline
  /** type "candidate": one candidate passage changed */
  candidate?: TimelineCandidate
  rank?: number
  hot_point?: HotPointData
  vod_title?: string | null
  vod_duration_seconds?: number | null
  vod_game?: string | null
  vod_game_id?: string | null
  vod_game_thumbnail?: string | null
  streamer?: string | null
  streamer_thumbnail?: string | null
  view_count?: number | null
  stream_date?: string | null
  step_timings?: Record<string, { start: number; duration_seconds: number | null }> | null
  vod_context?: any | null
}

class JobStatusBus {
  /** Handle one update from the worker: broadcast to SSE clients, then persist. */
  async handle(update: JobStatusUpdate) {
    if (!update.job_id) return
    // JSON payload from the worker — structurally broadcastable
    transmit.broadcast(`jobs/${update.job_id}`, update as unknown as Parameters<typeof transmit.broadcast>[1])
    await this.persistUpdate(update)
  }

  private async persistUpdate(update: JobStatusUpdate) {
    const job = await Job.find(update.job_id)
    if (!job) return

    // Live view of the analysis
    if (update.type === 'timeline' && update.timeline) {
      job.timeline = { ...(job.timeline ?? {}), ...update.timeline }
      await job.save()
      return
    }
    if (update.type === 'candidate' && update.candidate) {
      const c = update.candidate
      const candidates = [...(job.timeline?.candidates ?? [])]
      const idx = candidates.findIndex((x) => Math.abs(x.t - c.t) < 0.05)
      if (idx >= 0) candidates[idx] = { ...candidates[idx], ...c }
      else candidates.push(c)
      job.timeline = { ...(job.timeline ?? {}), candidates }
      await job.save()
      return
    }

    // clip_ready: merge a single enriched hot point into the existing array
    if (update.type === 'clip_ready' && update.hot_point) {
      const hp = update.hot_point
      const hotPoints = job.hotPoints ?? []
      const idx = hotPoints.findIndex((h: Record<string, unknown>) => h.clip_filename === hp.clip_filename)
      if (idx >= 0) {
        hotPoints[idx] = hp
      } else {
        hotPoints.push(hp)
      }
      job.hotPoints = hotPoints
      await job.save()
      return
    }

    if (update.status) job.status = update.status
    if (update.progress !== undefined) job.progress = update.progress
    if (update.error !== undefined) job.error = update.error ?? null
    if (update.hot_points !== undefined) job.hotPoints = update.hot_points
    if (update.clips !== undefined) job.clips = update.clips
    if (update.vod_title !== undefined) job.vodTitle = update.vod_title ?? null
    if (update.vod_duration_seconds !== undefined) job.vodDurationSeconds = update.vod_duration_seconds ?? null
    if (update.vod_game !== undefined) job.vodGame = update.vod_game ?? null
    if (update.vod_game_id !== undefined) job.vodGameId = update.vod_game_id ?? null
    if (update.vod_game_thumbnail !== undefined) job.vodGameThumbnail = update.vod_game_thumbnail ?? null
    if (update.streamer !== undefined) job.streamer = update.streamer ?? null
    if (update.streamer_thumbnail !== undefined) job.streamerThumbnail = update.streamer_thumbnail ?? null
    if (update.view_count !== undefined) job.viewCount = update.view_count ?? null
    if (update.stream_date !== undefined) job.streamDate = update.stream_date ?? null
    if (update.step_timings !== undefined) job.stepTimings = update.step_timings ?? null
    if (update.vod_context !== undefined) job.vodContext = update.vod_context ?? null

    // Upsert creator when streamer info arrives
    if (update.streamer && job.userId) {
      try {
        const login = update.streamer.toLowerCase()
        let creator = await Creator.query()
          .where('login', login)
          .where('user_id', job.userId)
          .first()

        if (creator) {
          if (update.streamer_thumbnail && !creator.thumbnail) {
            creator.thumbnail = update.streamer_thumbnail
            await creator.save()
          }
        } else {
          creator = await Creator.create({
            login,
            displayName: update.streamer,
            thumbnail: update.streamer_thumbnail ?? null,
            userId: job.userId,
          })
        }
        job.creatorId = creator.id
      } catch (err) {
        console.error('[JobStatusBus] Creator upsert failed:', err)
      }
    }

    await job.save()
  }
}

export default new JobStatusBus()
