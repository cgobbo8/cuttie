import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import Job, { type ClipSelection } from '#models/job'
import { parseFacecamRect, saveBrandKit, type FacecamRect } from '#services/brand_kit'
import db from '@adonisjs/lucid/services/db'
import { clipDir } from '#services/data_paths'
import { deleteObject, storagePath } from '#services/storage'
import { cancelJob, enqueueJob, type WorkerJob } from '#services/worker_client'
import { createJobValidator } from '#validators/user'

/** Hand a job to the worker in the background; mark it failed if the worker never answers. */
function dispatch(job: WorkerJob) {
  enqueueJob(job).catch(async (err) => {
    console.error(`[Jobs] Could not queue job ${job.job_id}:`, err.message)
    if (job.type === 'add_clip') return
    await Job.query()
      .where('id', job.job_id)
      .update({ status: 'ERROR', error: err.message, updated_at: new Date().toISOString() })
  })
}

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

    dispatch({ job_id: job.id, url })

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

    const targetDir = clipDir(jobId)
    mkdirSync(targetDir, { recursive: true })

    await file.move(targetDir, { name: clipFilename })

    if (!file.filePath) {
      return response.internalServerError({ error: 'File upload failed' })
    }

    const clipName = file.clientName.replace(/\.[^.]+$/, '')

    // Worker processes the clip and publishes clip_ready via SSE
    dispatch({
      job_id: jobId,
      type: 'add_clip',
      clip_filename: clipFilename,
      clip_name: clipName,
      rank: nextNum,
    })

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
          .orWhereLike('custom_title', q)
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
        const chatPath = path.join(clipDir(job.id), 'chat.json')
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
        customTitle: serialized.customTitle,
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
      const chatPath = path.join(clipDir(job.id), 'chat.json')
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
        const metaPath = path.join(clipDir(job.id), `${clipBase}_meta.json`)
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

  // PATCH /api/jobs/:id
  async update({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    const body = request.body() as { custom_title?: string }
    const customTitle = body.custom_title?.trim()
    if (!customTitle) return response.badRequest({ error: 'custom_title is required' })

    job.customTitle = customTitle
    await job.save()

    return { custom_title: customTitle }
  }

  // PATCH /api/jobs/:id/selection — keep / pass a clip, set its trim
  async updateSelection({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    const body = request.body() as { clip_filename?: string; state?: string | null; trim?: unknown }
    const filename = typeof body.clip_filename === 'string' ? path.basename(body.clip_filename) : ''
    const known = (job.hotPoints ?? []).some((hp: any) => hp.clip_filename === filename)
    if (!filename || !known) return response.badRequest({ error: 'unknown clip' })

    const current: ClipSelection = { ...(job.selection?.[filename] ?? {}) }
    if (body.state !== undefined) {
      if (body.state === null) delete current.state
      else if (body.state === 'kept' || body.state === 'passed') current.state = body.state
      else return response.badRequest({ error: 'state must be kept, passed or null' })
    }
    if (body.trim !== undefined) {
      if (body.trim === null) {
        delete current.trim
      } else {
        const [start, end] = Array.isArray(body.trim) ? body.trim.map(Number) : []
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 1) {
          return response.badRequest({ error: 'trim must be [start, end] in seconds, at least 1 s long' })
        }
        current.trim = [Math.round(start * 10) / 10, Math.round(end * 10) / 10]
      }
    }

    const selection = { ...(job.selection ?? {}) }
    if (Object.keys(current).length > 0) selection[filename] = current
    else delete selection[filename]
    job.selection = selection
    await job.save()
    return { selection }
  }

  /**
   * PUT /api/jobs/:id/facecam — webcam framing for this live only:
   * { facecam: rect | false (no cam on this live) | null (automatic), remember?: true }
   * `remember` also makes it the streamer's usual position for the next lives.
   */
  async updateFacecam({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    const body = request.body() as { facecam?: unknown; remember?: unknown }
    let facecam: FacecamRect | false | null
    if (body.facecam === null || body.facecam === false) {
      facecam = body.facecam
    } else {
      facecam = parseFacecamRect(body.facecam)
      if (!facecam) return response.badRequest({ error: 'Cadre webcam invalide' })
    }

    job.facecam = facecam
    await job.save()
    if (body.remember === true && facecam) saveBrandKit({ facecam, facecam_frame: null })
    return { facecam: job.facecam }
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

    dispatch({ job_id: job.id, url: job.url })
    return { job_id: job.id }
  }

  // DELETE /api/jobs/:id
  async destroy({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    // Stop the analysis if it is still queued or running
    await cancelJob(job.id).catch(() => {})

    // Delete related renders from DB
    await db.from('renders').where('job_id', job.id).delete()

    // Delete stored files (clips + sidecars, renders)
    for (const prefix of [`clips/${job.id}`, `renders/${job.id}`]) {
      try {
        rmSync(storagePath(prefix), { recursive: true, force: true })
      } catch {}
    }

    await job.delete()
    return { success: true }
  }

  // DELETE /api/jobs/:id/clips/:clipFilename
  async destroyClip({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })

    const clipFilename = params.clipFilename
    const hotPoints: any[] = job.hotPoints ?? []
    const hpIndex = hotPoints.findIndex((h: Record<string, unknown>) => h.clip_filename === clipFilename)
    if (hpIndex === -1) return response.notFound({ error: 'clip not found in hot_points' })

    // 1. Remove from hotPoints array
    hotPoints.splice(hpIndex, 1)
    job.hotPoints = hotPoints
    await job.save()

    // 2. Delete related renders from DB + storage
    const renders = await db.from('renders').where('job_id', job.id).where('clip_filename', clipFilename)
    for (const render of renders) {
      if (render.output_filename) {
        try {
          await deleteObject(`renders/${job.id}/${render.output_filename}`)
        } catch {}
      }
      await db.from('renders').where('id', render.id).delete()
    }

    // 3. Delete clip + associated JSON files
    const localDir = clipDir(job.id)
    const clipBase = path.basename(clipFilename, path.extname(clipFilename))
    const suffixes = ['.mp4', '_meta.json', '_probe.json', '_words.json']
    for (const suffix of suffixes) {
      const filePath = path.join(localDir, clipBase + suffix)
      try {
        if (existsSync(filePath)) {
          rmSync(filePath)
        }
      } catch {}
    }

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

}
