import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import path from 'node:path'
import db from '@adonisjs/lucid/services/db'
import transmit from '@adonisjs/transmit/services/main'
import Job from '#models/job'
import { getBrandKit } from '#services/brand_kit'
import { MAX_COMPILATIONS, compilationLength, introSeconds, isWaiting, pieceFile, pieceState, preferredIntro, sourceOf, itemJob, type Compilation } from '#services/compilations'
import { DATA_DIR } from '#services/data_paths'
import { dbTime } from '#services/db_time'
import { findMusic } from '#services/musics'
import { liveContext, proposed, waitingCount } from '#services/suggestions'
import { fetchChannel } from '#services/twitch'
import { enqueueJob } from '#services/worker_client'

/**
 * The assistant, on the app's side: the conversation the panel shows (kept on disk, one for
 * the streamer of this machine), and what the assistant asks of the app while it works (the
 * worker runs it: backend/app/services/assistant.py). It reads the streamer's lives, clips and
 * videos here, keeps a clip, starts an analysis once the streamer said yes. What changes a
 * video on screen is not done here: the worker hands it to the page (see the panel).
 */

/* ── The conversation ─────────────────────────────────────── */

export type AssistantBlock = { type: 'text'; text: string } | { type: 'widget'; kind: string; items: Record<string, unknown>[] }

/** Something the assistant waits for: an action the page carries out, or a yes of the streamer */
export interface AssistantAction {
  call: string
  name: string
  args: Record<string, unknown>
  needs: 'app' | 'approval'
}

export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  at: string
  /** What the streamer said, and where they were in the app when they said it */
  text?: string
  where?: string[]
  /** What the assistant answered: its words, and what it shows (cards) */
  reply?: AssistantBlock[]
  /** What it did to answer, a line each */
  steps?: string[]
  cost?: number
  /** What it is waiting for before going on */
  action?: AssistantAction | null
  /** It could not answer: why (credits, key, unreachable, dev, failed) */
  failed?: string
}

export interface Conversation {
  /** Names the conversation for the worker, which keeps what was said */
  thread: string
  messages: AssistantMessage[]
}

const DIR = path.join(DATA_DIR, 'assistant')
export const assistantDir = () => DIR
const fileOf = (userId: number) => path.join(DIR, `conversation_${userId}.json`)
/** The panel shows the last messages; the worker keeps its own record of the whole conversation */
const KEPT_MESSAGES = 120

const newThread = () => `t_${randomBytes(12).toString('base64url')}`
export const newMessageId = () => randomBytes(6).toString('base64url')

export function readConversation(userId: number): Conversation {
  try {
    const read = JSON.parse(readFileSync(fileOf(userId), 'utf-8'))
    if (typeof read?.thread === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(read.thread) && Array.isArray(read.messages)) return { thread: read.thread, messages: read.messages }
  } catch {
    // None yet (or unreadable): a new one
  }
  return { thread: newThread(), messages: [] }
}

export function saveConversation(userId: number, conversation: Conversation): void {
  mkdirSync(DIR, { recursive: true })
  const kept = { thread: conversation.thread, messages: conversation.messages.slice(-KEPT_MESSAGES) }
  // (written beside, then put in its place: never half a file)
  const file = fileOf(userId)
  writeFileSync(`${file}.tmp`, JSON.stringify(kept))
  renameSync(`${file}.tmp`, file)
}

export function startConversation(userId: number): Conversation {
  const fresh = { thread: newThread(), messages: [] }
  saveConversation(userId, fresh)
  return fresh
}

/* ── Who is asking ────────────────────────────────────────── */

// The worker does not know users: what it asks of the app while it answers is for whoever's
// request it is answering (one streamer on this machine; the local user when nobody is asking).
const asking: number[] = []
// The lives its tools changed on the app's side while it answered (a clip kept, ideas added, an
// analysis started): the page learns it and reads them again
let touched = new Set<string>()

/** A request of `userId` is being answered from now until `done()`, which says what it changed */
export function nowAsking(userId: number): () => string[] {
  if (asking.length === 0) touched = new Set()
  asking.push(userId)
  return () => {
    asking.splice(asking.lastIndexOf(userId), 1)
    return [...touched]
  }
}

