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
import { Redis } from 'ioredis'

export interface JobStatusUpdate {
  job_id: string
  status: string
  progress?: number
  error?: string | null
  hot_points?: any[]
  clips?: any[]
  step?: string
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

    job.status = update.status
    if (update.progress !== undefined) job.progress = update.progress
    if (update.error !== undefined) job.error = update.error ?? null
    if (update.hot_points !== undefined) job.hotPoints = update.hot_points
    if (update.clips !== undefined) job.clips = update.clips
    await job.save()
  }
}

export default new JobStatusBus()
