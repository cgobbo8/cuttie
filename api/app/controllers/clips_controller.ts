import type { HttpContext } from '@adonisjs/core/http'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Job from '#models/job'
import { getPresignedUrl, storagePath } from '#services/storage'
import { loadJobSharedData, resolveEditEnv } from '#services/edit_env_resolver'
import { ensureBackground } from '#services/clip_variants'
import logger from '@adonisjs/core/services/logger'
import {
  dropClipCaches,
  planExtend,
  readClipMeta,
  shiftClipClock,
  suggestedCut,
  trimOnFile,
  type Side,
} from '#services/clip_extend'
import { extendClipFile, suggestClipCut, transcribeClipWords } from '#services/worker_client'
import { workerFailure } from '#services/worker_failure'
import { pieceFile } from '#services/compilations'
import { findMedia } from '#services/media_library'
import { envelope, extendPieces } from '#services/clip_pieces'
import { THUMB_WIDTHS, anyThumb, defaultThumbTime, extractFrame, thumbPath } from '#services/clip_thumbs'

// ── Layout constants (mirrors vertical_clipper.py) ───────────────────────────
const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920
const GAME_HEIGHT_RATIO = 0.70
const GAME_MARGIN_BOTTOM = 60
const CAM_SIZE = 560
const CAM_MARGIN_TOP = 40
const CAM_BORDER_RADIUS = 20
const BLUR_SIGMA = 40

async function verifyJobOwnership(jobId: string, auth: HttpContext['auth']) {
  const user = auth.getUserOrFail()
  const job = await Job.find(jobId)
  if (!job || job.userId !== user.id) return null
  return job
}

/** Clips being transcribed because they had no words, one request each ("job/clip") */
const transcribing = new Map<string, Promise<unknown>>()

/** Clips being extracted again, one at a time each ("job/file") */
const extending = new Set<string>()

export default class ClipsController {
  // POST /api/clips/:jobId/:filename/extend { side: "start" | "end" } — 30 s more cut on that side
  async extend({ params, request, response, auth }: HttpContext) {
    const job = await verifyJobOwnership(params.jobId, auth)
    if (!job) return response.notFound({ error: 'clip not found' })
    const filename = path.basename(params.filename)
    const side = request.input('side') as Side
    if (side !== 'start' && side !== 'end') return response.badRequest({ error: 'side must be start or end' })
    const hp = (job.hotPoints ?? []).find((h: any) => h?.clip_filename === filename)
    const meta = readClipMeta(job.id, filename)
    if (!hp || !meta) return response.notFound({ error: 'clip not found' })
    const key = `${job.id}/${filename}`
    if (extending.has(key)) return response.status(423).send({ error: 'already extending' })

    const trim = job.selection?.[filename]?.trim ?? suggestedCut(hp) ?? [0, meta.vod_end - meta.vod_start]
    const plan = planExtend(side, meta.vod_start, meta.vod_end, trim, job.vodDurationSeconds ?? 0)
    if (!plan) return response.conflict({ error: side === 'start' ? 'the live starts here' : 'the live ends here' })

    let done: { vod_start: number; vod_end: number; added_before: number } | null = null
    if (plan.file) {
      extending.add(key)
      try {
        done = await extendClipFile(job.id, filename, { url: job.url, ...plan.file })
      } catch (err) {
        logger.warn({ err }, 'Extending %s failed', key)
        return response.status(502).send({ error: 'the live could not be read' })
      } finally {
        extending.delete(key)
      }
      dropClipCaches(job.id, filename)
    }

    // The streamer may have sorted other clips meanwhile
    await job.refresh()
    if (done) {
      const extended = done
      job.hotPoints = (job.hotPoints ?? []).map((h: any) =>
        h?.clip_filename === filename
          ? { ...shiftClipClock(h, extended.added_before), clip_start: extended.vod_start, clip_end: extended.vod_end }
          : h
      )
    }
    // The file may start a little after what was planned (on a key frame): the cut is counted from there
    const cut = done ? trimOnFile(plan, done.vod_start) : plan.trim
    const choice = { ...(job.selection?.[filename] ?? {}), trim: cut }
    // A clip cut in pieces: its first (or last) piece grows, all of them follow the clip's clock
    if (choice.segments?.length) {
      const pieces = extendPieces(choice.segments, side, cut, done?.added_before ?? 0)
      if (pieces.length > 1) choice.segments = pieces
      else delete choice.segments
      choice.trim = envelope(pieces)
    }
    job.selection = { ...(job.selection ?? {}), [filename]: choice }
    await job.save()
    return { extended: !!done, trim: choice.trim, segments: choice.segments ?? null }
  }

