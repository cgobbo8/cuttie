/**
 * What Cuttie keeps on this computer, and making room.
 *
 * A project's clips weigh ~1 GB (20 clips in the live's quality); its exports,
 * thumbnails, words and the rest weigh little. Freeing a project deletes its
 * clips and their blurred backdrops, nothing else: the exports stay, and so do
 * each clip's place in the live (_meta.json), its words and its cam, so the
 * worker can cut them again while the live is still on Twitch (7 to 60 days).
 *
 * Cleanup: projects nobody touched for N days are freed by themselves
 * (settings.json `cleanup_days`; by default 30 in the desktop app, off in dev).
 */

import { existsSync, lstatSync, readdirSync, rmSync, statfsSync } from 'node:fs'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Job from '#models/job'
import { LOGS_DIR, logsSize } from '#services/app_logs'
import { readClipMeta } from '#services/clip_extend'
import { keepThumb } from '#services/clip_thumbs'
import { CLIPS_DIR, DATA_DIR, STORAGE_DIR, clipDir } from '#services/data_paths'
import { readSettings, writeSettings } from '#services/user_settings'
import { restoreClipFiles } from '#services/worker_client'

/** The cleanup choices offered (days without activity; 0 = never) */
export const CLEANUP_CHOICES = [0, 7, 30, 90]
const DAY_MS = 86_400_000
const CLEANUP_EVERY_MS = 6 * 3600_000

