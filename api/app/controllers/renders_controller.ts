import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import path from 'node:path'
import archiver from 'archiver'
import db from '@adonisjs/lucid/services/db'
import { renderClip } from '#services/remotion_renderer'
import { uploadFile, getPresignedDownloadUrl, getPresignedUrl, deleteObject } from '#services/s3'
import { enqueueRender } from '#services/render_queue'
import { loadJobSharedData, resolveEditEnv } from '#services/edit_env_resolver'
import { resolveThemeForClip, type ThemeLayerTemplate } from '#services/theme_resolver'
import type { Layer } from '../../remotion/editorTypes.js'

const CLIPS_BASE = path.resolve('../backend/clips')

// ── helpers ──────────────────────────────────────────────────────────────────

async function getRender(id: string) {
  return db.from('renders').where('id', id).first()
}

interface RenderRow {
  id: string
  job_id: string
  clip_filename: string
  clip_name: string | null
  status: string
  progress: number
  output_filename: string | null
  size_mb: number | null
  error: string | null
  user_id: number
  batch_group_id: string | null
  vod_title?: string | null
  vod_game?: string | null
  created_at: string
}

function serializeRender(row: RenderRow) {
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
      ? `/api/renders/${row.id}/download`
      : undefined,
    error: row.error ?? undefined,
    batch_group_id: row.batch_group_id ?? undefined,
    vod_title: row.vod_title ?? undefined,
    vod_game: row.vod_game ?? undefined,
    created_at: row.created_at,
  }
}

// ── controller ───────────────────────────────────────────────────────────────

export default class RendersController {
  /** POST /api/clips/:jobId/:filename/render */
  async store({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const { jobId, filename } = params
    const body = request.body() as { layers: unknown[]; trim_start?: number; trim_end?: number; clip_name?: string; render_options?: { width?: number; height?: number; fps?: number } }
    const { layers, trim_start, trim_end, clip_name, render_options } = body

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
      user_id: user.id,
      created_at: now,
      updated_at: now,
    })

    // Enqueue render (sequential queue ensures one at a time)
    enqueueRender(() => runRender({ renderId, jobId, clipFilename: filename, layers: layers as Layer[], outputPath, outputFilename, trim, renderOptions: render_options }))