  // GET /api/clips/:jobId/:filename/edit-env
  async editEnv({ params, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }

    const safeFilename = path.basename(params.filename)
    const shared = await loadJobSharedData(safeJobId, safeFilename)
    const env = await resolveEditEnv(safeJobId, safeFilename, shared)

    // Game crop math (mirrors vertical_clipper.py _build_filtergraph)
    const gameH = Math.floor(OUTPUT_HEIGHT * GAME_HEIGHT_RATIO)
    const gameAspect = OUTPUT_WIDTH / gameH
    let cropH = env.clip_height
    let cropW = Math.floor(cropH * gameAspect)
    if (cropW > env.clip_width) {
      cropW = env.clip_width
      cropH = Math.floor(cropW / gameAspect)
    }
    const cropX = Math.floor((env.clip_width - cropW) / 2)
    const cropY = Math.floor((env.clip_height - cropH) / 2)
    const gameY = OUTPUT_HEIGHT - gameH - GAME_MARGIN_BOTTOM

    return response.json({
      clip_width: env.clip_width,
      clip_height: env.clip_height,
      facecam: env.facecam,
      cam: env.cam,
      dominant_color: env.dominant_color,
      game_crop: { x: cropX, y: cropY, w: cropW, h: cropH },
      layout: {
        canvas_w: OUTPUT_WIDTH,
        canvas_h: OUTPUT_HEIGHT,
        game_h: gameH,
        game_y: gameY,
        cam_size: CAM_SIZE,
        cam_margin_top: CAM_MARGIN_TOP,
        cam_border_radius: CAM_BORDER_RADIUS,
        blur_sigma: BLUR_SIGMA,
        game_margin_bottom: GAME_MARGIN_BOTTOM,
      },
      words: env.words,
      chat_messages: env.chat_messages,
      // Where someone shouts in it: the montage's effects bring the webcam closer there
      shouts: env.shouts,
    })
  }

  /**
   * POST /api/clips/:jobId/:filename/suggest-cut { wish?, target?, within?, summary? } — the parts of the clip
   * the AI would keep for a tight video (clip seconds). Nothing is saved: the app
   * shows them as pieces the streamer can change or take back. A clip of the analysis, or the
   * clip of a video's passage (piece_<id>.mp4, a moment of the live or an imported video):
   * `within` is then the part of its file the passage plays, the only one the AI cuts, and
   * `summary` what is said of it (its text).
   */
  async suggestCut({ params, request, response, auth }: HttpContext) {
    const job = await verifyJobOwnership(params.jobId, auth)
    if (!job) return response.notFound({ error: 'clip not found' })
    const filename = path.basename(params.filename)
    const hp = (job.hotPoints ?? []).find((h: any) => h?.clip_filename === filename)
    // The clip of a video's passage (a moment of the live, a video the streamer imported): cut on its words like a clip
    const piece = hp || !/^piece_[a-z0-9]{6,24}\.mp4$/.test(filename) ? null : readClipMeta(job.id, filename)
    if (!hp && !piece) return response.notFound({ error: 'clip not found' })
    const choice = job.selection?.[filename]
    const current: [number, number][] = hp ? (choice?.segments ?? (choice?.trim ? [choice.trim] : suggestedCut(hp) ? [suggestedCut(hp)!] : [])) : []
    // The part of its file a passage plays: the only one to cut (a passage is often a few seconds of a wider clip)
    const sent = request.input('within')
    const [from, to] = Array.isArray(sent) && sent.length === 2 ? sent.map(Number) : [Number.NaN, Number.NaN]
    const within: [number, number] | undefined = piece && Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to - from >= 0.5 ? [from, to] : undefined
    const said = String(request.input('summary') ?? '').trim().slice(0, 300)
    // The length the streamer aims for (seconds); anything else: left to the AI
    const asked = Number(request.input('target'))
    const target = Number.isFinite(asked) && asked >= 10 ? Math.min(180, Math.round(asked)) : undefined
    try {
      const answer = await suggestClipCut(job.id, filename, {
        summary: hp ? [hp.clip_name, hp.llm?.summary].filter(Boolean).join(' — ') : said || (findMedia(piece!.media)?.name ?? ''),
        ...(within ? { within } : {}),
        current,
        wish: String(request.input('wish') ?? '').trim().slice(0, 300),
        ...(target ? { target } : {}),
      })
      // Where the clip's file starts in the live: what places these parts in the live (a video made of the clip is cut there)
      const origin = readClipMeta(job.id, filename)?.vod_start ?? Number((hp as any)?.clip_start)
      return { ...answer, ...(Number.isFinite(origin) ? { origin } : {}) }
    } catch (err) {
      return workerFailure(response, err)
    }
  }

