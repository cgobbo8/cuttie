import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import { clearLogs, journalSince, logsSize, redact } from '#services/app_logs'
import { DATA_DIR } from '#services/data_paths'
import { cleanupDays, diskUsage } from '#services/disk_space'
import { readSettings } from '#services/user_settings'
import { getCachedMachineProfile, getDiagnostics } from '#services/worker_client'
import { zip } from '#services/zip'

/** Periods the journal can be exported over (hours; 0 = all it keeps) */
export const EXPORT_PERIODS = [1, 24, 168, 0]

/** Errors of the page: at most this many journal lines a minute */
const CLIENT_LINES_PER_MINUTE = 30
let clientWindow = { start: 0, count: 0 }

const SECRET_NAME = /api[_-]?key|secret|token|password/i

/** Settings as they can leave this computer: keys only said to be there */
export function supportSettings(value: unknown, name = ''): unknown {
  if (SECRET_NAME.test(name)) return value ? 'configured' : null
  if (Array.isArray(value)) return value.map((item) => supportSettings(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, supportSettings(item, key)]))
  }
  return value
}

/** A database time as ms (Luxon, Date, or SQLite text, which is UTC) */
function millis(value: unknown): number {
  if (!value) return 0
  if (typeof (value as any).toMillis === 'function') return (value as any).toMillis()
  if (value instanceof Date) return value.getTime()
  const text = String(value)
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`) || 0
}

export default class SupportController {
  /** GET /api/logs — size of the journal */
  async show({}: HttpContext) {
    return { bytes: logsSize() }
  }

  /** DELETE /api/logs — empty the journal */
  async destroy({}: HttpContext) {
    const freed = clearLogs()
    logger.info(`Journal emptied from the app (${Math.round(freed / 1000)} KB)`)
    return { freed, bytes: logsSize() }
  }

  /**
   * GET /api/logs/export?hours=24 — a .zip for whoever helps: the journal of the
   * period, this computer (diagnostic, disk, settings without keys) and the
   * analyses and exports of the period. Keys and tokens are taken out.
   */
  async download({ request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const asked = Number(request.input('hours', 24))
    const hours = EXPORT_PERIODS.includes(asked) ? asked : 24
    const now = new Date()
    const since = hours ? now.getTime() - hours * 3600_000 : 0

    let worker: unknown = null
    let workerError: string | null = null
    try {
      worker = await getDiagnostics()
    } catch (err: any) {
      workerError = err.message
    }
    let machine: unknown = null
    try {
      machine = await getCachedMachineProfile()
    } catch {}

    const inPeriod = (...times: unknown[]) => !since || times.some((t) => millis(t) >= since)
    const jobs = (await Job.query().where('user_id', user.id).orderBy('created_at', 'asc')).filter((job) => inPeriod(job.createdAt, job.updatedAt))
    const renders = (await db.from('renders').where('user_id', user.id).orderBy('created_at', 'asc')).filter((r) => inPeriod(r.created_at, r.updated_at))

    const zone = String(request.input('tz', '')).slice(0, 64)
    const diagnostic = {
      exported_at: now.toISOString(),
      // The journal's times are UTC; this is where the streamer is
      timezone: /^[A-Za-z_+\-/0-9]+$/.test(zone) ? zone : null,
      period_hours: hours || null,
      app: {
        version: process.env.CUTTIE_APP_VERSION ?? null,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        data_dir: DATA_DIR,
      },
      disk: diskUsage(),
      cleanup_days: cleanupDays(),
      worker,
      worker_error: workerError,
      machine,
      settings: supportSettings(readSettings()),
    }
    const analyses = {
      jobs: jobs.map((job) => ({
        id: job.id,
        url: job.url,
        status: job.status,
        progress: job.progress,
        error: job.error,
        created_at: job.createdAt?.toISO(),
        updated_at: job.updatedAt?.toISO(),
        title: job.vodTitle,
        game: job.vodGame,
        live_seconds: job.vodDurationSeconds,
        steps: job.stepTimings,
        notices: job.notices,
        eta: job.timeline?.eta ?? null,
        clips: (job.hotPoints ?? []).filter((hp: any) => hp.clip_filename).length,
        kept: Object.values(job.selection ?? {}).filter((s: any) => s?.state === 'kept').length,
        clips_freed_at: job.clipsFreedAt?.toISO() ?? null,
      })),
      exports: renders.map((r) => ({
        id: r.id,
        job_id: r.job_id,
        clip: r.clip_filename,
        status: r.status,
        progress: r.progress,
        error: r.error,
        size_mb: r.size_mb,
        created_at: r.created_at,
        updated_at: r.updated_at,
      })),
    }

    const journal = journalSince(since)
    const archive = zip(
      [
        { name: 'journal.log', data: journal || '(journal vide sur cette période)\n' },
        { name: 'diagnostic.json', data: redact(JSON.stringify(diagnostic, null, 2)) },
        { name: 'analyses.json', data: redact(JSON.stringify(analyses, null, 2)) },
      ],
      now
    )
    const stamp = now.toISOString().slice(0, 16).replace('T', '-').replace(':', 'h')
    logger.info(`Journal exported: ${hours ? `${hours} h` : 'all'}, ${jobs.length} analyses, ${Math.round(archive.length / 1000)} KB`)

    response.header('Content-Type', 'application/zip')
    response.header('Content-Disposition', `attachment; filename="cuttie-journal-${stamp}.zip"`)
    response.header('Cache-Control', 'no-store')
    return response.send(archive)
  }

  /** POST /api/client-log — an error of the app's page, into the journal */
  async clientLog({ request }: HttpContext) {
    const now = Date.now()
    if (now - clientWindow.start > 60_000) clientWindow = { start: now, count: 0 }
    if (++clientWindow.count > CLIENT_LINES_PER_MINUTE) return { logged: false }

    const { kind, message, stack, page } = request.only(['kind', 'message', 'stack', 'page'])
    const head = `${String(kind || 'error').slice(0, 40)}: ${String(message ?? '').slice(0, 500)}`
    const where = page ? ` (${String(page).slice(0, 200)})` : ''
    const trace = typeof stack === 'string' ? stack.split('\n').slice(0, 6).map((l) => l.trim()).join(' | ').slice(0, 1200) : ''
    logger.warn(redact(`[ui] ${head}${where}${trace ? ` — ${trace}` : ''}`))
    return { logged: true }
  }
}
