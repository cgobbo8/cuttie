/**
 * Migrate old Python SQLite DB → new Adonis SQLite DB
 *
 * Run from project root:
 *   node scripts/migrate_db.mjs
 */

import Database from 'better-sqlite3'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OLD_DB = resolve(__dirname, '../backend/cuttie.db')
const NEW_DB = resolve(__dirname, '../api/tmp/db.sqlite3')

const src = new Database(OLD_DB, { readonly: true })
const dst = new Database(NEW_DB)

dst.pragma('journal_mode = WAL')
dst.pragma('foreign_keys = ON')

const now = new Date().toISOString()

const jobs = src.prepare(`
  SELECT job_id, url, status, progress, vod_title, error, created_at, updated_at
  FROM jobs
  ORDER BY created_at ASC
`).all()

console.log(`Migrating ${jobs.length} jobs...`)

const insertJob = dst.prepare(`
  INSERT OR IGNORE INTO jobs (id, url, status, progress, vod_title, error, hot_points, clips, created_at, updated_at)
  VALUES (@id, @url, @status, @progress, @vod_title, @error, @hot_points, @clips, @created_at, @updated_at)
`)

const getHotPoints = src.prepare(`
  SELECT rank, timestamp_seconds, timestamp_display, score, signals_json,
         clip_filename, vertical_filename, llm_json, final_score, chat_mood
  FROM hot_points
  WHERE job_id = ?
  ORDER BY rank ASC
`)

let inserted = 0
let skipped = 0

const migrate = dst.transaction(() => {
  for (const job of jobs) {
    const rawHotPoints = getHotPoints.all(job.job_id)
    const hotPoints = rawHotPoints.map(hp => ({
      rank: hp.rank,
      timestamp_seconds: hp.timestamp_seconds,
      timestamp_display: hp.timestamp_display,
      score: hp.score,
      final_score: hp.final_score,
      chat_mood: hp.chat_mood,
      clip_filename: hp.clip_filename,
      vertical_filename: hp.vertical_filename,
      signals: hp.signals_json ? JSON.parse(hp.signals_json) : null,
      llm: hp.llm_json ? JSON.parse(hp.llm_json) : null,
    }))

    const result = insertJob.run({
      id: job.job_id,
      url: job.url,
      status: job.status,
      progress: job.progress ?? null,
      vod_title: job.vod_title ?? null,
      error: job.error ?? null,
      hot_points: hotPoints.length > 0 ? JSON.stringify(hotPoints) : null,
      clips: null,
      created_at: job.created_at ?? now,
      updated_at: job.updated_at ?? now,
    })

    if (result.changes > 0) {
      inserted++
      console.log(`  ✓ ${job.job_id.slice(0, 8)}... ${job.vod_title || job.url} [${job.status}] (${rawHotPoints.length} hot points)`)
    } else {
      skipped++
      console.log(`  - ${job.job_id.slice(0, 8)}... already exists, skipped`)
    }
  }
})

migrate()

console.log(`\nDone: ${inserted} inserted, ${skipped} skipped`)
src.close()
dst.close()
