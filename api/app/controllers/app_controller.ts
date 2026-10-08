import type { HttpContext } from '@adonisjs/core/http'
import { statfsSync } from 'node:fs'
import { DATA_DIR } from '#services/data_paths'
import { autoLoginEnabled } from '#services/local_user'
import { readSettings, writeSettings } from '#services/user_settings'
import { getDiagnostics } from '#services/worker_client'

/** Secret settings the user can edit from the Settings page (stored in settings.json). */
const KEY_SETTINGS = ['groq_api_key', 'openrouter_api_key', 'openai_api_key'] as const
type KeySetting = (typeof KEY_SETTINGS)[number]

function mask(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  return value.length <= 8 ? '••••' : `${value.slice(0, 4)}••••${value.slice(-4)}`
}

export default class AppController {
  /** GET /api/app/info — public: lets the frontend adapt to the local desktop mode */
  async info({}: HttpContext) {
    return { mode: 'local', auto_login: autoLoginEnabled() }
  }

  /** GET /api/settings — API keys are only returned masked */
  async showSettings({}: HttpContext) {
    const settings = readSettings()
    return {
      keys: Object.fromEntries(
        KEY_SETTINGS.map((k) => [k, { configured: Boolean(settings[k]), preview: mask(settings[k]) }])
      ),
    }
  }

  /** PUT /api/settings — body: { keys: { groq_api_key?: string, ... } }; empty string or null clears a key */
  async updateSettings({ request, response }: HttpContext) {
    const body = request.body() as { keys?: Partial<Record<KeySetting, unknown>> }
    const keys = body.keys ?? {}

    const settings = readSettings()
    for (const name of KEY_SETTINGS) {
      const value = keys[name]
      if (value === undefined) continue
      // The body parser turns "" into null
      if (value !== null && typeof value !== 'string') {
        return response.badRequest({ error: `${name} must be a string` })
      }
      const trimmed = (value ?? '').trim()
      if (trimmed) settings[name] = trimmed
      else delete settings[name]
    }

    writeSettings(settings)
    return this.showSettings({} as HttpContext)
  }

  /** GET /api/diagnostics — health of the local install (worker, GPU, tools, keys, disk) */
  async diagnostics({}: HttpContext) {
    let worker: Record<string, unknown> | null = null
    let workerError: string | null = null
    try {
      worker = await getDiagnostics()
    } catch (err: any) {
      workerError = err.message
    }

    let diskFreeGb: number | null = null
    try {
      const stats = statfsSync(DATA_DIR)
      diskFreeGb = Math.round((stats.bavail * stats.bsize) / 1e8) / 10
    } catch {}

    return {
      api: { node: process.version, platform: `${process.platform}-${process.arch}`, data_dir: DATA_DIR, disk_free_gb: diskFreeGb },
      worker,
      worker_error: workerError,
    }
  }
}
