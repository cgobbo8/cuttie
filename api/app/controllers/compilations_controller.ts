import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import { dropClipCaches } from '#services/clip_extend'
import {
  MAX_COMPILATIONS,
  MAX_LIVES,
  copyPiece,
  deletePiece,
  describeCompilations,
  dropUnusedPieces,
  isJobId,
  isPieceId,
  isTemplateKey,
  itemJob,
  parseCompilation,
  parseFit,
  pieceState,
  summarizeCompilation,
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
  type PlanChange,
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

/** The user's other analysed lives a compilation of `job` may take passages from: those named in `ids` */
async function otherLives(job: Job, ids: unknown): Promise<Job[]> {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => isJobId(id) && id !== job.id))].slice(0, MAX_LIVES - 1) as string[]
  if (wanted.length === 0 || job.userId === null) return []
  const found = await Job.query().where('user_id', job.userId).where('status', 'DONE').whereIn('id', wanted)
  // In the order they were named: the AI numbers the lives in that order
  return wanted.map((id) => found.find((other) => other.id === id)).filter((other): other is Job => !!other)
}

const lengths = (lives: Job[]) => new Map(lives.map((live) => [live.id, live.vodDurationSeconds ?? 0]))

/** Every compilation of the user, wherever it is kept: a piece of a live may be used by a compilation kept with another */
async function everyCompilation(userId: number | null): Promise<Compilation[]> {
  if (userId === null) return []
  const jobs = await Job.query().where('user_id', userId).whereNotNull('compilations')
  return jobs.flatMap((job) => job.compilations ?? [])
}