  // GET /api/clips/:jobId/:filename/words — the words said in the clip (clip seconds), when it was transcribed
  async words({ params, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) return response.notFound({ error: 'clip not found' })
    const base = path.basename(params.filename, path.extname(params.filename))
    const file = storagePath(`clips/${safeJobId}/${base}_words.json`)
    let words: unknown = []
    try {
      if (existsSync(file)) words = JSON.parse(readFileSync(file, 'utf-8'))
    } catch {}
    // A clip the analysis never transcribed (one asked for on the stream, added by hand): done now,
    // once (the worker writes the file). Without its words, no "Enlever les silences", no "Montage IA"
    if (!existsSync(file) && existsSync(storagePath(`clips/${safeJobId}/${base}.mp4`))) {
      const key = `${safeJobId}/${base}`
      let pending = transcribing.get(key)
      if (!pending) {
        pending = transcribeClipWords(safeJobId, `${base}.mp4`).finally(() => transcribing.delete(key))
        transcribing.set(key, pending)
      }
      try {
        words = await pending
      } catch (err) {
        logger.warn({ err }, 'Words of %s not transcribed', key)
      }
    }
    return { words: Array.isArray(words) ? words : [] }
  }

  // GET /api/clips/:jobId/:filename/thumb?w=480|1280&t=<seconds>
  async thumb({ params, request, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }
    let safeFilename = path.basename(params.filename)
    // A compilation's export shows its first moment while it renders
    const compId = safeFilename.match(/^comp_([a-z0-9]{6,24})\.mp4$/)?.[1]
    if (compId) {
      const owner = await Job.find(safeJobId)
      const first = owner?.compilations?.find((c) => c.id === compId)?.sections.flatMap((s) => s.items)[0]
      if (!first) return response.notFound({ error: 'clip not found' })
      safeFilename = pieceFile(first.id)
    }
    // Exported videos live next to the clips, under renders/
    const folder = safeFilename.startsWith('render_') ? 'renders' : 'clips'
    if (!safeFilename.endsWith('.mp4')) return response.notFound({ error: 'clip not found' })
    const videoPath = storagePath(`${folder}/${safeJobId}/${safeFilename}`)
    const width = THUMB_WIDTHS.includes(Number(request.input('w'))) ? Number(request.input('w')) : 480
    const requested = Number(request.input('t'))
    const seconds =
      Number.isFinite(requested) && requested >= 0
        ? Math.round(requested * 10) / 10
        : folder === 'renders'
          ? 1.5 // after the widget's entrance
          : defaultThumbTime(safeJobId, safeFilename)
    let thumb = thumbPath(folder, safeJobId, safeFilename, width, seconds)

    if (!existsSync(thumb)) {
      if (!existsSync(videoPath)) {
        // Clips freed to make room: the pictures made before stay
        const kept = anyThumb(folder, safeJobId, safeFilename, width)
        if (!kept) return response.notFound({ error: 'clip not found' })
        thumb = kept
      } else {
        try {
          await extractFrame(videoPath, seconds, width, thumb)
        } catch {
          return response.unprocessableEntity({ error: 'thumbnail failed' })
        }
      }
    }
    response.header('Cache-Control', 'private, max-age=86400')
    return response.download(thumb)
  }

  // GET /api/clips/:jobId/:filename/background — blurred 9:16 backdrop (templates)
  async background({ params, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }
    const safeFilename = path.basename(params.filename)
    if (!safeFilename.endsWith('.mp4') || !existsSync(storagePath(`clips/${safeJobId}/${safeFilename}`))) {
      return response.notFound({ error: 'clip not found' })
    }
    try {
      const key = await ensureBackground(safeJobId, safeFilename)
      return response.redirect(await getPresignedUrl(key))
    } catch {
      return response.unprocessableEntity({ error: 'background failed' })
    }
  }

  // GET /api/clips/:jobId/:filename
  async show({ params, response, auth }: HttpContext) {
    const { jobId, filename } = params
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')

    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }

    const safeFilename = path.basename(filename)

    // Determine S3 key based on filename prefix
    const s3Key = safeFilename.startsWith('render_')
      ? `renders/${safeJobId}/${safeFilename}`
      : `clips/${safeJobId}/${safeFilename}`

    const presignedUrl = await getPresignedUrl(s3Key)
    return response.redirect(presignedUrl)
  }
}
