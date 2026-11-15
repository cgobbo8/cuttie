import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import archiver from 'archiver'
import db from '@adonisjs/lucid/services/db'
import { introSoundFile, renderClip, renderMontage, type MontageIntro, type MontagePiece, type PlacedLayer } from '#services/remotion_renderer'
import { uploadFile, getPresignedDownloadUrl, deleteObject, storagePath } from '#services/storage'
import { clipDir } from '#services/data_paths'
import { introFade, introFrames, isIntro, isIntroSound, isTransition } from '#services/compilations'
import { enqueueRender } from '#services/render_queue'
import { levelSound, type Music } from '#services/sound_level'
import { findMusic, musicFile, parseCurve, trackGain, type MusicCurve } from '#services/musics'
import { loadJobSharedData, resolveEditEnv } from '#services/edit_env_resolver'
import { resolveThemeForClip, type ThemeLayerTemplate } from '#services/theme_resolver'
import type { Layer } from '../../remotion/editorTypes.js'

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

/** Most pieces one montage can have (a 3-minute compilation of 2-second pieces) */
const MAX_PIECES = 120

function parsePlaced(raw: unknown): PlacedLayer[] | null {
  if (!Array.isArray(raw)) return null
  const placed: PlacedLayer[] = []
  for (const item of raw) {
    const layer = (item as any)?.layer
    const z = Number((item as any)?.z)
    if (!layer || typeof layer !== 'object' || !layer.transform || !layer.style || !Number.isFinite(z)) return null
    placed.push({ layer: layer as Layer, z })
  }
  return placed
}

/** The pieces of a montage as sent by the app: [{ clip, from, duration, layers: [{ layer, z }] }] */
function parsePieces(raw: unknown): MontagePiece[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_PIECES) return null
  const pieces: MontagePiece[] = []
  for (const item of raw) {
    const clip = typeof (item as any)?.clip === 'string' ? path.basename((item as any).clip) : ''
    const from = Number((item as any)?.from)
    const duration = Number((item as any)?.duration)
    const layers = parsePlaced((item as any)?.layers)
    if (!clip.endsWith('.mp4') || !Number.isFinite(from) || from < 0 || !Number.isFinite(duration) || duration <= 0 || !layers) return null
    // A piece of another live (a compilation made from several): `job`, checked to be the user's by the caller
    const job = (item as any)?.job
    if (job !== undefined && (typeof job !== 'string' || !/^[0-9a-f-]{36}$/.test(job))) return null
    // The ready-made transition it comes in with: one the renderer knows, or the piece is refused
    const transition = (item as any)?.transition
    if (transition !== undefined && !isTransition(transition)) return null
    pieces.push({ clipFilename: clip, from, duration, layers, ...(job ? { jobId: job } : {}), ...(transition ? { transition } : {}) })
  }
  return pieces
}

const COLOR = /^#[0-9a-f]{3,8}$/i

/**
 * The intro of a montage as sent by the app, with all it draws. Undefined: none was sent;
 * null: what was sent isn't an intro this server can draw (the export is refused).
 */
