import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import Job from '#models/job'
import db from '@adonisjs/lucid/services/db'
import redis from '@adonisjs/redis/services/main'
import jobStatusBus, { type JobStatusUpdate } from '#services/job_status_bus'
import { listObjects, deleteObject } from '#services/s3'
import { createJobValidator } from '#validators/user'

const CLIPS_BASE = path.resolve('../backend/clips')

export default class JobsController {
  // POST /api/analyze
  async store({ request, response, auth }: HttpContext) {
    const { url } = await request.validateUsing(createJobValidator)

    const user = auth.getUserOrFail()

    const job = await Job.create({
      id: randomUUID(),
      url,
      status: 'PENDING',
      userId: user.id,
    })

    // Push to Redis list — Python worker does BRPOP on this
    await redis.lpush('cuttie:jobs_queue', JSON.stringify({ job_id: job.id, url }))

    return response.created({ job_id: job.id })
  }

  // POST /api/jobs/:id/add-clip
  async addClip({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const jobId = params.id

    const job = await Job.query().where('id', jobId).where('user_id', user.id).first()
    if (!job) return response.notFound({ error: 'job not found' })

    const file = request.file('file', {
      extnames: ['mp4', 'mov', 'webm', 'mkv', 'avi'],
      size: '500mb',
    })

    if (!file || !file.isValid) {
      return response.badRequest({ error: file?.errors?.[0]?.message || 'Invalid video file' })
    }

    // Determine next clip number from existing hot_points
    const hotPoints: any[] = job.hotPoints ?? []
    const existingNums = hotPoints
      .map((hp: any) => hp.clip_filename?.match(/clip_(\d+)/)?.[1])
      .filter(Boolean)
      .map(Number)
    const nextNum = (existingNums.length > 0 ? Math.max(...existingNums) : 0) + 1
    const clipFilename = `clip_${String(nextNum).padStart(2, '0')}.mp4`

    const clipDir = path.join(CLIPS_BASE, jobId)
    mkdirSync(clipDir, { recursive: true })

    await file.move(clipDir, { name: clipFilename })

    if (!file.filePath) {
      return response.internalServerError({ error: 'File upload failed' })
    }

    const clipName = file.clientName.replace(/\.[^.]+$/, '')

    // Push to Redis — worker processes the clip and publishes clip_ready via SSE
    await redis.lpush('cuttie:jobs_queue', JSON.stringify({
      job_id: jobId,
      type: 'add_clip',
      clip_filename: clipFilename,
      clip_name: clipName,
      rank: nextNum,
    }))

    return response.created({ clip_filename: clipFilename, clip_name: clipName })
  }

  // GET /api/jobs
  async index({ auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Math.max(1, Number(request.input('page', 1)))
    const perPage = Math.min(100, Math.max(1, Number(request.input('per_page', 20))))
    const search = (request.input('search') as string || '').trim()
    const status = (request.input('status') as string || '').trim()
    const game = (request.input('game') as string || '').trim()
    const streamer = (request.input('streamer') as string || '').trim()
    const creatorId = request.input('creator_id') ? Number(request.input('creator_id')) : null

    const query = Job.query().where('user_id', user.id)

    if (creatorId) {
      query.where('creator_id', creatorId)
    }

    if (search) {
      const q = `%${search}%`
      query.where((builder) => {
        builder
          .whereLike('vod_title', q)
          .orWhereLike('streamer', q)
          .orWhereLike('vod_game', q)
      })
    }

    if (game) {
      query.where('vod_game', game)
    }

    if (streamer) {
      query.where('streamer', streamer)
    }

    if (status === 'done') {
      query.where('status', 'DONE')
    } else if (status === 'error') {
      query.where('status', 'ERROR')
    } else if (status === 'in_progress') {
      query.whereNotIn('status', ['DONE', 'ERROR'])
    }

    query.orderBy('created_at', 'desc')
    const paginated = await query.paginate(page, perPage)
    const rows = paginated.all()

    // Enrich with chat_message_count
    const data = rows.map((job) => {
      const serialized = job.serialize()
      let chatMessageCount: number | null = null
      try {
        const chatPath = path.join(CLIPS_BASE, job.id, 'chat.json')
        if (existsSync(chatPath)) {
          const chat = JSON.parse(readFileSync(chatPath, 'utf-8'))
          chatMessageCount = Array.isArray(chat) ? chat.length : null
        }
      } catch {}

      return {
        id: serialized.id,
        url: serialized.url,
        status: serialized.status,
        vodTitle: serialized.vodTitle,
        vodGame: serialized.vodGame,
        vodDurationSeconds: serialized.vodDurationSeconds,
        streamer: serialized.streamer,
        streamerThumbnail: serialized.streamerThumbnail,
        viewCount: serialized.viewCount,
        streamDate: serialized.streamDate,
        chatMessageCount,
        error: serialized.error,
        createdAt: serialized.createdAt,
      }
    })

    return {
      data,
      meta: {
        total: paginated.total,
        per_page: paginated.perPage,
        current_page: paginated.currentPage,
        last_page: paginated.lastPage,
      },
    }
  }

  // GET /api/jobs/:id
  async show({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

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
        const clipBase = path.basename(hp.clip_filename, path.extname(hp.clip_filename))
        const metaPath = path.join(CLIPS_BASE, job.id, `${clipBase}_meta.json`)
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
  async retry({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    job.status = 'PENDING'
    job.error = null
    job.progress = null
    await job.save()

    await redis.lpush('cuttie:jobs_queue', JSON.stringify({ job_id: job.id, url: job.url, retry: true }))
    return { job_id: job.id }
  }

  // DELETE /api/jobs/:id
  async destroy({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    // Delete related renders from DB
    await db.from('renders').where('job_id', job.id).delete()

    // Delete S3 objects (clips + renders)
    const prefixes = [`clips/${job.id}/`, `renders/${job.id}/`]
    for (const prefix of prefixes) {
      try {
        const keys = await listObjects(prefix)
        await Promise.all(keys.map((key) => deleteObject(key)))
      } catch {}
    }

    // Delete local files
    const localDir = path.join(CLIPS_BASE, job.id)
    try {
      if (existsSync(localDir)) {
        rmSync(localDir, { recursive: true, force: true })
      }
    } catch {}

    // Delete local data directory
    const dataDir = path.resolve('../backend/data', job.id)
    try {
      if (existsSync(dataDir)) {
        rmSync(dataDir, { recursive: true, force: true })
      }
    } catch {}

    await job.delete()
    return { success: true }
  }

  // PATCH /api/jobs/:id/clips/:clipFilename/name
  async renameClip({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    const body = request.body() as { clip_name?: string }
    const clipName = body.clip_name?.trim()
    if (!clipName) return response.badRequest({ error: 'clip_name is required' })

    const hotPoints = job.hotPoints ?? []
    const hp = hotPoints.find((h: Record<string, unknown>) => h.clip_filename === params.clipFilename)
    if (!hp) return response.notFound({ error: 'clip not found in hot_points' })

    hp.clip_name = clipName
    job.hotPoints = hotPoints
    await job.save()

    return { clip_name: clipName }
  }

  // GET /api/jobs/:id/sse  — Server-Sent Events for real-time status
  async stream({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

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

    // Keep connection open even for terminal jobs — clip imports can still emit clip_ready events.
    // The client decides when to disconnect.

    const onUpdate = (update: JobStatusUpdate) => {
      send(update)
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
