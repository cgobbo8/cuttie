/**
 * What the AI remembers of the streamer from one live to the next (page « Ma chaîne », « Mémoire »).
 *
 * The notes (notes.ts) are what the streamer writes for the AI. The memory is what the AI writes
 * for itself (backend/app/services/memory.py): once a live is analysed it reads it whole, notes
 * what happened in it, and rewrites what it knows of the streamer. The streamer reads all of it
 * here and may correct it, but it is the AI's to keep.
 *
 *   <data dir>/memory/memory.json         the memory: five sections of short lines (written by the worker, and here when the streamer corrects it)
 *   <data dir>/memory/lives/<job>.json    what was noted of each live read (written by the worker)
 *   <data dir>/memory/proposals.json      corrections of the streamer's notes that wait for their answer (kept here)
 *
 * Reading a live costs about a cent. It happens on its own at the end of an analysis (unless the
 * streamer paused it), and for the lives analysed before only when they ask (`startReading`):
 * nothing is spent after an update without a click.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import Job from '#models/job'
import { DATA_DIR } from '#services/data_paths'
import { MAX_NOTE, readNote, saveNote, type Note } from '#services/notes'
import { WorkerHttpError, WorkerUnavailableError, noteLive } from '#services/worker_client'

/** The sections of the memory, and how long the streamer may make each (the worker keeps its own rewriting shorter) */
export const SECTIONS = ['who', 'games', 'people', 'stories', 'tastes'] as const
export type Section = (typeof SECTIONS)[number]
export const MAX_SECTION = 3000
/** Corrections that wait at most, and how many refused ones are remembered */
const MAX_PENDING = 6
const MAX_IGNORED = 200

export interface Memory {
  sections: Record<Section, string>
  updated_at: string | null
  /** The streamer stopped the AI from reading each live once analysed */
  paused: boolean
}

/** What the AI noted of one live */
export interface LiveEntry {
  job: string
  title: string
  game: string
  /** The day of the live, YYYY-MM-DD */
  date: string
  duration: number
  summary: string
  events: string[]
  people: { name: string; who: string }[]
  said: string[]
  games: string[]
  /** Read from its transcript, or only from what the analysis kept of it */
  source: 'transcript' | 'analysis'
  read_at: string
  cost: number
}

/** A sentence of one of the streamer's notes that the lives contradict, and what to write instead */
export interface Proposal {
  id: string
  note: string
  note_title: string
  before: string
  after: string
  why: string
  /** The live it was seen in, and when */
  job: string
  at: string
}

export const memoryDir = () => path.join(DATA_DIR, 'memory')
const memoryFile = () => path.join(memoryDir(), 'memory.json')
const livesDir = () => path.join(memoryDir(), 'lives')
const proposalsFile = () => path.join(memoryDir(), 'proposals.json')

function load(file: string): Record<string, any> {
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  } catch {
    return {}
  }
}

/** Written beside, then put in place: the worker never reads half a file */
function save(file: string, data: unknown) {
  mkdirSync(path.dirname(file), { recursive: true })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(draft, file)
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')
const strings = (value: unknown, max: number) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()).slice(0, max) : [])

export function readMemory(): Memory {
  const kept = load(memoryFile())
  const sections = kept.sections && typeof kept.sections === 'object' ? kept.sections : {}
  return {
    sections: Object.fromEntries(SECTIONS.map((key) => [key, text(sections[key], MAX_SECTION)])) as Record<Section, string>,
    updated_at: typeof kept.updated_at === 'string' ? kept.updated_at : null,
    paused: kept.paused === true,
  }
}