    return response.created({ render_id: renderId })
  }

  /** POST /api/jobs/:jobId/batch-render */
  async batchStore({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const jobId = params.jobId

    // Verify job ownership
    const job = await db.from('jobs').where('id', jobId).where('user_id', user.id).first()
    if (!job) return response.notFound({ error: 'job not found' })

    const body = request.body() as {
      clip_filenames: string[]
      theme_layers: ThemeLayerTemplate[]
      render_options?: { width?: number; height?: number; fps?: number }
    }

    const { clip_filenames, theme_layers, render_options } = body

    if (!clip_filenames?.length || !theme_layers?.length) {
      return response.badRequest({ error: 'clip_filenames and theme_layers required' })
    }

    // Load shared job data once (facecam, dominant_color, chat)
    const shared = await loadJobSharedData(jobId, clip_filenames[0])

    const isBatch = clip_filenames.length > 1
    const batchGroupId = isBatch ? randomUUID() : null
    const renderIds: string[] = []

    // Get clip names from hot_points for display
    const hotPoints: any[] = typeof job.hot_points === 'string' ? JSON.parse(job.hot_points) : (job.hot_points ?? [])

    for (const clipFilename of clip_filenames) {
      const renderId = randomUUID()
      renderIds.push(renderId)

      // Find clip name from hot_points
      const hp = hotPoints.find((h: any) => h.clip_filename === clipFilename)
      const clipName = hp?.clip_name ?? null

      const now = new Date().toISOString()
      await db.table('renders').insert({
        id: renderId,
        job_id: jobId,
        clip_filename: clipFilename,
        clip_name: clipName,
        status: 'pending',
        progress: 0,
        user_id: user.id,
        batch_group_id: batchGroupId,
        created_at: now,
        updated_at: now,
      })

      // Enqueue render — resolves edit env + theme per clip then renders
      enqueueRender(async () => {
        const outputFilename = `render_${renderId}.mp4`
        const outputPath = path.join(CLIPS_BASE, jobId, outputFilename)

        try {
          // Mark as rendering
          await db.from('renders').where('id', renderId).update({ status: 'rendering', updated_at: new Date().toISOString() })

          // Resolve clip-specific edit environment
          const env = await resolveEditEnv(jobId, clipFilename, shared)

          // Resolve theme → layers for this clip
          const layers = resolveThemeForClip(theme_layers, env, {
            clipSrc: clipFilename, // placeholder, replaced by presigned URL in remotion_renderer
          })

          await runRender({ renderId, jobId, clipFilename, layers, outputPath, outputFilename, renderOptions: render_options })
        } catch (err: any) {
          console.error(`[BatchRender] Failed for ${clipFilename}:`, err.message)
          await db.from('renders').where('id', renderId).update({
            status: 'error',
            error: err.message,
            updated_at: new Date().toISOString(),
          })
        }
      })
    }

    return response.created({ batch_group_id: batchGroupId, render_ids: renderIds })
  }

  /** GET /api/renders */
  async index({ response, auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const creatorId = request.input('creator_id') ? Number(request.input('creator_id')) : null

    const query = db
      .from('renders')
      .join('jobs', 'renders.job_id', 'jobs.id')
      .select('renders.*', 'jobs.vod_title', 'jobs.vod_game')
      .where('renders.user_id', user.id)

    if (creatorId) {
      query.where('jobs.creator_id', creatorId)
    }

    const rows = await query.orderBy('renders.created_at', 'desc')
    return response.json(rows.map(serializeRender))
  }

  /** GET /api/renders/:renderId */
  async show({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await getRender(params.renderId)
    if (!row || row.user_id !== user.id) return response.notFound({ error: 'render not found' })
    return response.json(serializeRender(row))
  }

  /** DELETE /api/renders/:renderId */
  async destroy({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await getRender(params.renderId)
    if (!row || row.user_id !== user.id) return response.notFound({ error: 'render not found' })

    // Delete S3 object if render was completed
    if (row.output_filename) {
      const s3Key = `renders/${row.job_id}/${row.output_filename}`
      try {
        await deleteObject(s3Key)
      } catch {}
    }

    await db.from('renders').where('id', params.renderId).delete()
    return { success: true }
  }

  /** GET /api/renders/:renderId/download */
  async download({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const row = await getRender(params.renderId)
    if (!row || row.user_id !== user.id || !row.output_filename) {
      return response.notFound({ error: 'render not ready' })
    }

    const downloadName = row.clip_name ? `${row.clip_name}.mp4` : row.output_filename
    const s3Key = `renders/${row.job_id}/${row.output_filename}`
    const presignedUrl = await getPresignedDownloadUrl(s3Key, downloadName)
    return response.redirect(presignedUrl)
  }

  /** GET /api/renders/batch/:batchGroupId/download — ZIP of all completed renders in a batch */
  async batchDownload({ params, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const rows = await db
      .from('renders')
      .where('batch_group_id', params.batchGroupId)
      .where('user_id', user.id)
      .where('status', 'done')
      .whereNotNull('output_filename')

    if (rows.length === 0) {
      return response.notFound({ error: 'no completed renders in this batch' })
    }

    // Fetch presigned URLs for all completed renders
    const files = await Promise.all(
      rows.map(async (row: any) => {
        const s3Key = `renders/${row.job_id}/${row.output_filename}`
        const url = await getPresignedUrl(s3Key, 3600)
        const name = row.clip_name ? `${row.clip_name}.mp4` : row.output_filename
        return { url, name }
      })
    )

    // Stream ZIP response
    response.header('Content-Type', 'application/zip')
    response.header('Content-Disposition', `attachment; filename="batch_export.zip"`)

    const archive = archiver('zip', { zlib: { level: 1 } }) // level 1 = fast (video is already compressed)
    archive.pipe(response.response)

    for (const file of files) {
      const res = await fetch(file.url)
      if (!res.ok) continue
      const buffer = Buffer.from(await res.arrayBuffer())
      archive.append(buffer, { name: file.name })
    }

    await archive.finalize()
  }
}

// ── background render ────────────────────────────────────────────────────────

async function runRender(opts: {
  renderId: string
  jobId: string
  clipFilename: string
  layers: Layer[]
  outputPath: string
  outputFilename: string
  trim?: { start: number; end: number }
  renderOptions?: { width?: number; height?: number; fps?: number }
}) {
  const { renderId, jobId, clipFilename, layers, outputPath, outputFilename, trim, renderOptions } = opts

  const updateRender = async (fields: Record<string, unknown>) => {
    await db.from('renders').where('id', renderId).update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
  }

  try {
    // Mark as rendering (for batch renders that start as 'pending')
    await updateRender({ status: 'rendering' })

    const { sizeMb } = await renderClip({
      renderId,
      layers,
      jobId,
      clipFilename,
      outputPath,
      trim,
      width: renderOptions?.width,
      height: renderOptions?.height,
      fps: renderOptions?.fps,
      onProgress: async (pct) => {
        await updateRender({ progress: pct })
      },
    })

    // Upload render output to S3
    const s3Key = `renders/${jobId}/${outputFilename}`
    await uploadFile(s3Key, outputPath, 'video/mp4')

    // Delete local render file
    try { unlinkSync(outputPath) } catch {}

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
