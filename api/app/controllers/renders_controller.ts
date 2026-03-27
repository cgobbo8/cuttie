import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'
import { renderClip } from '#services/remotion_renderer'

const CLIPS_BASE = path.resolve('../backend/clips')

// ── helpers ──────────────────────────────────────────────────────────────────

async function getRender(id: string) {
  return db.from('renders').where('id', id).first()
}

function serializeRender(row: any) {
  return {
    render_id: row.id,
    job_id: row.job_id,
    clip_filename: row.clip_filename,
    clip_name: row.clip_name ?? undefined,
    status: row.status,
    progress: row.progress,
    output_filename: row.output_filename ?? undefined,
    size_mb: row.size_mb ?? undefined,
    url: row.output_filename
      ? `/api/clips/${row.job_id}/${row.output_filename}`
      : undefined,
    error: row.error ?? undefined,
    created_at: row.created_at,
  }
}

// ── controller ───────────────────────────────────────────────────────────────

export default class RendersController {
  /** POST /api/clips/:jobId/:filename/render */
  async store({ params, request, response }: HttpContext) {
    const { jobId, filename } = params
    const body = request.body() as { layers: unknown[]; trim_start?: number; trim_end?: number; clip_name?: string }
    const { layers, trim_start, trim_end, clip_name } = body

    if (!layers || !Array.isArray(layers)) {
      return response.badRequest({ error: 'layers array required' })
    }

    const trim =
      trim_start != null && trim_end != null
        ? { start: trim_start, end: trim_end }
        : undefined

    const renderId = randomUUID()
    const outputFilename = `render_${renderId}.mp4`
    const outputPath = path.join(CLIPS_BASE, jobId, outputFilename)

    const now = new Date().toISOString()
    await db.table('renders').insert({
      id: renderId,
      job_id: jobId,
      clip_filename: filename,
      clip_name: clip_name || null,
      status: 'rendering',
      progress: 0,
      created_at: now,
      updated_at: now,
    })

    // Fire-and-forget — render runs asynchronously
    runRender({ renderId, jobId, clipFilename: filename, layers: layers as any, outputPath, outputFilename, trim })

    return response.created({ render_id: renderId })
  }

  /** GET /api/renders */
  async index({ response }: HttpContext) {
    const rows = await db
      .from('renders')
      .join('jobs', 'renders.job_id', 'jobs.id')
      .select('renders.*', 'jobs.vod_title')
      .orderBy('renders.created_at', 'desc')
    return response.json(rows.map(serializeRender))
  }

  /** GET /api/renders/:renderId */
  async show({ params, response }: HttpContext) {
    const row = await getRender(params.renderId)
    if (!row) return response.notFound({ error: 'render not found' })
    return response.json(serializeRender(row))
  }

  /** GET /api/renders/:renderId/download */
  async download({ params, response }: HttpContext) {
    const row = await getRender(params.renderId)
    if (!row || !row.output_filename) {
      return response.notFound({ error: 'render not ready' })
    }
    const filePath = path.join(CLIPS_BASE, row.job_id, row.output_filename)
    if (!existsSync(filePath)) return response.notFound({ error: 'file not found' })
    const downloadName = row.clip_name ? `${row.clip_name}.mp4` : row.output_filename
    response.header('Content-Disposition', `attachment; filename="${downloadName}"`)
    return response.download(filePath)
  }
}

// ── background render ────────────────────────────────────────────────────────

async function runRender(opts: {
  renderId: string
  jobId: string
  clipFilename: string
  layers: any[]
  outputPath: string
  outputFilename: string
  trim?: { start: number; end: number }
}) {
  const { renderId, jobId, clipFilename, layers, outputPath, outputFilename, trim } = opts

  const updateRender = async (fields: Record<string, any>) => {
    await db.from('renders').where('id', renderId).update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
  }

  try {
    const { sizeMb } = await renderClip({
      renderId,
      layers,
      jobId,
      clipFilename,
      outputPath,
      trim,
      onProgress: async (pct) => {
        await updateRender({ progress: pct })
      },
    })

    await updateRender({
      status: 'done',
      progress: 100,
      output_filename: outputFilename,
      size_mb: Math.round(sizeMb * 100) / 100,
    })
  } catch (err: any) {
    console.error('[Render] Failed:', err.message)
    await updateRender({ status: 'error', error: err.message })
  }
}
