/**
 * JobStatusBus — bridges Redis pub/sub to in-process EventEmitter.
 *
 * Python workers publish updates on `cuttie:job_status:<job_id>`.
 * This service subscribes with a wildcard pattern and re-emits events
 * so SSE handlers (and anything else) can listen without needing their
 * own Redis subscriber connection.
 */

import EventEmitter from 'node:events'
import env from '#start/env'
import Job from '#models/job'
import Streamer from '#models/streamer'
import db from '@adonisjs/lucid/services/db'
import { Redis } from 'ioredis'

export interface JobStatusUpdate {
  job_id: string
  status: string
  progress?: string
  error?: string | null
  hot_points?: any[]
  clips?: any[]
  step?: string
  vod_title?: string | null
  vod_duration_seconds?: number | null
  vod_game?: string | null
  streamer?: string | null
  view_count?: number | null
  stream_date?: string | null
  step_timings?: Record<string, { start: number; duration_seconds: number | null }> | null
}

class JobStatusBus extends EventEmitter {
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
        this.emit(jobId, update)
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
    if ((update as any).type === 'clip_ready') {
      const rank: number = (update as any).rank
      const hp: any = (update as any).hot_point
      const hotPoints = job.hotPoints ?? []
      const idx = hotPoints.findIndex((h: any) => h.clip_filename === hp.clip_filename)
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
    if (update.streamer !== undefined) job.streamer = update.streamer ?? null
    if (update.view_count !== undefined) job.viewCount = update.view_count ?? null
    if (update.stream_date !== undefined) job.streamDate = update.stream_date ?? null
    if (update.step_timings !== undefined) job.stepTimings = update.step_timings ?? null

    // Auto-create/link streamer when streamer name arrives and job has no streamer_id yet
    if (update.streamer && !job.streamerId) {
      try {
        const login = update.streamer.toLowerCase().replace(/\s+/g, '')
        let streamer = await Streamer.findBy('twitchLogin', login)
        if (!streamer) {
          const now = new Date().toISOString()
          streamer = await Streamer.create({
            twitchLogin: login,
            displayName: update.streamer,
            createdAt: now as any,
            updatedAt: now as any,
          })
        }
        job.streamerId = streamer.id

        // Link streamer to user if not already linked
        if (job.userId) {
          const existing = await db
            .from('user_streamers')
            .where('user_id', job.userId)
            .where('streamer_id', streamer.id)
            .first()
          if (!existing) {
            await db.table('user_streamers').insert({
              user_id: job.userId,
              streamer_id: streamer.id,
              created_at: new Date().toISOString(),
            })
          }
        }
      } catch (err) {
        console.error('[JobStatusBus] Failed to link streamer:', err)
      }
    }

    await job.save()
  }
}

export default new JobStatusBus()