function parseMontageIntro(raw: unknown): MontageIntro | null | undefined {
  if (raw === undefined || raw === null) return undefined
  const intro = raw as any
  const words = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
  const colors = intro?.colors
  if (!isIntro(intro?.style) || !colors || !['accent', 'highlight', 'dark', 'light'].every((role) => COLOR.test(colors[role] ?? ''))) return null
  // The logo is fetched by the renderer: a web address, nothing on this machine
  const logo = typeof intro.logo === 'string' && /^https?:\/\//.test(intro.logo) && intro.logo.length <= 600 ? intro.logo : null
  const font = words(intro.font, 80)
  if (!/^[\w\s"',-]*$/.test(font)) return null
  if (intro.sound !== undefined && !isIntroSound(intro.sound)) return null
  // The follow button's two labels, as the app words them
  const follow = Array.isArray(intro.follow) && intro.follow.length === 2 ? intro.follow.map((label: unknown) => words(label, 24)) : null
  if (intro.follow !== undefined && (!follow || !follow.every(Boolean))) return null
  return {
    style: intro.style,
    title: words(intro.title, 120),
    name: words(intro.name, 80),
    logo,
    colors: { accent: colors.accent, highlight: colors.highlight, dark: colors.dark, light: colors.light },
    font,
    ...(follow ? { follow: follow as [string, string] } : {}),
    ...(intro.sound ? { sound: intro.sound } : {}),
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
    const outputPath = path.join(clipDir(jobId), outputFilename)

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

  /**
   * POST /api/jobs/:jobId/montage-render — several pieces one after the other in one video:
   * { key, name, pieces: [{ clip, from, duration, layers: [{ layer, z }] }], overlays: [{ layer, z }] }.
   * `key`: what this export stands for (a clip cut in pieces: its filename; a compilation: comp_<id>.mp4).
   */
  async storeMontage({ params, request, response, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const jobId = params.jobId
    const job = await db.from('jobs').where('id', jobId).where('user_id', user.id).first()
    if (!job) return response.notFound({ error: 'job not found' })

    const body = request.body() as {
      key?: unknown
      name?: unknown
      pieces?: unknown
      overlays?: unknown
      intro?: unknown
      music?: unknown
      render_options?: { width?: number; height?: number; fps?: number }
    }
    const pieces = parsePieces(body.pieces)
    const overlays = parsePlaced(body.overlays ?? [])
    if (!pieces || !overlays) {
      return response.badRequest({ error: 'pieces: [{ clip, from, duration, layers }] and overlays: [{ layer, z }] required' })
    }
    const intro = parseMontageIntro(body.intro)
    if (intro === null) return response.badRequest({ error: 'intro: { style, title, name, logo, colors, font, sound? } with a style and a sound this app has' })
    // A music under the whole video: a track of the catalogue whose file is here, and its level over the video
    let music: { track: string; curve: MusicCurve } | undefined
    if (body.music !== undefined && body.music !== null) {
      const asked = body.music as any
      const curve = parseCurve(asked?.curve)
      if (!findMusic(asked?.track) || !curve) return response.badRequest({ error: 'music: { track, curve: { start, ramps: [[at, over, to]] } } with a track this app has' })
      if (!musicFile(asked.track)) return response.status(409).send({ error: 'music_missing', track: asked.track })
      music = { track: asked.track, curve }
    }
    // Pieces of other lives: the user's own only
    const others = [...new Set(pieces.map((piece) => piece.jobId).filter((id): id is string => !!id && id !== jobId))]
    if (others.length > 0) {
      const owned = await db.from('jobs').where('user_id', user.id).whereIn('id', others).select('id')
      if (owned.length !== others.length) return response.notFound({ error: 'job not found' })
    }
    const missing = pieces.find((piece) => !existsSync(path.join(clipDir(piece.jobId ?? jobId), piece.clipFilename)))
    if (missing) return response.notFound({ error: 'clip not found', clip: missing.clipFilename })

    const key = typeof body.key === 'string' && body.key.endsWith('.mp4') ? path.basename(body.key) : pieces[0].clipFilename
    const renderId = randomUUID()
    const outputFilename = `render_${renderId}.mp4`
    const outputPath = path.join(clipDir(jobId), outputFilename)
    const now = new Date().toISOString()
    await db.table('renders').insert({
      id: renderId,
      job_id: jobId,
      clip_filename: key,
      clip_name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null,
      status: 'rendering',
      progress: 0,
      user_id: user.id,
      created_at: now,
      updated_at: now,
    })

    enqueueRender(() =>
      runRender({ renderId, jobId, clipFilename: key, layers: [], outputPath, outputFilename, renderOptions: body.render_options, montage: { pieces, overlays, ...(intro ? { intro } : {}), ...(music ? { music } : {}) } })
    )
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
      console.log(`[BatchRender] Enqueuing ${clipFilename} (render=${renderId})`)
      enqueueRender(async () => {
        const outputFilename = `render_${renderId}.mp4`
        const outputPath = path.join(clipDir(jobId), outputFilename)

        try {
          console.log(`[BatchRender] Starting ${clipFilename}...`)
          // Mark as rendering
          await db.from('renders').where('id', renderId).update({ status: 'rendering', updated_at: new Date().toISOString() })

          // Resolve clip-specific edit environment (triggers Whisper if needed)
          console.log(`[BatchRender] Resolving edit env for ${clipFilename}...`)
          const env = await resolveEditEnv(jobId, clipFilename, shared)
          console.log(`[BatchRender] Edit env resolved: ${env.words.length} words, facecam=${!!env.facecam}`)

          // Warn if theme expects subtitles but transcription produced no words
          const hasSubtitleLayer = theme_layers.some((tl) => tl.type === 'subtitles')
          if (hasSubtitleLayer && env.words.length === 0) {
            console.warn(`[BatchRender] ⚠️ Subtitle layer present but 0 words for ${clipFilename} — subtitles will be empty!`)
          }

          // Resolve theme → layers for this clip
          const layers = resolveThemeForClip(theme_layers, env, {
            clipSrc: clipFilename, // placeholder, replaced by presigned URL in remotion_renderer
          })
          console.log(`[BatchRender] Theme resolved: ${layers.length} layers, rendering...`)

          await runRender({ renderId, jobId, clipFilename, layers, outputPath, outputFilename, renderOptions: render_options })
          console.log(`[BatchRender] Done ${clipFilename}`)
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

    // Delete the output file if render was completed
    if (row.output_filename) {
      const key = `renders/${row.job_id}/${row.output_filename}`
      try {
        await deleteObject(key)
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
    const key = `renders/${row.job_id}/${row.output_filename}`
    const presignedUrl = await getPresignedDownloadUrl(key, downloadName)
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

    const files = rows.map((row: any) => ({
      path: storagePath(`renders/${row.job_id}/${row.output_filename}`),
      name: row.clip_name ? `${row.clip_name}.mp4` : row.output_filename,
    }))

    // Stream ZIP response
    response.header('Content-Type', 'application/zip')
    response.header('Content-Disposition', `attachment; filename="batch_export.zip"`)

    const archive = archiver('zip', { zlib: { level: 1 } }) // level 1 = fast (video is already compressed)
    archive.pipe(response.response)

    for (const file of files) {
      if (existsSync(file.path)) archive.file(file.path, { name: file.name })
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
  /** Several pieces one after the other instead of one clip (`layers` and `trim` unused) */
  montage?: { pieces: MontagePiece[]; overlays: PlacedLayer[]; intro?: MontageIntro; music?: { track: string; curve: MusicCurve } }
}) {
  const { renderId, jobId, clipFilename, layers, outputPath, outputFilename, trim, renderOptions, montage } = opts

  const updateRender = async (fields: Record<string, unknown>) => {
    await db.from('renders').where('id', renderId).update({
      ...fields,
      updated_at: new Date().toISOString(),
    })
  }

  try {
    // Mark as rendering (for batch renders that start as 'pending')
    await updateRender({ status: 'rendering' })

    const output = {
      renderId,
      jobId,
      outputPath,
      width: renderOptions?.width,
      height: renderOptions?.height,
      fps: renderOptions?.fps,
      onProgress: async (pct: number) => {
        await updateRender({ progress: pct })
      },
    }
    const rendered = montage
      ? await renderMontage({ ...output, pieces: montage.pieces, overlays: montage.overlays, intro: montage.intro })
      : await renderClip({ ...output, layers, clipFilename, trim })

    // Its sound at the loudness the platforms play, the cuts between the pieces of a montage smoothed
    // (the picture is copied): a few seconds per minute
    const fps = renderOptions?.fps ?? 30
    const cuts: number[] = []
    // An intro holds the screen first: the first piece's sound starts there, out of nothing
    let frames = montage?.intro ? introFrames(montage.intro.style, fps) : 0
    if (frames > 0) cuts.push(frames / fps)
    for (const piece of (montage?.pieces ?? []).slice(0, -1)) {
      // As the renderer counts them: whole frames, one after the other
      frames += Math.max(1, Math.round(piece.duration * fps))
      cuts.push(frames / fps)
    }
    // The intro's sound goes in once the video's own is levelled: as loud as it was made to be
    const jingle = introSoundFile(montage?.intro?.sound)
    // ...and so does the music under the video: brought to the same level first, then down by its curve
    const track = findMusic(montage?.music?.track)
    const trackFile = musicFile(montage?.music?.track)
    const last = montage?.pieces.at(-1)
    const music: Music | undefined =
      montage?.music && track && trackFile && last
        ? { file: trackFile, from: track.start, gain: trackGain(track), curve: montage.music.curve, seconds: (frames + Math.max(1, Math.round(last.duration * fps))) / fps }
        : undefined
    const levelled = await levelSound(outputPath, cuts, jingle ? { file: jingle, gain: 1, fade: introFade(montage?.intro?.style) ?? undefined } : undefined, music)
    if (levelled) console.log(`[Render] ${outputFilename}: sound brought from ${levelled.from.toFixed(1)} to ${levelled.to.toFixed(1)} LUFS`)
    const sizeMb = levelled ? statSync(outputPath).size / 1024 / 1024 : rendered.sizeMb

    // Move the render output into storage
    await uploadFile(`renders/${jobId}/${outputFilename}`, outputPath, 'video/mp4')

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
