import type { HttpContext } from '@adonisjs/core/http'
import Job from '#models/job'
import db from '@adonisjs/lucid/services/db'
import { cancelJob, flushQueue, getQueue, type WorkerQueue } from '#services/worker_client'
const ACTIVE_STATUSES = [
  'PENDING',
  'DOWNLOADING_AUDIO',
  'DOWNLOADING_CHAT',
  'ANALYZING_AUDIO',
  'ANALYZING_CHAT',
  'SCORING',
  'ANALYZING_CLIPS',
  'CLIPPING',
  'LLM_ANALYSIS',
]

export default class WorkersController {
  // GET /api/workers
  async index({}: HttpContext) {
    const activeJobs = await Job.query()
      .whereIn('status', ACTIVE_STATUSES)
      .orderBy('updated_at', 'desc')

    let workerQueue: WorkerQueue = { current: null, items: [] }
    try {
      workerQueue = await getQueue()
    } catch {}

    const activeRenders = await db
      .from('renders')
      .whereIn('status', ['pending', 'rendering'])
      .orderBy('created_at', 'desc')

    return {
      active_jobs: activeJobs.map((job) => ({
        id: job.id,
        url: job.url,
        status: job.status,
        progress: job.progress,
        streamer: job.streamer,
        vod_title: job.vodTitle,
        vod_game: job.vodGame,
        step_timings: job.stepTimings,
        created_at: job.createdAt?.toISO(),
        updated_at: job.updatedAt?.toISO(),
      })),
      active_renders: activeRenders.map((r) => ({
        id: r.id,
        job_id: r.job_id,
        clip_filename: r.clip_filename,
        clip_name: r.clip_name,
        status: r.status,
        progress: r.progress,
        batch_group_id: r.batch_group_id,
        created_at: r.created_at,
      })),
      queue: {
        length: workerQueue.items.length,
        items: workerQueue.items,
      },
    }
  }

  // POST /api/workers/flush
  async flush({}: HttpContext) {
    let queueLength = 0
    try {
      queueLength = (await flushQueue()).flushed
    } catch {}

    const activeJobs = await Job.query().whereIn('status', ACTIVE_STATUSES)
    for (const job of activeJobs) {
      job.status = 'ERROR'
      job.error = 'Cancelled by admin'
      job.progress = 'Cancelled'
      await job.save()
      await cancelJob(job.id).catch(() => {})
    }

    const cancelledRenders = await db
      .from('renders')
      .whereIn('status', ['pending', 'rendering'])
      .update({ status: 'error', error: 'Cancelled by admin', updated_at: new Date().toISOString() })

    return {
      flushed_queue: queueLength,
      cancelled_jobs: activeJobs.length,
      cancelled_renders: cancelledRenders,
    }
  }

  // POST /api/workers/cancel/:id
  async cancel({ params, response }: HttpContext) {
    const job = await Job.find(params.id)
    if (!job) return response.notFound({ error: 'Job not found' })

    if (!ACTIVE_STATUSES.includes(job.status)) {
      return response.badRequest({ error: 'Job is not active' })
    }

    job.status = 'ERROR'
    job.error = 'Cancelled by admin'
    job.progress = 'Cancelled'
    await job.save()

    // Signal the Python worker to stop this job
    await cancelJob(job.id).catch(() => {})

    return { cancelled: true, job_id: job.id }
  }

  // POST /api/workers/cancel-render/:id
  async cancelRender({ params, response }: HttpContext) {
    const render = await db.from('renders').where('id', params.id).first()
    if (!render) return response.notFound({ error: 'Render not found' })

    if (!['pending', 'rendering'].includes(render.status)) {
      return response.badRequest({ error: 'Render is not active' })
    }

    await db.from('renders').where('id', params.id).update({
      status: 'error',
      error: 'Cancelled by admin',
      updated_at: new Date().toISOString(),
    })

    return { cancelled: true, render_id: params.id }
  }
}
