/**
 * The app's journal, written by the desktop app (desktop/main.mjs) in <DATA_DIR>/logs:
 * the API, the worker and the app, one line each starting with its ISO time (a
 * line without one continues the line before: a stack trace). cuttie.log becomes
 * cuttie.1.log, then cuttie.2.log, at 10 MB: 30 MB at most.
 */

import { existsSync, readdirSync, readFileSync, rmSync, statSync, truncateSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '#services/data_paths'

export const LOGS_DIR = path.join(DATA_DIR, 'logs')

const CURRENT = 'cuttie.log'
const JOURNAL = /^cuttie(?:\.(\d+)|\.old)?\.log$/
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) /

/** The journal's files, oldest first */
export function journalFiles(dir = LOGS_DIR): string[] {
  if (!existsSync(dir)) return []
  const age = (name: string) => {
    if (name === CURRENT) return 0
    const rotated = JOURNAL.exec(name)?.[1]
    return rotated ? Number(rotated) : 99 // cuttie.old.log, from before the rotation
  }
  return readdirSync(dir)
    .filter((name) => JOURNAL.test(name))
    .sort((a, b) => age(b) - age(a))
    .map((name) => path.join(dir, name))
}

/** Bytes in the logs folder */
export function logsSize(dir = LOGS_DIR): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    try {
      if (entry.isFile()) total += statSync(path.join(dir, entry.name)).size
    } catch {}
  }
  return total
}

/**
 * Empty the logs folder: the current journal is cut to nothing (the desktop app
 * keeps writing to it), the rest goes. Returns the bytes freed.
 */
export function clearLogs(dir = LOGS_DIR): number {
  if (!existsSync(dir)) return 0
  const before = logsSize(dir)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    try {
      if (entry.name === CURRENT) truncateSync(file, 0)
      else rmSync(file, { recursive: true, force: true })
    } catch {}
  }
  return Math.max(0, before - logsSize(dir))
}

/** The lines written since `since` (ms; 0 = all), with the lines that continue them */
export function linesSince(text: string, since: number): string[] {
  const kept: string[] = []
  let keep = since <= 0
  for (const line of text.split(/\r?\n/)) {
    const stamp = STAMP.exec(line)
    if (stamp) keep = Date.parse(stamp[1]) >= since
    if (keep && line) kept.push(line)
  }
  return kept
}

const SECRETS: [RegExp, string][] = [
  [/sk-or-v1-[A-Za-z0-9]{16,}/g, 'sk-or-v1-…'],
  [/gsk_[A-Za-z0-9]{16,}/g, 'gsk_…'],
  [/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, 'sk-…'],
  [/hf_[A-Za-z0-9]{16,}/g, 'hf_…'],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1…'],
  // Signed storage URLs, Twitch playlist tokens
  [/([?&](?:sig|signature|token|access_token|key|api_key)=)[^&\s"'<>]+/gi, '$1…'],
  // A key's value, unless only said to be there
  [/("?(?:secret|password|api[_-]?key|token)"?\s*[:=]\s*"?)(?!configured\b)[^"\s,}&]{6,}/gi, '$1…'],
]

/** API keys, tokens and signatures out of a text that leaves this computer */
export function redact(text: string): string {
  return SECRETS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text)
}

/** The journal since `since` (ms; 0 = all), oldest first, secrets out */
export function journalSince(since: number, dir = LOGS_DIR): string {
  const lines: string[] = []
  for (const file of journalFiles(dir)) {
    try {
      lines.push(...linesSince(readFileSync(file, 'utf-8'), since))
    } catch {}
  }
  return lines.length ? redact(lines.join('\n') + '\n') : ''
}