/** The streamer corrects the memory (the sections they send), or pauses it. What they don't send stays */
export function saveMemory(raw: any): Memory {
  const kept = load(memoryFile())
  const now = readMemory()
  const sections = { ...now.sections }
  let changed = false
  for (const key of SECTIONS) {
    if (typeof raw?.sections?.[key] !== 'string') continue
    const written = text(raw.sections[key], MAX_SECTION)
    changed ||= written !== sections[key]
    sections[key] = written
  }
  const paused = typeof raw?.paused === 'boolean' ? raw.paused : now.paused
  save(memoryFile(), { ...kept, sections, paused, updated_at: changed ? new Date().toISOString() : now.updated_at })
  return readMemory()
}

/** Every live the AI read, the latest first (by the day of the live) */
export function listLives(): LiveEntry[] {
  if (!existsSync(livesDir())) return []
  return readdirSync(livesDir())
    .filter((name) => name.endsWith('.json'))
    .map((name) => load(path.join(livesDir(), name)))
    .filter((e) => typeof e.job === 'string' && typeof e.summary === 'string' && e.summary)
    .map(
      (e): LiveEntry => ({
        job: e.job,
        title: text(e.title, 140),
        game: text(e.game, 80),
        date: text(e.date, 10),
        duration: Number.isFinite(e.duration) ? e.duration : 0,
        summary: text(e.summary, 900),
        events: strings(e.events, 8),
        people: (Array.isArray(e.people) ? e.people : [])
          .filter((p: any) => p && typeof p.name === 'string' && p.name.trim())
          .slice(0, 12)
          .map((p: any) => ({ name: text(p.name, 60), who: text(p.who, 200) })),
        said: strings(e.said, 6),
        games: strings(e.games, 4),
        source: e.source === 'analysis' ? 'analysis' : 'transcript',
        read_at: text(e.read_at, 30),
        cost: Number.isFinite(e.cost) ? e.cost : 0,
      })
    )
    .sort((a, b) => (b.date + b.read_at).localeCompare(a.date + a.read_at))
}

export const wasRead = (jobId: string): boolean => existsSync(path.join(livesDir(), `${jobId}.json`))

/** Everything the AI remembers is thrown away: the memory, the lives it read, the corrections that wait */
export function clearMemory(): void {
  const { paused } = readMemory()
  rmSync(memoryDir(), { recursive: true, force: true })
  // (that the streamer paused it is theirs, not the AI's: it stays)
  if (paused) save(memoryFile(), { paused: true })
}

// ── Corrections proposed for the streamer's notes ───────────────────────────

function readProposals(): { pending: Proposal[]; ignored: string[] } {
  const kept = load(proposalsFile())
  const pending = (Array.isArray(kept.pending) ? kept.pending : []).filter(
    (p: any): p is Proposal => p && [p.id, p.note, p.before, p.after].every((v) => typeof v === 'string' && v)
  )
  return { pending, ignored: strings(kept.ignored, MAX_IGNORED) }
}

/** The corrections that wait for the streamer's answer: those whose note still says what they correct */
export function pendingProposals(): Proposal[] {
  const { pending, ignored } = readProposals()
  const still = pending.filter((p) => readNote(p.note)?.body.includes(p.before))
  if (still.length !== pending.length) save(proposalsFile(), { pending: still, ignored })
  return still
}

/** What the worker proposed after reading a live, kept until the streamer answers. Returns the new ones:
 * a sentence already waiting, or refused once, is not brought up again. */
export function addProposals(found: unknown, jobId: string): Proposal[] {
  const { ignored } = readProposals()
  const pending = pendingProposals()
  const added: Proposal[] = []
  for (const raw of Array.isArray(found) ? found : []) {
    if (pending.length + added.length >= MAX_PENDING) break
    const id = text(raw?.id, 40)
    const note = readNote(text(raw?.note, 60))
    const before = typeof raw?.before === 'string' ? raw.before : ''
    const after = text(raw?.after, 900)
    if (!id || !note || !before || !after || !note.body.includes(before)) continue
    if (ignored.includes(id) || [...pending, ...added].some((p) => p.id === id || (p.note === note.id && p.before === before))) continue
    added.push({ id, note: note.id, note_title: note.title, before, after, why: text(raw?.why, 320), job: jobId, at: new Date().toISOString() })
  }
  if (added.length > 0) save(proposalsFile(), { pending: [...pending, ...added], ignored })
  return added
}