/** Whose lives the worker's question is about */
export const asker = (): number | null => asking.at(-1) ?? null

/* ── What the assistant asks of the app ───────────────────── */

const text = (value: unknown, most: number) => (typeof value === 'string' ? value.trim().slice(0, most) : '')
const round = (seconds: number) => Math.round(seconds * 10) / 10

async function ownJob(userId: number, id: unknown): Promise<Job | null> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return null
  return Job.query().where('id', id).where('user_id', userId).first()
}

/** Seconds of video a compilation makes, its opening included */
const videoSeconds = (c: Compilation) => round(compilationLength(c) + introSeconds(c.intro, findMusic(c.music?.track)?.bpm))

/** The videos of the user whose last export is finished: "job/id" */
async function exportedVideos(jobIds: string[]): Promise<Set<string>> {
  const done = new Set<string>()
  if (jobIds.length === 0) return done
  const rows = await db.from('renders').select('job_id', 'clip_filename').where('status', 'done').where('clip_filename', 'like', 'comp_%').whereIn('job_id', jobIds)
  for (const row of rows) {
    const id = String(row.clip_filename).match(/^comp_([a-z0-9]{10})\.mp4$/)?.[1]
    if (id) done.add(`${row.job_id}/${id}`)
  }
  return done
}

const videoRow = (job: Job, c: Compilation, exported: Set<string>) => ({
  id: c.id,
  job: job.id,
  name: c.name,
  source: sourceOf(c),
  seconds: isWaiting(c) ? (c.target ?? 0) : videoSeconds(c),
  passages: c.sections.reduce((sum, s) => sum + s.items.length, 0),
  // An idea of the AI nobody had built, a video in the making, or one whose export is finished
  state: isWaiting(c) ? 'idea' : exported.has(`${job.id}/${c.id}`) ? 'exported' : 'draft',
  ...(c.suggestion ? { score: c.suggestion.score, pitch: c.suggestion.pitch } : {}),
  ...(c.passed ? { passed: true } : {}),
})

const clipRow = (job: Job, hp: any) => {
  const choice = job.selection?.[hp.clip_filename] ?? {}
  const cut = Array.isArray(choice.trim) ? choice.trim : Number.isFinite(hp.llm?.cut_start) && Number.isFinite(hp.llm?.cut_end) ? [hp.llm.cut_start, hp.llm.cut_end] : null
  const whole = Number(hp.clip_end) - Number(hp.clip_start)
  return {
    filename: hp.clip_filename,
    name: hp.clip_name ?? '',
    score: Math.round((hp.final_score ?? hp.score ?? 0) * 100),
    at: Math.round(hp.timestamp_seconds ?? hp.clip_start ?? 0),
    length: round(cut ? cut[1] - cut[0] : Number.isFinite(whole) ? whole : 0),
    seen: hp.llm?.seen || hp.llm?.summary || '',
    tags: Array.isArray(hp.llm?.tags) ? hp.llm.tags : [],
    state: choice.state ?? null,
  }
}

/**
 * One thing the assistant asks of the app, answered as data. An `{ error }` says why it can't
 * be had (the assistant reads it and says so). `userId`: whose lives these are.
 */
