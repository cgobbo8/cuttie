import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import Job from '#models/job'
import { dropClipCaches } from '#services/clip_extend'
import {
  MAX_COMPILATIONS,
  deletePiece,
  describeCompilations,
  dropUnusedPieces,
  isPieceId,
  isTemplateKey,
  parseCompilation,
  parseFit,
  pieceState,
  type Compilation,
} from '#services/compilations'
import {
  chooseLooks,
  extractLivePieces,
  liveSearchInfo,
  liveSearchProgress,
  planLiveVideo,
  searchLive,
  type LiveContext,
  type LookTemplate,
} from '#services/worker_client'
import { loadJobSharedData } from '#services/edit_env_resolver'
import { camVisible } from '#services/facecam_resolver'
import { workerFailure } from '#services/worker_failure'

/** Longest description of a video (a real one came to 1300 characters) */
const MAX_BRIEF = 4000

const newId = () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 10)

async function ownJob({ params, auth }: HttpContext): Promise<Job | null> {
  const user = auth.getUserOrFail()
  const job = await Job.find(params.id)
  return job && job.userId === user.id ? job : null
}

/** What the AI works from besides the transcript: the live's length, its voice energy, who and what, where to listen to it */
function liveContext(job: Job): LiveContext {
  return {
    duration: job.vodDurationSeconds ?? 0,
    energy: job.timeline?.energy ?? null,
    meta: { streamer: job.streamer, game: job.vodGame, title: job.customTitle || job.vodTitle },
    url: job.url,
    // The 50 or so candidates the analysis rated, clipped or not: the worker only kept the clipped ones
    moments: job.timeline?.candidates ?? [],
  }
}

/** Pieces being cut, one request at a time per live (two of them would fetch the same part twice) */
const cutting = new Map<string, Promise<unknown>>()
function oneAtATime<T>(jobId: string, work: () => Promise<T>): Promise<T> {
  const run = (cutting.get(jobId) ?? Promise.resolve()).catch(() => {}).then(work)
  cutting.set(jobId, run)
  run.finally(() => cutting.get(jobId) === run && cutting.delete(jobId)).catch(() => {})
  return run
}

export default class CompilationsController {
  // GET /api/jobs/:id/compilations
  async index(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    return { compilations: describeCompilations(job.id, job.compilations ?? []) }
  }

  // POST /api/jobs/:id/compilations { name?, sections?, ... } — a new compilation (empty, or as planned by the AI)
  async store(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const existing = job.compilations ?? []
    if (existing.length >= MAX_COMPILATIONS) return ctx.response.badRequest({ error: 'too many compilations' })

    const body = ctx.request.body()
    const parsed = parseCompilation({ ...body, sections: Array.isArray(body.sections) ? body.sections : [] }, job.vodDurationSeconds ?? 0)
    if (!parsed) return ctx.response.badRequest({ error: 'invalid compilation' })
    if (parsed.sections.length === 0) parsed.sections = [{ id: newId(), title: '', query: '', items: [] }]
    const now = new Date().toISOString()
    const compilation: Compilation = { id: newId(), ...parsed, created_at: now, updated_at: now }
    job.compilations = [...existing, compilation]
    await job.save()
    return ctx.response.created({ compilation: describeCompilations(job.id, [compilation])[0] })
  }

  // PUT /api/jobs/:id/compilations/:compId — the whole compilation as the app has it (sections, items, look)
  async update(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const existing = job.compilations ?? []
    const index = existing.findIndex((c) => c.id === ctx.params.compId)
    if (index === -1) return ctx.response.notFound({ error: 'compilation not found' })
    const parsed = parseCompilation(ctx.request.body(), job.vodDurationSeconds ?? 0)
    if (!parsed) return ctx.response.badRequest({ error: 'invalid compilation' })

    const compilation: Compilation = { ...existing[index], ...parsed, updated_at: new Date().toISOString() }
    job.compilations = existing.map((c, i) => (i === index ? compilation : c))
    await job.save()
    // Clips of the moments taken out (and of previews nobody added): gone after a while
    dropUnusedPieces(job.id, job.compilations)
    return { compilation: describeCompilations(job.id, [compilation])[0] }
  }

  // DELETE /api/jobs/:id/compilations/:compId — its exports stay
  async destroy(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const existing = job.compilations ?? []
    const gone = existing.find((c) => c.id === ctx.params.compId)
    if (!gone) return ctx.response.notFound({ error: 'compilation not found' })
    job.compilations = existing.filter((c) => c !== gone)
    await job.save()
    for (const item of gone.sections.flatMap((s) => s.items)) deletePiece(job.id, item.id)
    return { success: true }
  }