function drop(id: string, refused: boolean) {
  const { pending, ignored } = readProposals()
  save(proposalsFile(), {
    pending: pending.filter((p) => p.id !== id),
    ignored: refused ? [...ignored.filter((other) => other !== id), id].slice(-MAX_IGNORED) : ignored,
  })
}

/**
 * The streamer accepts a correction: their note is changed as proposed. `null`: no such
 * correction; 'changed': the note no longer says that (the correction is dropped).
 */
export function applyProposal(id: string): Note | 'changed' | null {
  const proposal = readProposals().pending.find((p) => p.id === id)
  if (!proposal) return null
  const note = readNote(proposal.note)
  const at = note ? note.body.indexOf(proposal.before) : -1
  if (!note || at < 0) {
    drop(id, false)
    return 'changed'
  }
  const body = (note.body.slice(0, at) + proposal.after + note.body.slice(at + proposal.before.length)).slice(0, MAX_NOTE)
  const saved = saveNote(note.id, { title: note.title, games: note.games, body })
  drop(id, false)
  return saved ?? 'changed'
}

/** The streamer refuses a correction: that sentence is not brought up again */
export function ignoreProposal(id: string): boolean {
  if (!readProposals().pending.some((p) => p.id === id)) return false
  drop(id, true)
  return true
}

// ── Reading lives into the memory ────────────────────────────────────────────

export interface Read {
  entry: LiveEntry
  /** Corrections newly proposed for the notes */
  proposals: Proposal[]
  cost: number
  cached: boolean
}

// One reading of a live at a time (the end of its analysis and a rebuild may meet)
const running = new Map<string, Promise<Read>>()

/** Has the AI read an analysed live into its memory (a live already read answers from the worker's disk) */
export function readLive(jobId: string): Promise<Read> {
  const already = running.get(jobId)
  if (already) return already
  const run = read(jobId).finally(() => running.delete(jobId))
  running.set(jobId, run)
  return run
}

async function read(jobId: string): Promise<Read> {
  const job = await Job.find(jobId)
  if (!job) throw new Error('job not found')
  const answer = await noteLive(jobId, {
    duration: job.vodDurationSeconds ?? 0,
    meta: { streamer: job.streamer, game: job.vodGame, title: job.customTitle || job.vodTitle, date: job.streamDate ?? null },
    // The 50 or so moments the analysis rated, and what it understood of the live
    moments: job.timeline?.candidates ?? [],
    context: job.vodContext && typeof job.vodContext === 'object' ? job.vodContext : null,
  })
  const proposals = addProposals(answer.proposals, jobId)
  if (!answer.cached) {
    // Whoever has this live on screen learns the AI noted it (and may have something to ask about the notes)
    transmit.broadcast(`jobs/${jobId}`, { job_id: jobId, type: 'memory', proposals: proposals.length })
  }
  return { entry: answer.entry, proposals, cost: answer.cost ?? 0, cached: !!answer.cached }
}

/**
 * A live has just been analysed: the AI reads it into its memory, in the background, unless the
 * streamer paused that. Nothing here may fail the analysis: what goes wrong is only written down.
 */
export function afterAnalysis(jobId: string): void {
  if (readMemory().paused) return
  readLive(jobId).then(
    (done) => logger.info(`[${jobId.slice(0, 8)}] live read into the AI's memory (~${done.cost.toFixed(4)} $, ${done.proposals.length} correction(s) proposed for the notes)`),
    (err) => {
      // No engine (tests, the app closing): nothing to say
      if (!(err instanceof WorkerUnavailableError)) logger.warn(`[${jobId.slice(0, 8)}] live not read into the AI's memory: ${err instanceof Error ? err.message : err}`)
    }
  )
}