/** What the AI works from besides the transcript: the live's length, its voice energy, who and what, where to listen to it */
function liveContext(job: Job): LiveContext {
  return {
    duration: job.vodDurationSeconds ?? 0,
    energy: job.timeline?.energy ?? null,
    meta: { streamer: job.streamer, game: job.vodGame, title: job.customTitle || job.vodTitle, date: job.streamDate ?? null },
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
    const others = lengths(await otherLives(job, body.lives))
    const parsed = parseCompilation({ ...body, sections: Array.isArray(body.sections) ? body.sections : [] }, job.vodDurationSeconds ?? 0, others)
    if (!parsed) return ctx.response.badRequest({ error: 'invalid compilation' })
    if (parsed.sections.length === 0) parsed.sections = [{ id: newId(), title: '', query: '', items: [] }]
    const now = new Date().toISOString()
    const compilation: Compilation = { id: newId(), ...parsed, created_at: now, updated_at: now }
    job.compilations = [...existing, compilation]
    await job.save()
    return ctx.response.created({ compilation: describeCompilations(job.id, [compilation])[0] })
  }

  /**
   * GET /api/compilations[?job_id=] — the user's analysed lives, newest first, each with its
   * compilations as cards show them (length, passages, exported or not). A live with none is
   * listed too: a compilation can be started from it.
   */
  async library({ auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const only = request.input('job_id')
    const query = Job.query().where('user_id', user.id).where('status', 'DONE').orderBy('created_at', 'desc')
    if (typeof only === 'string' && only) query.where('id', only)
    const jobs = await query
    // The last finished export of each compilation (its key is comp_<id>.mp4)
    const exported = new Map<string, { id: string; at: string }>()
    if (jobs.length > 0) {
      const rows = await db
        .from('renders')
        .select('id', 'job_id', 'clip_filename', 'updated_at')
        .where('status', 'done')
        .where('clip_filename', 'like', 'comp_%')
        .whereIn('job_id', jobs.map((job) => job.id))
        .orderBy('updated_at', 'asc')
      for (const row of rows) exported.set(`${row.job_id}/${row.clip_filename}`, { id: row.id, at: row.updated_at })
    }
    return {
      lives: jobs.map((job) => ({
        job_id: job.id,
        title: job.customTitle || job.vodTitle || null,
        streamer: job.streamer ?? null,
        game: job.vodGame ?? null,
        duration: job.vodDurationSeconds ?? null,
        stream_date: job.streamDate ?? null,
        created_at: job.createdAt?.toISO() ?? null,
        vod_id: job.url?.match(/videos\/(\d+)/)?.[1] ?? null,
        cover_clip: (job.hotPoints ?? []).find((hp: any) => hp.clip_filename)?.clip_filename ?? null,
        clips_freed: !!job.clipsFreedAt,
        compilations: (job.compilations ?? []).map((c) => {
          const done = exported.get(`${job.id}/comp_${c.id}.mp4`)
          return { ...summarizeCompilation(job.id, c), exported_at: done?.at ?? null, render_id: done?.id ?? null }
        }),
      })),
    }
  }

  // POST /api/jobs/:id/compilations/:compId/duplicate — a copy with clips of its own, to try another version
  async duplicate(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const existing = job.compilations ?? []
    const source = existing.find((c) => c.id === ctx.params.compId)
    if (!source) return ctx.response.notFound({ error: 'compilation not found' })
    if (existing.length >= MAX_COMPILATIONS) return ctx.response.badRequest({ error: 'too many compilations' })

    const now = new Date().toISOString()
    const name = typeof ctx.request.input('name') === 'string' && ctx.request.input('name').trim() ? ctx.request.input('name').trim().slice(0, 80) : source.name
    const copy: Compilation = {
      ...structuredClone(source),
      id: newId(),
      name,
      created_at: now,
      updated_at: now,
      sections: source.sections.map((s) => ({
        ...s,
        id: newId(),
        items: s.items.map((item) => {
          const id = newId()
          copyPiece(itemJob(job.id, item), item.id, id)
          return { ...item, id }
        }),
      })),
    }
    job.compilations = [...existing, copy]
    await job.save()
    return ctx.response.created({ compilation: describeCompilations(job.id, [copy])[0] })
  }

  // PUT /api/jobs/:id/compilations/:compId — the whole compilation as the app has it (sections, items, look)
  async update(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const existing = job.compilations ?? []
    const index = existing.findIndex((c) => c.id === ctx.params.compId)
    if (index === -1) return ctx.response.notFound({ error: 'compilation not found' })
    const others = lengths(await otherLives(job, ctx.request.input('lives')))
    const parsed = parseCompilation(ctx.request.body(), job.vodDurationSeconds ?? 0, others)
    if (!parsed) return ctx.response.badRequest({ error: 'invalid compilation' })

    // `lives` is the whole truth: a compilation that no longer names other lives loses the field
    const { lives: _before, ...kept } = existing[index]
    const compilation: Compilation = { ...kept, ...parsed, updated_at: new Date().toISOString() }
    job.compilations = existing.map((c, i) => (i === index ? compilation : c))
    await job.save()
    // Clips of the moments taken out (and of previews nobody added): gone after a while, in every live it took from
    const all = await everyCompilation(job.userId)
    for (const live of new Set([job.id, ...(existing[index].lives ?? []), ...(compilation.lives ?? [])])) dropUnusedPieces(live, all)
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
    for (const item of gone.sections.flatMap((s) => s.items)) deletePiece(itemJob(job.id, item), item.id)
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
    // A passage of another live says so (`job`): its clip, and who is in the webcam, are that live's
    const others = new Set((await otherLives(job, (Array.isArray(ctx.request.input('items')) ? ctx.request.input('items') : []).map((raw: any) => raw?.job))).map((live) => live.id))
    const items: { id: string; start: number; end: number; text: string; job: string }[] = []
    for (const raw of Array.isArray(ctx.request.input('items')) ? ctx.request.input('items').slice(0, 120) : []) {
      const start = Number(raw?.start)
      const end = Number(raw?.end)
      if (!isPieceId(raw?.id) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || items.some((i) => i.id === raw.id)) continue
      if (raw.job && raw.job !== job.id && !others.has(raw.job)) continue
      items.push({ id: raw.id, start, end, text: typeof raw.text === 'string' ? raw.text.slice(0, 300) : '', job: raw.job && raw.job !== job.id ? raw.job : job.id })
    }
    if (templates.length === 0 || items.length === 0) {
      return ctx.response.badRequest({ error: 'items: [{ id, start, end }] and templates: [{ key, description }] required' })
    }
    // Only passages whose clip is there can be looked at
    const ready = items.map((item) => ({ item, piece: pieceState(item.job, item) })).filter(({ piece }) => piece.ready && piece.file_start !== null)
    if (ready.length === 0) return ctx.response.conflict({ error: 'not_cut' })

    // Where the webcam is in each live, and whether someone is in it during each passage. When that
    // can't be told, the AI goes by the frames alone (a template without its webcam falls back by itself)
    const sharedBy = new Map<string, Awaited<ReturnType<typeof loadJobSharedData>> | null>()
    for (const { item, piece } of ready) {
      if (sharedBy.has(item.job)) continue
      sharedBy.set(
        item.job,
        await loadJobSharedData(item.job, piece.file).catch((err) => {
          logger.warn({ err }, 'Webcam of live %s not resolved for the looks', item.job)
          return null
        })
      )
    }
    // The video's own live says where the webcam is (the first passage's when it has none there)
    const shared = sharedBy.get(job.id) ?? sharedBy.get(ready[0].item.job) ?? null
    const rect = shared?.facecam.rect ?? null
    try {
      const pieces = ready.map(({ item, piece }) => {
        const part: [number, number] = [item.start - piece.file_start!, item.end - piece.file_start!]
        const theirs = sharedBy.get(item.job) ?? null
        return {
          id: item.id,
          file: piece.file,
          start: part[0],
          end: part[1],
          text: item.text,
          cam: theirs ? camVisible(theirs.facecam.rect ?? null, theirs.people?.[piece.file], theirs.checked?.[piece.file], part) : true,
          ...(item.job !== job.id ? { job: item.job } : {}),
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
    // A change asked on a video already planned: { request, current: [{ title, items: [{ start, end }] }], asks }
    const request = String(ctx.request.input('request') ?? '').trim().slice(0, MAX_BRIEF)
    let change: PlanChange | undefined
    if (request) {
      const current: PlanChange['current'] = []
      for (const part of Array.isArray(ctx.request.input('current')) ? ctx.request.input('current').slice(0, 12) : []) {
        const items: { start: number; end: number; job?: string }[] = []
        for (const item of Array.isArray(part?.items) ? part.items.slice(0, 80) : []) {
          const start = Number(item?.start)
          const end = Number(item?.end)
          if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) items.push({ start, end, ...(isJobId(item?.job) && item.job !== job.id ? { job: item.job } : {}) })
        }
        current.push({ title: String(part?.title ?? '').slice(0, 60), items })
      }
      const asks = (Array.isArray(ctx.request.input('asks')) ? ctx.request.input('asks') : [])
        .filter((a: unknown) => typeof a === 'string' && a.trim())
        .slice(-8)
        .map((a: string) => a.trim().slice(0, MAX_BRIEF))
      change = { request, current, asks }
    }
    // The video may take passages from other lives too ({ lives: [job ids] }): the AI works on all of them at once
    const others = await otherLives(job, ctx.request.input('lives'))
    const lives = others.map((live) => {
      const context = liveContext(live)
      return { job_id: live.id, duration: context.duration, url: context.url, moments: context.moments, date: live.streamDate ?? null }
    })
    // A passage of a live that isn't one of them is not told to the AI
    if (change) for (const part of change.current) part.items = part.items.filter((item) => !item.job || others.some((live) => live.id === item.job))
    try {
      return await planLiveVideo(job.id, brief, target, liveContext(job), change, lives)
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }
}