/** 1.23 GB, 456 MB (the journal) */
function human(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`
}

/** Bytes under a folder, or of a file (links not followed) */
export function sizeOf(target: string): number {
  let stats
  try {
    stats = lstatSync(target)
  } catch {
    return 0
  }
  if (!stats.isDirectory()) return stats.isFile() ? stats.size : 0
  let total = 0
  for (const name of readdirSync(target)) total += sizeOf(path.join(target, name))
  return total
}

/** What freeing a project deletes: its clips and their blurred backdrops */
function freeable(jobId: string): string[] {
  const dir = clipDir(jobId)
  if (!existsSync(dir)) return []
  const clips = readdirSync(dir)
    .filter((name) => name.endsWith('.mp4'))
    .map((name) => path.join(dir, name))
  const backdrops = path.join(dir, 'bg')
  return existsSync(backdrops) ? [...clips, backdrops] : clips
}

export function freeableBytes(jobId: string): number {
  return freeable(jobId).reduce((total, file) => total + sizeOf(file), 0)
}

// ── Cleanup setting ──────────────────────────────────────────────────────────

export function cleanupDays(): number {
  const chosen = readSettings().cleanup_days
  if (typeof chosen === 'number' && CLEANUP_CHOICES.includes(chosen)) return chosen
  const preset = Number(process.env.CUTTIE_CLEANUP_DAYS)
  return CLEANUP_CHOICES.includes(preset) ? preset : 0
}

export function setCleanupDays(days: number): void {
  writeSettings({ ...readSettings(), cleanup_days: days })
}

// ── Projects ─────────────────────────────────────────────────────────────────

export interface ProjectSpace {
  id: string
  title: string | null
  date: string | null
  status: string
  /** Last change of the project or of one of its exports (ISO) */
  last_activity: string
  /** Bytes freeing it would give back (its clips) */
  clips: number
  /** Bytes of its exports (never freed) */
  exports: number
  kept: number
  exported: number
  freed_at: string | null
  /** An export is being made from it: not freed now */
  rendering: boolean
}

export async function projectSpaces(userId?: number): Promise<ProjectSpace[]> {
  const query = Job.query().orderBy('created_at', 'asc')
  if (userId !== undefined) query.where('user_id', userId)
  const jobs = await query
  const renders = await db
    .from('renders')
    .select('job_id', 'status', 'updated_at', 'created_at')
    .whereIn(
      'job_id',
      jobs.map((job) => job.id)
    )

  return jobs.map((job) => {
    const own = renders.filter((r) => r.job_id === job.id)
    const times = [job.updatedAt?.toMillis() ?? 0, job.createdAt?.toMillis() ?? 0, ...own.map((r) => Date.parse(r.updated_at ?? r.created_at) || 0)]
    return {
      id: job.id,
      title: job.customTitle || job.vodTitle,
      date: job.streamDate ?? job.createdAt?.toISO() ?? null,
      status: job.status,
      last_activity: new Date(Math.max(...times)).toISOString(),
      clips: freeableBytes(job.id),
      exports: sizeOf(path.join(STORAGE_DIR, 'renders', job.id)),
      kept: Object.values(job.selection ?? {}).filter((s: any) => s?.state === 'kept').length,
      exported: own.filter((r) => r.status === 'done').length,
      freed_at: job.clipsFreedAt?.toISO() ?? null,
      rendering: own.some((r) => r.status === 'pending' || r.status === 'rendering'),
    }
  })
}

/** Projects a cleanup at `days` frees: finished, idle that long, clips still there */
export function stale(projects: ProjectSpace[], days: number, now = Date.now()): ProjectSpace[] {
  if (days <= 0) return []
  return projects.filter(
    (p) =>
      (p.status === 'DONE' || p.status === 'ERROR') &&
      !p.rendering &&
      p.clips > 0 &&
      Date.parse(p.last_activity) <= now - days * DAY_MS
  )
}

/** Delete a project's clips; its exports, thumbnails and the rest stay. Returns the bytes freed. */
export async function freeProject(job: Job): Promise<number> {
  const clips: string[] = (job.hotPoints ?? []).map((hp: any) => hp.clip_filename).filter(Boolean)
  // The pictures the app shows stay: made now, while the clips are there
  for (const [i, filename] of clips.entries()) {
    try {
      await keepThumb(job.id, filename, 480)
      if (i === 0) await keepThumb(job.id, filename, 1280)
    } catch {}
  }

  let freed = 0
  for (const file of freeable(job.id)) {
    const bytes = sizeOf(file)
    try {
      rmSync(file, { recursive: true, force: true })
      freed += bytes
    } catch (err: any) {
      // Still open somewhere (Windows): the next cleanup takes it
      logger.warn(`[cleanup] ${path.basename(file)} kept for now: ${err.code ?? err.message}`)
    }
  }
  if (!job.clipsFreedAt) {
    job.clipsFreedAt = DateTime.now()
    await job.save()
  }
  logger.info(`[cleanup] ${job.id.slice(0, 8)}: ${clips.length} clips freed, ${human(freed)}`)
  return freed
}

/** Free every project idle for `days`. */
export async function freeStale(days: number, userId?: number): Promise<{ projects: number; bytes: number }> {
  const targets = stale(await projectSpaces(userId), days)
  let bytes = 0
  for (const target of targets) {
    const job = await Job.find(target.id)
    if (job) bytes += await freeProject(job)
  }
  return { projects: targets.length, bytes }
}

export class LiveGoneError extends Error {}

/** Cut a freed project's clips again from the live, at the same places */
export async function restoreProject(job: Job): Promise<{ restored: number; failed: number }> {
  const clips = (job.hotPoints ?? [])
    .filter((hp: any) => hp.clip_filename)
    .map((hp: any) => {
      const meta = readClipMeta(job.id, hp.clip_filename)
      return { filename: hp.clip_filename as string, start: meta?.vod_start ?? hp.clip_start, end: meta?.vod_end ?? hp.clip_end }
    })
    .filter((c: { start: unknown; end: unknown }) => Number.isFinite(c.start) && Number.isFinite(c.end) && (c.end as number) > (c.start as number))

  const result = await restoreClipFiles(job.id, job.url, clips)
  if (result.failed.length === 0) {
    job.clipsFreedAt = null
    await job.save()
  }
  logger.info(`[cleanup] ${job.id.slice(0, 8)}: ${result.restored.length}/${clips.length} clips cut again from the live`)
  return { restored: result.restored.length, failed: result.failed.length }
}

// ── The whole folder ─────────────────────────────────────────────────────────

export interface DiskUsage {
  /** Bytes in Cuttie's data folder */
  total: number
  /** Free bytes on its disk (null: unknown) */
  free: number | null
  clips: number
  exports: number
  models: number
  logs: number
  other: number
}

export function diskUsage(): DiskUsage {
  const total = sizeOf(DATA_DIR)
  const clips = sizeOf(CLIPS_DIR)
  const exports = sizeOf(path.join(STORAGE_DIR, 'renders'))
  const models = sizeOf(path.join(DATA_DIR, 'models'))
  const logs = existsSync(LOGS_DIR) ? logsSize() : 0
  let free: number | null = null
  try {
    const stats = statfsSync(DATA_DIR)
    free = stats.bavail * stats.bsize
  } catch {}
  return { total, free, clips, exports, models, logs, other: Math.max(0, total - clips - exports - models - logs) }
}

// ── By itself ────────────────────────────────────────────────────────────────

let running = false

export async function autoCleanup(): Promise<void> {
  const days = cleanupDays()
  if (!days || running) return
  running = true
  try {
    const { projects, bytes } = await freeStale(days)
    if (projects) logger.info(`[cleanup] ${projects} project(s) idle for ${days}+ days: ${human(bytes)} freed (exports kept)`)
  } catch (err: any) {
    logger.warn(`[cleanup] failed: ${err.message}`)
  } finally {
    running = false
  }
}

/** A few minutes after the start (not while the app opens), then every 6 hours */
export function scheduleCleanup(): void {
  setTimeout(autoCleanup, 3 * 60_000).unref()
  setInterval(autoCleanup, CLEANUP_EVERY_MS).unref()
}
