import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Job from '#models/job'
import redis from '@adonisjs/redis/services/main'
import jobStatusBus, { type JobStatusUpdate } from '#services/job_status_bus'

const CLIPS_BASE = path.resolve('../backend/clips')

export default class JobsController {
  // POST /api/analyze
  async store({ request, response }: HttpContext) {
    const body = request.body() as { url?: string }
    const url = body.url?.trim()
    if (!url) return response.badRequest({ error: 'url is required' })

    const job = await Job.create({
      id: randomUUID(),
      url,
      status: 'PENDING',
    })

    // Push to Redis list — Python worker does BRPOP on this
    await redis.lpush('cuttie:jobs_queue', JSON.stringify({ job_id: job.id, url }))

    return response.created({ job_id: job.id })
  }

  // GET /api/jobs
  async index() {
    return Job.query().orderBy('created_at', 'desc')
  }

  // GET /api/jobs/:id
  async show({ params, response }: HttpContext) {
    const job = await Job.find(params.id)
    if (!job) return response.notFound({ error: 'job not found' })

    const data = job.serialize()

    // Enrich hotPoints with chatMessageCount per clip
    if (data.hotPoints?.length) {
      const chatPath = path.join(CLIPS_BASE, job.id, 'chat.json')
      let allChat: { timestamp: number }[] = []
      try {
        if (existsSync(chatPath)) {
          allChat = JSON.parse(readFileSync(chatPath, 'utf-8'))
        }
      } catch {}

      for (const hp of data.hotPoints) {
        hp.chat_message_count = 0
        if (!hp.clip_filename || allChat.length === 0) continue
        const clipNum = hp.clip_filename.match(/clip_(\d+)/)?.[1]
        if (!clipNum) continue
        const metaPath = path.join(CLIPS_BASE, job.id, `clip_${clipNum}_meta.json`)
        try {
          if (existsSync(metaPath)) {
            const { vod_start, vod_end } = JSON.parse(readFileSync(metaPath, 'utf-8'))
            hp.chat_message_count = allChat.filter(
              (m: { timestamp: number }) => m.timestamp >= vod_start && m.timestamp <= vod_end
            ).length
          }
        } catch {}
      }
    }

    return data
  }

  // POST /api/jobs/:id/retry
  async retry({ params, response }: HttpContext) {
    const job = await Job.find(params.id)
    if (!job) return response.notFound({ error: 'job not found' })

    job.status = 'PENDING'
    job.error = null
    job.progress = null
    await job.save()

    await redis.lpush('cuttie:jobs_queue', JSON.stringify({ job_id: job.id, url: job.url, retry: true }))
    return { job_id: job.id }
  }

  // PATCH /api/jobs/:id/clips/:clipFilename/name
  async renameClip({ params, request, response }: HttpContext) {
    const job = await Job.find(params.id)
    if (!job) return response.notFound({ error: 'job not found' })

    const body = request.body() as { clip_name?: string }
    const clipName = body.clip_name?.trim()
    if (!clipName) return response.badRequest({ error: 'clip_name is required' })

    const hotPoints = job.hotPoints ?? []
    const hp = hotPoints.find((h: any) => h.clip_filename === params.clipFilename)
    if (!hp) return response.notFound({ error: 'clip not found in hot_points' })

    hp.clip_name = clipName
    job.hotPoints = hotPoints
    await job.save()

    return { clip_name: clipName }
  }

  // GET /api/jobs/:id/sse  — Server-Sent Events for real-time status
  async stream({ params, response }: HttpContext) {
    const job = await Job.find(params.id)
    if (!job) return response.notFound({ error: 'job not found' })

    const res = response.response
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering
    res.flushHeaders()

    const send = (data: object) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`)
      }
    }

    // Send current state immediately
    send(job.serialize())

    // If already terminal, close immediately
    if (job.status === 'DONE' || job.status === 'ERROR') {
      res.end()
      return
    }

    const onUpdate = (update: JobStatusUpdate) => {
      send(update)
      if (update.status === 'DONE' || update.status === 'ERROR') {
        cleanup()
        res.end()
      }
    }

    jobStatusBus.on(params.id, onUpdate)

    // Heartbeat every 25s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      if (res.writableEnded) return cleanup()
      res.write(': ping\n\n')
    }, 25_000)

    const cleanup = () => {
      clearInterval(heartbeat)
      jobStatusBus.off(params.id, onUpdate)
    }

    res.on('close', cleanup)
  }
}
