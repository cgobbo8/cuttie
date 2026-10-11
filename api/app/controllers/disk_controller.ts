import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import {
  CLEANUP_CHOICES,
  autoCleanup,
  cleanupDays,
  diskUsage,
  freeProject,
  freeStale,
  freeableBytes,
  projectSpaces,
  restoreProject,
  setCleanupDays,
  stale,
} from '#services/disk_space'
import { WorkerHttpError, WorkerUnavailableError } from '#services/worker_client'

export default class DiskController {
  /** GET /api/disk — what Cuttie keeps on this computer, and what a cleanup would free */
  async show({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const projects = await projectSpaces(user.id)
    const cleanable = Object.fromEntries(
      CLEANUP_CHOICES.filter(Boolean).map((days) => {
        const due = stale(projects, days)
        return [days, { projects: due.length, bytes: due.reduce((total, p) => total + p.clips, 0) }]
      })
    )
    return { usage: diskUsage(), cleanup_days: cleanupDays(), cleanable, projects }
  }

  /** PUT /api/disk/cleanup — { days: 0 | 7 | 30 | 90 }: the cleanup by itself (0 = never); runs at once */
  async updateCleanup({ request, response }: HttpContext) {
    const days = Number(request.input('days'))
    if (!CLEANUP_CHOICES.includes(days)) return response.badRequest({ error: `days must be one of ${CLEANUP_CHOICES.join(', ')}` })
    setCleanupDays(days)
    const before = diskUsage().clips
    await autoCleanup()
    return { cleanup_days: days, freed: Math.max(0, before - diskUsage().clips) }
  }

  /** POST /api/disk/free — { days }: free now the projects idle that long */
  async free({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const days = Number(request.input('days'))
    if (!CLEANUP_CHOICES.includes(days) || !days) return response.badRequest({ error: 'invalid days' })
    return freeStale(days, user.id)
  }

  /** POST /api/jobs/:id/free — free one project's clips (its exports stay) */
  async freeJob({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })
    if (job.status !== 'DONE' && job.status !== 'ERROR') return response.conflict({ error: 'analysis running' })
    const rendering = await db.from('renders').where('job_id', job.id).whereIn('status', ['pending', 'rendering']).first()
    if (rendering) return response.conflict({ error: 'export running' })
    const bytes = await freeProject(job)
    return { freed: bytes, clips_freed_at: job.clipsFreedAt?.toISO() ?? null }
  }

  /** POST /api/jobs/:id/restore — cut a freed project's clips again from the live */
  async restoreJob({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.find(params.id)
    if (!job || job.userId !== user.id) return response.notFound({ error: 'job not found' })
    try {
      const result = await restoreProject(job)
      return { ...result, bytes: freeableBytes(job.id), clips_freed_at: job.clipsFreedAt?.toISO() ?? null }
    } catch (err) {
      if (err instanceof WorkerHttpError && err.status === 410) return response.gone({ error: 'live gone' })
      if (err instanceof WorkerUnavailableError) return response.status(502).json({ error: 'worker unreachable' })
      return response.status(502).json({ error: err instanceof Error ? err.message : String(err) })
    }
  }
}
