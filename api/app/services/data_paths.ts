/**
 * Filesystem layout of the local Cuttie data directory (shared with the worker,
 * see backend/app/services/paths.py).
 *
 *   <DATA_DIR>/storage/{clips,renders,assets}/   files served by /api/storage
 *   <DATA_DIR>/api.sqlite3                       API database
 *   <DATA_DIR>/settings.json                     user settings (API keys, ...)
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

// app/services → api root → repo root (dev default only; the desktop app always sets CUTTIE_DATA_DIR)
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const DATA_DIR = path.resolve(process.env.CUTTIE_DATA_DIR || path.join(API_ROOT, '..', '.data'))
export const STORAGE_DIR = path.join(DATA_DIR, 'storage')
export const CLIPS_DIR = path.join(STORAGE_DIR, 'clips')
export const DB_PATH = path.join(DATA_DIR, 'api.sqlite3')
export const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json')

/** Absolute path of a storage key ("clips/<job>/<file>"), refusing keys that escape storage. */
export function storagePath(key: string): string {
  const resolved = path.resolve(STORAGE_DIR, key)
  if (resolved !== STORAGE_DIR && !resolved.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error(`Invalid storage key: ${key}`)
  }
  return resolved
}

export function clipDir(jobId: string): string {
  return path.join(CLIPS_DIR, jobId)
}
