import type { HttpContext } from '@adonisjs/core/http'
import { getBrandKit } from '#services/brand_kit'
import { isMusicKind, musicFile, musicTracks } from '#services/musics'
import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import Job from '#models/job'
import path from 'node:path'
import { dropClipCaches, readClipMeta } from '#services/clip_extend'
import {
  MAX_COMPILATIONS,
  MAX_LIVES,
  copyPiece,
  deletePiece,
  describeCompilations,
  dropUnusedPieces,
  isIntro,
  isJingle,
  isTransition,
  preferredIntro,
  isJobId,
  isPieceId,
  isTemplateKey,
  itemJob,
  parseCompilation,
  parseFit,
  pieceState,
  summarizeCompilation,
  type Compilation,
  dressed,
  clipAsPiece,
  isVideoSource,
  type VideoSource,
} from '#services/compilations'
import {
  chooseLooks,
  chooseSound,
  extractLivePieces,
  liveSearchInfo,
  liveSearchProgress,
  planLiveVideo,
  searchLive,
  type PlanChange,
  type LookTemplate,
} from '#services/worker_client'
import { isLooking, liveContext, suggestCompilations, waitingCount } from '#services/suggestions'
import { dropFlats, flatCompilation, flattenCompilation } from '#services/compilation_flat'
import { loadJobSharedData, readJobChat } from '#services/edit_env_resolver'
import { camVisible } from '#services/facecam_resolver'
import { workerFailure } from '#services/worker_failure'

/** Longest description of a video (a real one came to 1300 characters) */
const MAX_BRIEF = 4000

/**
 * What the AI that builds a video is told before the streamer's own words, by what the video is made from.
 * The streamer may only remember roughly (« vers 3 h, il s'est passé ça ») : a time said is where to read first.
 */