  /**
   * POST /api/jobs/:id/pieces { pieces: [{ id, start, end, fit? }] } — makes sure each
   * moment (live seconds) has its clip, cut from the live with room around it.
   * Answers each piece's clip and where it sits in the live. A piece sent with
   * `fit` (the lines of the live's transcript it is made of, their times rough)
   * also gets `tight`: where those words are really said, null when they are
   * not found in the clip.
   */
  async pieces(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const raw = ctx.request.input('pieces')
    const wanted: { id: string; start: number; end: number; fit?: [number, number] }[] = []
    for (const piece of Array.isArray(raw) ? raw.slice(0, 60) : []) {
      const start = Number(piece?.start)
      const end = Number(piece?.end)
      if (isPieceId(piece?.id) && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 0.3 && end - start <= 180) {
        const fit = parseFit(piece.fit)
        wanted.push({ id: piece.id, start, end, ...(fit ? { fit } : {}) })
      }
    }
    if (wanted.length === 0) return ctx.response.badRequest({ error: 'pieces: [{ id, start, end }] required' })

    try {
      const tight = new Map<string, [number, number] | null>()
      const failed = await oneAtATime(job.id, async () => {
        // Those to cut, and those already cut whose words are to be found
        const todo = wanted.filter((piece) => piece.fit || !pieceState(job.id, piece).ready)
        if (todo.length === 0) return []
        const fresh = new Set(todo.filter((piece) => !pieceState(job.id, piece).ready).map((piece) => piece.id))
        // The worker cuts each clip a little wider than its moment
        const result = await extractLivePieces(job.id, job.url, todo)
        for (const piece of result.pieces) {
          // A clip cut again over another part of the live: its frames and backdrop no longer match
          if (fresh.has(piece.id)) dropClipCaches(job.id, piece.file)
          if (piece.tight !== undefined) tight.set(piece.id, parseFit(piece.tight))
        }
        return result.failed
      })
      return {
        pieces: wanted.map((piece) => ({
          id: piece.id,
          ...pieceState(job.id, piece),
          ...(piece.fit && tight.has(piece.id) ? { tight: tight.get(piece.id) } : {}),
        })),
        failed,
      }
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // GET /api/jobs/:id/search/info — what can be searched in this live, and what asking the AI costs
  async searchInfo(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    try {
      return await liveSearchInfo(job.id, job.vodDurationSeconds ?? 0)
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // POST /api/jobs/:id/looks { items: [{ id, start, end, text }], templates: [{ key, name, description, needs_cam }], wish?, usual?, language? }
  // — the AI looks at each passage (its clip must be cut) and chooses its template
  async looks(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const templates: LookTemplate[] = []
    for (const raw of Array.isArray(ctx.request.input('templates')) ? ctx.request.input('templates').slice(0, 40) : []) {
      const description = typeof raw?.description === 'string' ? raw.description.trim().slice(0, 3000) : ''
      if (!isTemplateKey(raw?.key) || !description || templates.some((t) => t.key === raw.key)) continue
      templates.push({ key: raw.key, name: String(raw.name ?? '').trim().slice(0, 60) || raw.key, description, needs_cam: raw.needs_cam === true })
    }
    const items: { id: string; start: number; end: number; text: string }[] = []
    for (const raw of Array.isArray(ctx.request.input('items')) ? ctx.request.input('items').slice(0, 120) : []) {
      const start = Number(raw?.start)
      const end = Number(raw?.end)
      if (!isPieceId(raw?.id) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || items.some((i) => i.id === raw.id)) continue
      items.push({ id: raw.id, start, end, text: typeof raw.text === 'string' ? raw.text.slice(0, 300) : '' })
    }
    if (templates.length === 0 || items.length === 0) {
      return ctx.response.badRequest({ error: 'items: [{ id, start, end }] and templates: [{ key, description }] required' })
    }
    // Only passages whose clip is there can be looked at
    const ready = items.map((item) => ({ item, piece: pieceState(job.id, item) })).filter(({ piece }) => piece.ready && piece.file_start !== null)
    if (ready.length === 0) return ctx.response.conflict({ error: 'not_cut' })

    // Where the webcam is in this live, and whether someone is in it during each passage. When that
    // can't be told, the AI goes by the frames alone (a template without its webcam falls back by itself)
    const shared = await loadJobSharedData(job.id, ready[0].piece.file).catch((err) => {
      logger.warn({ err }, 'Webcam of live %s not resolved for the looks', job.id)
      return null
    })
    const rect = shared?.facecam.rect ?? null
    try {
      const pieces = ready.map(({ item, piece }) => {
        const part: [number, number] = [item.start - piece.file_start!, item.end - piece.file_start!]
        return {
          id: item.id,
          file: piece.file,
          start: part[0],
          end: part[1],
          text: item.text,
          cam: shared ? camVisible(rect, shared.people?.[piece.file], shared.checked?.[piece.file], part) : true,
        }
      })
      const language = ['fr', 'en', 'es'].includes(ctx.request.input('language')) ? ctx.request.input('language') : 'fr'
      return await chooseLooks(job.id, {
        pieces,
        templates,
        wish: String(ctx.request.input('wish') ?? '').trim().slice(0, 600),
        cam: rect && shared ? { ...rect, frame_w: shared.clipWidth, frame_h: shared.clipHeight } : null,
        language,
        usual: isTemplateKey(ctx.request.input('usual')) ? ctx.request.input('usual') : null,
      })
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // GET /api/jobs/:id/search/progress — what the AI searching this live is doing right now
  async searchProgress(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    try {
      return await liveSearchProgress(job.id)
    } catch {
      // Only for show: the search itself says what went wrong
      return { doing: null }
    }
  }

  // POST /api/jobs/:id/search { query, mode: "words" | "ai" } — moments of the live that match
  async search(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const query = String(ctx.request.input('query') ?? '').trim().slice(0, 300)
    if (!query) return ctx.response.badRequest({ error: 'query required' })
    const mode = ctx.request.input('mode') === 'ai' ? 'ai' : 'words'
    try {
      return await searchLive(job.id, query, mode, liveContext(job))
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // POST /api/jobs/:id/plan { brief, target } — a whole video planned by the AI from a description
  async plan(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const brief = String(ctx.request.input('brief') ?? '').trim().slice(0, MAX_BRIEF)
    if (!brief) return ctx.response.badRequest({ error: 'brief required' })
    const target = Math.min(600, Math.max(10, Number(ctx.request.input('target')) || 90))
    try {
      return await planLiveVideo(job.id, brief, target, liveContext(job))
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }
}