export async function assistantTool(userId: number, tool: string, args: Record<string, any>): Promise<unknown> {
  if (tool === 'lives') {
    const jobs = await Job.query().where('user_id', userId).orderBy('created_at', 'desc')
    const rows: Record<string, unknown>[] = jobs.map((job) => ({
      job: job.id,
      analysed: job.status === 'DONE',
      status: job.status,
      title: job.customTitle || job.vodTitle || '',
      date: job.streamDate ?? job.createdAt?.toISO() ?? null,
      game: job.vodGame ?? null,
      seconds: job.vodDurationSeconds ?? null,
      url: job.url,
      ...(job.status === 'DONE' ? { clips: (job.hotPoints ?? []).filter((hp: any) => hp.clip_filename).length, ideas: waitingCount(job.compilations) } : {}),
    }))
    // The channel's lives on Twitch that were never analysed (Twitch away: the analysed ones alone)
    try {
      const kit = await getBrandKit()
      const channel = kit.twitch_login ? await fetchChannel(kit.twitch_login) : null
      for (const vod of channel?.vods ?? []) {
        if (vod.recording || jobs.some((job) => job.url?.includes(`/videos/${vod.id}`))) continue
        rows.push({ analysed: false, title: vod.title, date: vod.published_at ?? null, game: vod.game, seconds: vod.duration_seconds ?? null, url: vod.url, vod: vod.id })
      }
    } catch {
      // (nothing to add)
    }
    rows.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    return { lives: rows }
  }

  if (tool === 'videos') {
    const jobs = args.job ? [await ownJob(userId, args.job)].filter((job): job is Job => !!job) : await Job.query().where('user_id', userId).where('status', 'DONE').orderBy('created_at', 'desc')
    if (args.job && jobs.length === 0) return { error: 'no such live' }
    const exported = await exportedVideos(jobs.map((job) => job.id))
    return { videos: jobs.flatMap((job) => (job.compilations ?? []).map((c) => videoRow(job, c, exported))) }
  }

  if (tool === 'start_analysis') {
    const vod = text(args.vod, 20) || text(args.url, 300).match(/videos\/(\d+)/)?.[1]
    if (!vod || !/^\d{1,20}$/.test(vod)) return { error: 'not a Twitch live: its address is https://www.twitch.tv/videos/<number>' }
    const url = `https://www.twitch.tv/videos/${vod}`
    const known = await Job.query().where('user_id', userId).where('url', 'like', `%/videos/${vod}%`).orderBy('created_at', 'desc').first()
    if (known && known.status !== 'ERROR') return { error: known.status === 'DONE' ? 'this live is already analysed' : 'this live is being analysed', job: known.id }
    const job = await Job.create({ id: randomUUID(), url, status: 'PENDING', userId })
    enqueueJob({ job_id: job.id, url }).catch(async (err) => {
      await Job.query().where('id', job.id).update({ status: 'ERROR', error: err.message, updated_at: dbTime() })
    })
    touched.add(job.id)
    return { ok: true, job: job.id, url }
  }

  // Everything else is about one live of the user's
  const job = await ownJob(userId, args.job)
  if (!job) return { error: 'no such live' }

  if (tool === 'live_meta') {
    if (job.status !== 'DONE') return { error: 'this live is not analysed yet' }
    const context = liveContext(job)
    return { duration: context.duration, url: context.url, game: context.meta.game, title: context.meta.title, streamer: context.meta.streamer, date: context.meta.date, moments: context.moments }
  }

  if (tool === 'clips') {
    return { clips: (job.hotPoints ?? []).filter((hp: any) => hp?.clip_filename).map((hp: any) => clipRow(job, hp)).sort((a: any, b: any) => b.score - a.score) }
  }

  if (tool === 'video') {
    const c = (job.compilations ?? []).find((one) => one.id === args.id)
    if (!c) return { error: 'no such video in this live' }
    return {
      id: c.id,
      name: c.name,
      source: sourceOf(c),
      seconds: videoSeconds(c),
      ...(c.suggestion && isWaiting(c) ? { idea: { pitch: c.suggestion.pitch, moments: c.suggestion.moments, brief: c.brief ?? '', target: c.target } } : {}),
      parts: c.sections.map((s) => ({ title: s.title, passages: s.items.map((item) => ({ id: item.id, start: item.start, end: item.end, text: item.text, ...(item.job ? { job: item.job } : {}) })) })),
      look: {
        universe: c.universe ?? null,
        template: c.template,
        title_style: c.titleStyle ?? null,
        effects: c.effects ?? 'none',
        transition: c.transition ?? 'cut',
        opening: !c.intro ? 'none' : c.intro.style === 'hook' ? 'hook' : 'intro',
        intro: c.intro ? (c.intro.style === 'hook' ? (c.intro.look ?? null) : c.intro.style) : null,
        music: c.music?.track ?? null,
        titles: c.titles,
        on_screen_title: c.hook,
      },
    }
  }

  if (tool === 'keep_clip') {
    const clip = path.basename(text(args.clip, 160))
    if (!(job.hotPoints ?? []).some((hp: any) => hp?.clip_filename === clip)) return { error: 'no such clip in this live' }
    const state = args.state === 'kept' || args.state === 'passed' ? args.state : null
    const { state: _before, ...rest } = job.selection?.[clip] ?? {}
    job.selection = { ...(job.selection ?? {}), [clip]: state ? { ...rest, state } : rest }
    await job.save()
    touched.add(job.id)
    return { ok: true, clip, state: state ?? 'none' }
  }

  if (tool === 'ideas') {
    // What the assistant just found looking through the live: kept as videos that wait to be built, like those found once it was analysed
    const existing = job.compilations ?? []
    const known = new Set([...(job.suggestions?.keys ?? []), ...existing.flatMap((c) => (c.suggestion ? [c.suggestion.key] : []))])
    const created = proposed(Array.isArray(args.ideas) ? args.ideas : [], known, MAX_COMPILATIONS - existing.length, preferredIntro(await getBrandKit()) ?? null, undefined, job.vodGame)
    if (created.length > 0) {
      job.compilations = [...existing, ...created]
      job.suggestions = { at: new Date().toISOString(), keys: [...known, ...created.map((c) => c.suggestion!.key)], note: text(args.note, 800) || (job.suggestions?.note ?? '') }
      await job.save()
      touched.add(job.id)
      // Whoever has this live on screen learns it has videos to propose
      transmit.broadcast(`jobs/${job.id}`, { job_id: job.id, type: 'suggestions', count: created.length, suggested: waitingCount(job.compilations) })
    }
    // Every idea it named, new or already proposed, with the video that stands for it
    const all = job.compilations ?? []
    return { videos: all.flatMap((c) => (c.suggestion ? [{ key: c.suggestion.key, id: c.id }] : [])), created: created.length }
  }

  return { error: `unknown tool: ${tool}` }
}