const BUILDS: Record<VideoSource, string> = {
  clip:
    '[What is asked for is ONE CLIP: a single moment of the live, 30 to 75 seconds in a row (lines that follow each other, in ONE part, no part title). ' +
    'Give the whole moment in one passage, two when a dead stretch must go: its setup, what happens, the reaction. ' +
    'When the streamer gives a time, even roughly, read around that time first with `read` (a few minutes before and after), then look for what they describe.] ',
  sequence:
    '[What is asked for is ONE SEQUENCE: a stretch of the live in a row where one thing goes on (a mission, a situation that lasts), retold IN ORDER as one short video: ' +
    'its setup first, its turns, its payoff last, nothing taken from elsewhere in the live. When the streamer gives a time, even roughly, start reading there with `read`.] ',
  compilation: '',
}

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
    // The intro the streamer prefers (their brand kit), unless this one comes with its own
    const preferred = preferredIntro(await getBrandKit())
    if (!parsed.intro && preferred) parsed.intro = preferred
    // (a clip is one moment: nothing to announce, it opens on its picture)
    if (parsed.source === 'clip') delete parsed.intro
    // A new video's picture moves a little on what is said, unless it says otherwise (the row « Effets » takes it off)
    if (!parsed.effects && body.effects !== null) parsed.effects = 'light'
    const now = new Date().toISOString()
    // A live on a game that has a look of its own (GTA): the video takes it, the streamer can go back to their channel's
    const compilation: Compilation = { id: newId(), ...dressed(parsed, job.vodGame), created_at: now, updated_at: now }
    job.compilations = [...existing, compilation]
    await job.save()
    return ctx.response.created({ compilation: describeCompilations(job.id, [compilation])[0] })
  }

  /**
   * POST /api/jobs/:id/compilations/from-clip { clip } — a clip of the analysis opened as a video like any
   * other: one passage (the streamer's cut, else the AI's, else the whole clip), its title written on it,
   * the same dressing as a sequence or a compilation. Opened again, the same video comes back.
   */
  async fromClip(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const clip = path.basename(String(ctx.request.input('clip') ?? ''))
    const hp = (job.hotPoints ?? []).find((point: any) => point?.clip_filename === clip) as any
    if (!clip || !hp) return ctx.response.notFound({ error: 'clip not found' })
    const existing = job.compilations ?? []
    const already = existing.find((c) => c.clip === clip)
    if (already) return { compilation: describeCompilations(job.id, [already])[0] }
    if (existing.length >= MAX_COMPILATIONS) return ctx.response.badRequest({ error: 'too many compilations' })

    // Where the clip's file is in the live, and what is kept of it
    const meta = readClipMeta(job.id, clip)
    const fileStart = meta?.vod_start ?? Number(hp.clip_start)
    const fileEnd = meta?.vod_end ?? Number(hp.clip_end)
    if (!Number.isFinite(fileStart) || !Number.isFinite(fileEnd) || fileEnd <= fileStart) return ctx.response.badRequest({ error: 'clip without its place in the live' })
    const trim = job.selection?.[clip]?.trim
    const advised = Number.isFinite(hp.llm?.cut_start) && Number.isFinite(hp.llm?.cut_end) ? [hp.llm.cut_start, hp.llm.cut_end] : null
    const [from, to] = Array.isArray(trim) && trim.length === 2 ? trim : (advised ?? [0, fileEnd - fileStart])
    const start = Math.min(fileEnd - 1, Math.max(fileStart, fileStart + Number(from)))
    const end = Math.min(fileEnd, Math.max(start + 1, fileStart + Number(to)))
    const id = newId()
    // Its file is the clip's own, copied (nothing is fetched from the live again); a clip cut before files said
    // where their first picture is gets cut from the live when the video opens, like any passage
    if (meta?.settled === true) clipAsPiece(job.id, clip, id)
    const parsed = parseCompilation(
      {
        name: String(hp.clip_name || 'Clip').slice(0, 80),
        sections: [{ id: newId(), title: '', query: '', items: [{ id, start, end, text: hp.llm?.transcript ?? '', why: hp.llm?.seen || hp.llm?.summary || '', sources: ['ai'], score: hp.final_score }] }],
        titles: false,
        hook: String(hp.llm?.hook ?? '').slice(0, 80),
        target: null,
        source: 'clip',
        clip,
        effects: 'light',
        // What the analysis saw of it opens the thread with the AI: the clip is changed by asking, like any video
        brief: String(hp.llm?.seen || hp.llm?.summary || hp.clip_name || '').slice(0, 600),
        answer: String(hp.llm?.narrative || '').slice(0, 800),
      },
      job.vodDurationSeconds ?? 0
    )
    if (!parsed || parsed.sections[0]?.items.length !== 1) return ctx.response.badRequest({ error: 'invalid clip' })
    const now = new Date().toISOString()
    const compilation: Compilation = { id: newId(), ...dressed(parsed, job.vodGame), created_at: now, updated_at: now }
    job.compilations = [...existing, compilation]
    await job.save()
    return ctx.response.created({ compilation: describeCompilations(job.id, [compilation])[0] })
  }

  /**
   * GET /api/compilations[?job_id=] — the user's analysed lives, newest first, each with its
   * compilations as cards show them (length, passages, exported or not). A compilation made
   * from several lives is listed with each of them (`home`: the one it is kept with). A live
   * with none is listed too: a compilation can be started from it.
   */
  async library({ auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const only = request.input('job_id')
    // Every live even when one is asked for: its compilations may be kept with another
    const jobs = await Job.query().where('user_id', user.id).where('status', 'DONE').orderBy('created_at', 'desc')
    // The last finished export of each compilation: its key is comp_<id>.mp4, or the clip it was
    // joined into when it was exported from the layer editor (flat_<id>_<signature>.mp4)
    const exported = new Map<string, { id: string; at: string }>()
    if (jobs.length > 0) {
      const rows = await db
        .from('renders')
        .select('id', 'job_id', 'clip_filename', 'updated_at')
        .where('status', 'done')
        .where((q) => q.where('clip_filename', 'like', 'comp_%').orWhere('clip_filename', 'like', 'flat_%'))
        .whereIn('job_id', jobs.map((job) => job.id))
        .orderBy('updated_at', 'asc')
      for (const row of rows) {
        const of = flatCompilation(row.clip_filename) ?? String(row.clip_filename).match(/^comp_([a-z0-9]{10})\.mp4$/)?.[1]
        if (of) exported.set(`${row.job_id}/${of}`, { id: row.id, at: row.updated_at })
      }
    }
    // The same card under each live it takes from: the one that keeps it first, then the others
    const cards = new Map<string, (ReturnType<typeof summarizeCompilation> & { exported_at: string | null; render_id: string | null })[]>(jobs.map((job) => [job.id, []]))
    for (const job of jobs) {
      for (const c of job.compilations ?? []) {
        const done = exported.get(`${job.id}/${c.id}`)
        const card = { ...summarizeCompilation(job.id, c), exported_at: done?.at ?? null, render_id: done?.id ?? null }
        for (const live of new Set(card.lives)) cards.get(live)?.push(card)
      }
    }
    return {
      lives: jobs
        .filter((job) => typeof only !== 'string' || !only || job.id === only)
        .map((job) => ({
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
          // When the AI looked through it for videos to propose (null: never), and whether it is doing so now
          looked_at: job.suggestions?.at ?? null,
          looking: isLooking(job.id),
          compilations: cards.get(job.id) ?? [],
          // The clips the analysis found that were not opened as a video yet: the same card as the rest, the best first
          clips: (job.hotPoints ?? [])
            .filter((hp: any) => hp?.clip_filename && !(job.compilations ?? []).some((c) => c.clip === hp.clip_filename))
            .map((hp: any) => ({
              filename: hp.clip_filename as string,
              name: (hp.clip_name || hp.clip_filename) as string,
              score: Math.round(100 * Number(hp.final_score ?? hp.score ?? 0)),
              at: Number(hp.timestamp_seconds) || 0,
              length: Number.isFinite(hp.llm?.cut_start) && Number.isFinite(hp.llm?.cut_end) ? Math.round(hp.llm.cut_end - hp.llm.cut_start) : Math.round((Number(hp.clip_end) || 0) - (Number(hp.clip_start) || 0)),
              pitch: String(hp.llm?.summary ?? ''),
              seen: String(hp.llm?.seen ?? ''),
              tags: Array.isArray(hp.llm?.tags) ? hp.llm.tags.slice(0, 4) : [],
              category: hp.llm?.category ?? null,
              found_by: hp.found_by || null,
              state: job.selection?.[hp.clip_filename]?.state ?? null,
            }))
            .sort((a: { score: number }, b: { score: number }) => b.score - a.score),
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
    // A copy is the streamer's own video, whoever proposed the one it is made from
    const { suggestion: _proposed, ...own } = structuredClone(source)
    const renamed = new Map<string, string>()
    const copy: Compilation = {
      ...own,
      id: newId(),
      name,
      created_at: now,
      updated_at: now,
      sections: source.sections.map((s) => ({
        ...s,
        id: newId(),
        items: s.items.map((item) => {
          const id = newId()
          renamed.set(item.id, id)
          copyPiece(itemJob(job.id, item), item.id, id)
          return { ...item, id }
        }),
      })),
    }
    // The moment its "hook" intro plays is one of its own passages
    if (copy.intro?.hook) copy.intro.hook.item = renamed.get(copy.intro.hook.item) ?? copy.intro.hook.item
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

    // `lives`, `transition`, `intro`, `music`, `universe` and `titleStyle` are the whole truth: a compilation that no longer names other lives, went back to plain cuts, lost its intro or its music, or went back to the channel's own look loses the field
    const { lives: _before, transition: _was, intro: _opened, music: _played, universe: _dressed, titleStyle: _written, effects: _moved, ...kept } = existing[index]
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
    dropFlats(job.id, gone.id)
    return { success: true }
  }

  /**
   * POST /api/jobs/:id/compilations/:compId/flatten — the compilation as one
   * clip, to open it in the layer editor: its passages joined end to end, with
   * their words and chat (see compilation_flat.ts). 409 when a passage's clip
   * is not cut yet. The same compilation gives the same clip (`fresh`: false).
   */
  async flatten(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const compilation = (job.compilations ?? []).find((c) => c.id === ctx.params.compId)
    if (!compilation) return ctx.response.notFound({ error: 'compilation not found' })
    try {
      const chats = new Map<string, ReturnType<typeof readJobChat>>()
      const flat = await flattenCompilation(job.id, compilation, (live) => chats.get(live) ?? chats.set(live, readJobChat(live)).get(live)!)
      if (!flat) return ctx.response.conflict({ error: 'pieces missing' })
      return flat
    } catch (err: any) {
      logger.error({ err }, 'Compilation %s of job %s not joined into one clip', compilation.id, job.id)
      return ctx.response.internalServerError({ error: 'flatten failed' })
    }
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
  /**
   * POST /api/jobs/:id/sound { title, parts, seconds, passages, said, asked?, language? } — the AI says what kind
   * of video this is and chooses its background music and its intro (either may be none), starting
   * from the streamer's favourites (brand kit). Nothing is saved: the app applies what it gets.
   */
  async sound(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const words = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
    const lines = (value: unknown, count: number, max: number) => (Array.isArray(value) ? value.map((line) => words(line, max)).filter(Boolean).slice(0, count) : [])
    const kit = await getBrandKit()
    // Only the tracks that can be played on this machine
    const musics = musicTracks()
      .filter((track) => musicFile(track.id))
      .map((track) => ({ key: track.id, name: track.name, kinds: track.kinds, about: track.about || track.description || track.genre || track.name }))
    // The intros the AI gave the streamer's last videos, the newest first (the video being decided left out):
    // its choice stays away from them, or every funny video opens the same way. An intro the streamer picked
    // themselves is their taste, not a repetition: it is never one to stay away from
    const deciding = String(ctx.request.input('compilation') ?? '')
    const recent = (await everyCompilation(job.userId))
      .filter((c) => c.id !== deciding && c.intro?.by === 'ai' && c.sections.some((s) => s.items.length > 0))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 6)
      // (what must not be repeated is the graphics: a hook's are its look)
      .map((c) => (c.intro!.style === 'hook' ? (c.intro!.look ?? 'fuse') : c.intro!.style))
    try {
      const chosen = await chooseSound({
        video: {
          title: words(ctx.request.input('title'), 120),
          // The game of the live, when the video is dressed in its look: some graphics are made for one (the GTA pack).
          // A video the streamer put back in their channel's look is not told about them
          game: ctx.request.input('universe') === null ? '' : words(job.vodGame, 80),
          parts: lines(ctx.request.input('parts'), 12, 80),
          seconds: Math.max(0, Math.min(7200, Number(ctx.request.input('seconds')) || 0)),
          passages: Math.max(0, Math.min(500, Math.round(Number(ctx.request.input('passages')) || 0))),
          // (in the video's order: the AI names the one the video could open on by its place in this list)
          said: lines(ctx.request.input('said'), 30, 200),
          // How long each of them lasts, seconds (a hook plays a short passage whole, only the end of a long one)
          lengths: (Array.isArray(ctx.request.input('lengths')) ? ctx.request.input('lengths') : []).slice(0, 30).map((length: unknown) => Math.max(0, Math.min(120, Number(length) || 0))),
        },
        musics,
        favourites: kit.musics,
        intro: kit.intro,
        intro_look: kit.intro_look,
        asked: words(ctx.request.input('asked'), 800),
        language: ['fr', 'en', 'es'].includes(ctx.request.input('language')) ? ctx.request.input('language') : 'fr',
        recent_intros: recent,
      })
      return {
        kind: isMusicKind(chosen.kind) ? chosen.kind : null,
        music: musics.some((track) => track.key === chosen.music) ? chosen.music : null,
        intro: isIntro(chosen.intro) ? chosen.intro : null,
        // A hook: the graphics that frame it
        look: chosen.intro === 'hook' && isJingle(chosen.look) ? chosen.look : null,
        // The passage the video could open on: its place among `said`, from 1 (null: none named)
        teaser: Number.isInteger(chosen.teaser) && (chosen.teaser as number) >= 1 ? chosen.teaser : null,
        // How its passages follow each other ("cut": plainly; null: it did not say)
        transition: chosen.transition === 'cut' || isTransition(chosen.transition) ? chosen.transition : null,
        why: words(chosen.why, 500),
        cost: Number(chosen.cost) || 0,
      }
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

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
      // { fresh: true }: asked again on purpose, the AI searches anew instead of giving the answer it kept
      return await searchLive(job.id, query, mode, liveContext(job), ctx.request.input('fresh') === true)
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // POST /api/jobs/:id/plan { brief, target } — a whole video planned by the AI from a description
  async plan(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    const said = String(ctx.request.input('brief') ?? '').trim().slice(0, MAX_BRIEF)
    if (!said) return ctx.response.badRequest({ error: 'brief required' })
    // What kind of video is asked for: one moment, a stretch in a row, or passages from all over (the AI is told before the streamer's words)
    const source: VideoSource = isVideoSource(ctx.request.input('source')) ? ctx.request.input('source') : 'compilation'
    const brief = (BUILDS[source] + said).slice(0, MAX_BRIEF)
    const target = Math.min(600, Math.max(10, Number(ctx.request.input('target')) || 90))
    // A change asked on a video already planned: { request, current: [{ title, items: [{ start, end }] }], asks }
    const request = String(ctx.request.input('request') ?? '').trim().slice(0, MAX_BRIEF)
    let change: PlanChange | undefined
    if (request) {
      const current: PlanChange['current'] = []
      for (const part of Array.isArray(ctx.request.input('current')) ? ctx.request.input('current').slice(0, 12) : []) {
        const items: PlanChange['current'][number]['items'] = []
        for (const item of Array.isArray(part?.items) ? part.items.slice(0, 80) : []) {
          const start = Number(item?.start)
          const end = Number(item?.end)
          if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start)
            items.push({ start, end, ...(isJobId(item?.job) && item.job !== job.id ? { job: item.job } : {}), ...(item?.opening === true ? { opening: true } : {}) })
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
    // A video the AI proposed ({ leads: [seconds] }): the moments it had spotted for it, where the one that builds it starts
    const leads = (Array.isArray(ctx.request.input('leads')) ? ctx.request.input('leads') : []).filter((at: unknown) => typeof at === 'number' && Number.isFinite(at) && at >= 0).slice(0, 40)
    try {
      // { fresh: true }: the same description asked again on purpose (a change is always asked anew)
      return await planLiveVideo(job.id, brief, target, liveContext(job), change, lives, change ? [] : leads, !change && ctx.request.input('fresh') === true)
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  // GET /api/jobs/:id/suggestions — how many proposed videos wait to be opened, and whether the AI is looking for some right now
  async suggestions(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    return { suggested: waitingCount(job.compilations), looking: isLooking(job.id), looked_at: job.suggestions?.at ?? null }
  }

  /**
   * POST /api/jobs/:id/suggestions — the AI looks through the live for videos to propose
   * (done by itself when an analysis ends; this is for a live analysed before, or to ask
   * again). What it proposes is kept as compilations that wait to be built; an idea already
   * proposed, even deleted since, is not proposed again.
   */
  async suggest(ctx: HttpContext) {
    const job = await ownJob(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    if (job.status !== 'DONE') return ctx.response.conflict({ error: 'the live is not analysed yet' })
    try {
      const done = await suggestCompilations(job.id)
      return { compilations: describeCompilations(job.id, done.created), found: done.found, note: done.note, cost: done.cost, cached: done.cached }
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }
}
