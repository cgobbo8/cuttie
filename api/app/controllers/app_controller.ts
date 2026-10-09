import type { HttpContext } from '@adonisjs/core/http'
import { statfsSync } from 'node:fs'
import Job from '#models/job'
import { DATA_DIR } from '#services/data_paths'
import { autoLoginEnabled } from '#services/local_user'
import { readSettings, writeSettings } from '#services/user_settings'
import { getDiagnostics, runLocalTest } from '#services/worker_client'

/** Secret settings the user can edit from the Settings page (stored in settings.json). */
const KEY_SETTINGS = ['groq_api_key', 'openrouter_api_key', 'openai_api_key'] as const
type KeySetting = (typeof KEY_SETTINGS)[number]

/** Speech to text: Groq when its key is set ("auto"), OpenRouter, or this PC (see backend/app/services/transcriber.py) */
const TRANSCRIPTION_ENGINES = ['auto', 'groq', 'openrouter', 'local'] as const

/** Cheapest authenticated call of each provider, to check a key works */
const KEY_CHECKS: Partial<Record<KeySetting, string>> = {
  groq_api_key: 'https://api.groq.com/openai/v1/models',
  openrouter_api_key: 'https://openrouter.ai/api/v1/key',
}

/** First launch done: explicit flag, or an install that already has analyses */
async function isOnboarded(settings: Record<string, unknown>): Promise<boolean> {
  if (typeof settings.onboarded === 'boolean') return settings.onboarded
  return Boolean(await Job.query().select('id').first())
}

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
      onboarded: await isOnboarded(settings),
      transcription: TRANSCRIPTION_ENGINES.includes(settings.transcription as any) ? settings.transcription : 'auto',
    }
  }

  /**
   * PUT /api/settings — body: { keys?: { groq_api_key?: string, ... }, onboarded?: boolean,
   * transcription?: 'auto' | 'groq' | 'openrouter' | 'local' }; empty string or null clears a key
   */
  async updateSettings({ request, response }: HttpContext) {
    const body = request.body() as { keys?: Partial<Record<KeySetting, unknown>>; onboarded?: unknown; transcription?: unknown }
    const keys = body.keys ?? {}
    if (body.onboarded !== undefined && typeof body.onboarded !== 'boolean') {
      return response.badRequest({ error: 'onboarded must be a boolean' })
    }
    if (body.transcription !== undefined && !TRANSCRIPTION_ENGINES.includes(body.transcription as any)) {
      return response.badRequest({ error: `transcription must be one of ${TRANSCRIPTION_ENGINES.join(', ')}` })
    }

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

    if (typeof body.onboarded === 'boolean') settings.onboarded = body.onboarded
    if (typeof body.transcription === 'string') settings.transcription = body.transcription

    writeSettings(settings)
    return this.showSettings({} as HttpContext)
  }

  /**
   * POST /api/settings/verify — body: { name } — checks a saved key with its
   * provider. Returns { ok } or { ok: false, reason: missing | invalid | unreachable }.
   */
  async verifyKey({ request, response }: HttpContext) {
    const name = request.input('name') as KeySetting
    const url = KEY_CHECKS[name]
    if (!url) return response.badRequest({ error: 'unknown key' })

    const key = readSettings()[name]
    if (typeof key !== 'string' || !key) return { ok: false, reason: 'missing' }
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { ok: true }
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid' }
      return { ok: false, reason: 'unreachable' }
    } catch {
      return { ok: false, reason: 'unreachable' }
    }
  }

  /** POST /api/diagnostics/local-test — the GPU and Whisper on this computer, once (slow the first time: model download) */
  async localTest({ response }: HttpContext) {
    try {
      return await runLocalTest()
    } catch (err: any) {
      return response.status(502).json({ error: err.message })
    }
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
