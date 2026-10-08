/**
 * User settings stored in <DATA_DIR>/settings.json (shared with the worker,
 * which reads the API keys from the same file).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SETTINGS_PATH } from '#services/data_paths'

export function readSettings(): Record<string, unknown> {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      if (data && typeof data === 'object') return data
    }
  } catch {}
  return {}
}

export function writeSettings(settings: Record<string, unknown>): void {
  mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

/** A string setting, or undefined when unset. */
export function getSetting(name: string): string | undefined {
  const value = readSettings()[name]
  return typeof value === 'string' && value ? value : undefined
}