/** The user's analysed lives the AI has not read yet, the oldest first: the memory is built in the order things happened */
export async function unreadLives(userId: number): Promise<Job[]> {
  const jobs = await Job.query().where('user_id', userId).where('status', 'DONE')
  const day = (job: Job) => String(job.streamDate ?? '') || job.createdAt?.toISO() || ''
  return jobs.filter((job) => !wasRead(job.id)).sort((a, b) => day(a).localeCompare(day(b)))
}

/** About what reading these lives costs, dollars: the transcript read once by a small model, then the memory rewritten.
 * Measured on three lives of 4 h 43 to 6 h 49 (15/11/2026): 0,0016 $ an hour of live to read it, 0,0012 $ to rewrite the memory. */
export function readingCost(jobs: Job[]): number {
  const dollars = jobs.reduce((sum, job) => sum + 0.002 + ((job.vodDurationSeconds ?? 0) / 3600) * 0.0016, 0)
  return jobs.length === 0 ? 0 : Math.max(0.01, Math.round(dollars * 100) / 100)
}

/** The lives analysed before being read one after the other, as the streamer asked */
export interface Reading {
  total: number
  done: number
  /** The live being read */
  title: string
  cost: number
  /** Lives that could not be read (nothing kept of them, a model that failed) */
  failed: number
  stopping: boolean
}

/** How the last rebuild ended (since the app started) */
export interface ReadingResult {
  read: number
  failed: number
  cost: number
  /** What stopped it before the end: no credits, a refused key, the engine away, the streamer */
  stopped?: 'credits' | 'key' | 'unreachable' | 'asked'
  at: string
}

let reading: Reading | null = null
let last: ReadingResult | null = null

export const readingNow = (): Reading | null => (reading ? { ...reading } : null)
export const lastReading = (): ReadingResult | null => last

/** Starts reading the user's unread lives, the oldest first. `null`: there is none; already reading: what it is at */
export async function startReading(userId: number): Promise<Reading | null> {
  if (reading) return readingNow()
  const jobs = await unreadLives(userId)
  if (jobs.length === 0) return null
  reading = { total: jobs.length, done: 0, title: '', cost: 0, failed: 0, stopping: false }
  void readAll(jobs.map((job) => ({ id: job.id, title: job.customTitle || job.vodTitle || '' })))
  return readingNow()
}

/** Asks the rebuild to stop after the live it is reading */
export function stopReading(): boolean {
  if (!reading) return false
  reading.stopping = true
  return true
}

async function readAll(jobs: { id: string; title: string }[]) {
  const state = reading!
  let stopped: ReadingResult['stopped']
  for (const job of jobs) {
    if (state.stopping) {
      stopped = 'asked'
      break
    }
    state.title = job.title
    try {
      state.cost += (await readLive(job.id)).cost
    } catch (err) {
      if (err instanceof WorkerUnavailableError) stopped = 'unreachable'
      else if (err instanceof WorkerHttpError && (err.status === 402 || err.status === 401)) stopped = err.status === 402 ? 'credits' : 'key'
      if (stopped) break
      state.failed += 1
      logger.warn(`[${job.id.slice(0, 8)}] live not read into the AI's memory: ${err instanceof Error ? err.message : err}`)
    }
    state.done += 1
  }
  last = { read: state.done - state.failed, failed: state.failed, cost: Math.round(state.cost * 10000) / 10000, ...(stopped ? { stopped } : {}), at: new Date().toISOString() }
  reading = null
  logger.info(`AI memory rebuilt: ${last.read} live(s) read, ${last.failed} failed, ~${last.cost.toFixed(4)} $${stopped ? `, stopped (${stopped})` : ''}`)
}

/** For the tests: forget what a rebuild left */
export function resetReading() {
  reading = null
  last = null
}
