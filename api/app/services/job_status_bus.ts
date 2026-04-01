/**
 * JobStatusBus — bridges Redis pub/sub from Python workers to AdonisJS Transmit SSE.
 *
 * Python workers publish updates on `cuttie:job_status:<job_id>`.
 * This service subscribes with a wildcard pattern, persists updates to DB,
 * and broadcasts via @adonisjs/transmit so frontend clients get real-time updates.
 */

import env from '#start/env'
import Job from '#models/job'
import Creator from '#models/creator'
import { Redis } from 'ioredis'
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
  type?: 'clip_ready' | 'status_update'
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
}

class JobStatusBus {
  private subscriber: Redis | null = null

  start() {
    if (this.subscriber) return

    this.subscriber = new Redis({
      host: env.get('REDIS_HOST'),
      port: env.get('REDIS_PORT'),
      password: env.get('REDIS_PASSWORD', '') || undefined,
      lazyConnect: true,
    })

    this.subscriber.connect().catch((err) => {
      console.error('[JobStatusBus] Failed to connect to Redis:', err.message)
    })

    this.subscriber.on('error', (err) => {
      console.error('[JobStatusBus] Redis error:', err.message)
    })

    this.subscriber.on('ready', () => {
      this.subscriber!.psubscribe('cuttie:job_status:*', (err) => {
        if (err) console.error('[JobStatusBus] psubscribe error:', err.message)
        else console.log('[JobStatusBus] Subscribed to cuttie:job_status:*')
      })
    })

    this.subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const jobId = channel.split(':').pop()
      if (!jobId) return

      try {
        const update: JobStatusUpdate = JSON.parse(message)
        transmit.broadcast(`jobs/${jobId}`, update)

        // Persist update to DB
        this.persistUpdate(update).catch(() => {})
      } catch (err) {
        console.error('[JobStatusBus] Failed to parse message:', err)
      }
    })
  }

  private async persistUpdate(update: JobStatusUpdate) {
    const job = await Job.find(update.job_id)
    if (!job) return

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