/* ── What the assistant shows ─────────────────────────────── */

/**
 * The cards of an answer, with what the panel needs to draw each: the assistant names a video,
 * a clip or a live; its name, its length and its picture are read here, once, and kept with
 * the conversation.
 */
export async function hydrate(userId: number, reply: unknown): Promise<AssistantBlock[]> {
  const blocks: AssistantBlock[] = []
  const jobs = new Map<string, Job | null>()
  const jobOf = async (id: unknown) => {
    if (typeof id !== 'string') return null
    if (!jobs.has(id)) jobs.set(id, await ownJob(userId, id))
    return jobs.get(id) ?? null
  }
  for (const block of Array.isArray(reply) ? reply : []) {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      blocks.push({ type: 'text', text: block.text.slice(0, 6000) })
      continue
    }
    if (block?.type !== 'widget' || typeof block.kind !== 'string' || !Array.isArray(block.items)) continue
    const items: Record<string, unknown>[] = []
    for (const item of block.items.slice(0, 24)) {
      if (!item || typeof item !== 'object') continue
      const job = await jobOf(item.job)
      if (block.kind === 'videos') {
        const c = job?.compilations?.find((one) => one.id === item.id)
        if (!job || !c) continue
        const cover = c.sections.flatMap((s) => s.items).find((one) => pieceState(itemJob(job.id, one), one).ready)
        items.push({ ...videoRow(job, c, new Set()), ...(cover ? { cover: pieceFile(cover.id), cover_job: itemJob(job.id, cover) } : {}) })
      } else if (block.kind === 'clips') {
        const hp = (job?.hotPoints ?? []).find((one: any) => one?.clip_filename === item.filename)
        if (job && hp) items.push({ job: job.id, ...clipRow(job, hp) })
      } else if (block.kind === 'lives') {
        items.push({
          ...(job ? { job: job.id, analysed: job.status === 'DONE' } : { analysed: false }),
          title: job ? job.customTitle || job.vodTitle || '' : text(item.title, 160),
          date: job ? (job.streamDate ?? null) : (item.date ?? null),
          ...(typeof item.vod === 'string' ? { vod: item.vod } : {}),
          ...(job?.vodGame ? { game: job.vodGame } : {}),
        })
      } else if (block.kind === 'passages') {
        const start = Number(item.start)
        const end = Number(item.end)
        if (!job || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
        items.push({ ...item, job: job.id, start, end, text: text(item.text, 400), vod_id: job.url?.match(/videos\/(\d+)/)?.[1] ?? null })
      }
    }
    if (items.length > 0) blocks.push({ type: 'widget', kind: block.kind, items })
  }
  return blocks
}
