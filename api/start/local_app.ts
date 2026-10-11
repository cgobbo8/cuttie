/**
 * Preload (web only): prepare the local data directory before serving requests.
 *  - create the data/storage folders and run pending migrations (the desktop
 *    app has no separate "migration:run" step)
 *  - make sure the local user exists
 *  - mark jobs interrupted by a previous shutdown as failed (the worker queue
 *    lives in memory, so they will never resume on their own)
 */

import { mkdirSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { CLIPS_DIR, DATA_DIR, STORAGE_DIR } from '#services/data_paths'
import { autoLoginEnabled, ensureLocalUser } from '#services/local_user'
import { scheduleCleanup } from '#services/disk_space'

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

for (const dir of [DATA_DIR, STORAGE_DIR, CLIPS_DIR]) {
  mkdirSync(dir, { recursive: true })
}

const migrator = new MigrationRunner(db, app, { direction: 'up' })
await migrator.run()
if (migrator.error) throw migrator.error

if (autoLoginEnabled()) {
  await ensureLocalUser()
}

const now = new Date().toISOString()
const interrupted = await db
  .from('jobs')
  .whereIn('status', ACTIVE_STATUSES)
  .update({ status: 'ERROR', error: 'Analyse interrompue (Cuttie a été fermé). Relance-la.', updated_at: now })
await db
  .from('renders')
  .whereIn('status', ['pending', 'rendering'])
  .update({ status: 'error', error: 'Export interrompu (Cuttie a été fermé).', updated_at: now })

const interruptedCount = Number(Array.isArray(interrupted) ? interrupted[0] : interrupted) || 0
logger.info(
  'Local data dir: %s%s',
  DATA_DIR,
  interruptedCount ? ` — ${interruptedCount} interrupted job(s) marked as failed` : ''
)

// Projects idle for a while give their clips' space back (Settings > Storage)
if (!app.inTest) scheduleCleanup()
