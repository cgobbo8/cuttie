import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import Job from '#models/job'
import { dropClipCaches } from '#services/clip_extend'
import {
  MAX_COMPILATIONS,
  deletePiece,
  describeCompilations,
  dropUnusedPieces,
  isPieceId,
  parseCompilation,
  pieceState,
  type Compilation,
} from '#services/compilations'
import { extractLivePieces, liveSearchInfo, planLiveVideo, searchLive, type LiveContext } from '#services/worker_client'
import { workerFailure } from '#services/worker_failure'

const newId = () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 10)

async function ownJob({ params, auth }: HttpContext): Promise<Job | null> {
  const user = auth.getUserOrFail()
  const job = await Job.find(params.id)
  return job && job.userId === user.id ? job : null
}

/** What the AI reads besides the transcript: the live's length, its voice energy, who and what */
function liveContext(job: Job): LiveContext {
  return {
    duration: job.vodDurationSeconds ?? 0,
    energy: job.timeline?.energy ?? null,
    meta: { streamer: job.streamer, game: job.vodGame, title: job.customTitle || job.vodTitle },
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
   * POST /api/jobs/:id/pieces { pieces: [{ id, start, end }] } — makes sure each
   * moment (live seconds) has its clip, cut from the live with room around it.
   * Answers each piece's clip and where it sits in the live.
   */
  async pieces(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const raw = ctx.request.input('pieces')
    const wanted: { id: string; start: number; end: number }[] = []
    for (const piece of Array.isArray(raw) ? raw.slice(0, 60) : []) {
      const start = Number(piece?.start)
      const end = Number(piece?.end)
      if (isPieceId(piece?.id) && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end - start >= 0.3 && end - start <= 180) {
        wanted.push({ id: piece.id, start, end })
      }
    }
    if (wanted.length === 0) return ctx.response.badRequest({ error: 'pieces: [{ id, start, end }] required' })

    try {
      const failed = await oneAtATime(job.id, async () => {
        const todo = wanted.filter((piece) => !pieceState(job.id, piece).ready)
        if (todo.length === 0) return []
        // The worker cuts each clip a little wider than its moment
        const result = await extractLivePieces(job.id, job.url, todo)
        // A clip cut again over another part of the live: its frames and backdrop no longer match
        for (const piece of result.pieces) dropClipCaches(job.id, piece.file)
        return result.failed
      })
      return {
        pieces: wanted.map((piece) => ({ id: piece.id, ...pieceState(job.id, piece) })),
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
    const brief = String(ctx.request.input('brief') ?? '').trim().slice(0, 1500)
    if (!brief) return ctx.response.badRequest({ error: 'brief required' })
    const target = Math.min(600, Math.max(10, Number(ctx.request.input('target')) || 90))
    try {
      return await planLiveVideo(job.id, brief, target, liveContext(job))
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }
}
