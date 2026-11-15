/**
 * Compilations: videos made of pieces of the live found by searching it
 * ("every time someone says it's calm", "the moments when it kicks off").
 *
 * A compilation is sections (a title, the search they came from) of items; an
 * item is a moment of the live, [start, end] in live seconds. Each item gets
 * its own small clip cut from the live, piece_<id>.mp4, a little wider than
 * the moment so its cut can move without fetching again; it sits next to the
 * analysis' clips with the same sidecars (place in the live, words, cam), so
 * it edits and exports like any clip.
 */

import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { dropClipCaches, readClipMeta } from '#services/clip_extend'
import { clipDir } from '#services/data_paths'

export interface CompilationItem {
  /** Also names its clip: piece_<id>.mp4 */
  id: string
  /** The moment in the live, seconds */
  start: number
  end: number
  /** What is said there, why it was picked, where it was found ("voice", "chat", "ai") */
  text: string
  why: string
  sources: string[]
  /** Its own template key, when it isn't shown like the rest of the video */
  template?: string
  /**
   * The lines of the live's transcript it is made of (live seconds), while it still has their
   * rough times: once its clip is cut, the moment is set on where those words are really said
   */
  fit?: [number, number]
  /** How well it matches what was asked, when the AI found it (0-1): the weakest go first when a length is to be met */
  score?: number
  /** The live it is cut from, when it isn't the compilation's own (one of its `lives`): its times and its clip are that live's */
  job?: string
  /** How it comes in when that isn't as the rest of the video does: a ready-made transition, or "cut" (none) */
  transition?: string
}

export interface CompilationSection {
  id: string
  /** Shown on screen when the section starts */
  title: string
  /** The search its moments came from */
  query: string
  items: CompilationItem[]
}

export interface Compilation {
  id: string
  name: string
  sections: CompilationSection[]
  /** Template key (null: the channel's default) */
  template: string | null
  /** Each section's title on screen when it starts (else the hook line, once) */
  titles: boolean
  hook: string
  /** Length aimed for, seconds (null: none) */
  target: number | null
  /** The ready-made transition between its passages (absent: plain cuts) */
  transition?: string
  /** Described to the AI: what the streamer first asked for, then each change asked and what the AI answered */
  brief?: string
  asks?: { ask: string; note: string; added?: number; removed?: number; recut?: number }[]
  /** Other lives it takes passages from, besides the one it is kept with (job ids) */
  lives?: string[]
  created_at: string
  updated_at: string
}

/** A preview's clip nobody added is deleted after this long */
const UNUSED_PIECE_MS = 3600_000
export const MAX_COMPILATIONS = 20
const MAX_SECTIONS = 12
const MAX_ITEMS = 80
const MAX_ITEM_SECONDS = 180
const MIN_ITEM_SECONDS = 0.3
/** Longest description of a video, and most changes asked on it that are kept */
const MAX_BRIEF = 4000
const MAX_ASKS = 20

const ID = /^[a-z0-9]{6,24}$/
const SOURCES = new Set(['voice', 'chat', 'ai', 'manual'])

/** One of the 7 layouts or a template of the streamer's own ("custom-...") */
const TEMPLATE_KEY = /^[a-z][a-z0-9-]{1,39}$/
export const isTemplateKey = (value: unknown): value is string => typeof value === 'string' && TEMPLATE_KEY.test(value)

export const isPieceId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)

/** The ready-made transitions between two pieces (drawn by api/remotion/transitions.ts) */
export const TRANSITIONS = ['flash', 'zoom', 'slide', 'swipe', 'shake', 'pop', 'fade']
export const isTransition = (value: unknown): value is string => typeof value === 'string' && TRANSITIONS.includes(value)

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isJobId = (value: unknown): value is string => typeof value === 'string' && JOB_ID.test(value)
/** Lives one compilation can take passages from, its own included */
export const MAX_LIVES = 5
/** The live an item is cut from: the one it names, else the compilation's own */
export const itemJob = (home: string, item: { job?: string }): string => item.job ?? home
export const pieceFile = (id: string) => `piece_${id}.mp4`

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const hundredth = (s: number) => Math.round(s * 100) / 100

function parseItem(raw: any, liveDuration: number, others?: Map<string, number>): CompilationItem | null {
  // From another live: one of the compilation's, with that live's length
  const job = isJobId(raw?.job) && others?.has(raw.job) ? (raw.job as string) : undefined
  if (raw?.job && !job) return null
  if (job) liveDuration = others!.get(job) ?? 0
  const start = Number(raw?.start)
  const end = Number(raw?.end)
  if (!isPieceId(raw?.id) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0) return null
  if (end - start < MIN_ITEM_SECONDS || end - start > MAX_ITEM_SECONDS) return null
  if (liveDuration > 0 && start >= liveDuration) return null
  return {
    id: raw.id,
    start: hundredth(start),
    end: hundredth(liveDuration > 0 ? Math.min(end, liveDuration) : end),
    text: text(raw.text, 300),
    why: text(raw.why, 200),
    sources: Array.isArray(raw.sources) ? raw.sources.filter((s: unknown) => typeof s === 'string' && SOURCES.has(s)) : [],
    ...(isTemplateKey(raw.template) ? { template: raw.template } : {}),
    ...(parseFit(raw.fit) ? { fit: parseFit(raw.fit)! } : {}),
    ...(Number.isFinite(raw.score) && raw.score >= 0 && raw.score <= 1 ? { score: Math.round(raw.score * 100) / 100 } : {}),
    ...(job ? { job } : {}),
    // "cut": a plain cut where the rest of the video has a transition
    ...(isTransition(raw.transition) || raw.transition === 'cut' ? { transition: raw.transition } : {}),
  }
}

/** A stretch of the live's transcript as the app sends it: two seconds in order, null when it isn't one */
export function parseFit(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null
  const [start, end] = raw.map(Number)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > MAX_ITEM_SECONDS) return null
  return [hundredth(start), hundredth(end)]
}

/**
 * A compilation as the app sends it, made safe to store: null when it isn't
 * one. Items that make no sense are dropped, ids appear once.
 */
export function parseCompilation(raw: any, liveDuration: number, others?: Map<string, number>): Omit<Compilation, 'id' | 'created_at' | 'updated_at'> | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return null
  // `others`: the lives it may take passages from besides its own (job id -> length); a passage of any other live is dropped
  const lives = [...new Set<string>((Array.isArray(raw.lives) ? raw.lives : []).filter((id: unknown) => isJobId(id) && others?.has(id as string)))].slice(0, MAX_LIVES - 1)
  const allowed = new Map(lives.map((id) => [id, others!.get(id) ?? 0]))
  const seen = new Set<string>()
  const sections: CompilationSection[] = []
  for (const section of raw.sections.slice(0, MAX_SECTIONS)) {
    if (!isPieceId(section?.id) || seen.has(section.id) || !Array.isArray(section.items)) continue
    seen.add(section.id)
    const items: CompilationItem[] = []
    for (const item of section.items.slice(0, MAX_ITEMS)) {
      const parsed = parseItem(item, liveDuration, allowed)
      if (!parsed || seen.has(parsed.id)) continue
      seen.add(parsed.id)
      items.push(parsed)
    }
    sections.push({ id: section.id, title: text(section.title, 60), query: text(section.query, 300), items })
  }
  const target = Number(raw.target)
  return {
    name: text(raw.name, 80) || 'Compilation',
    sections,
    template: text(raw.template, 60) || null,
    titles: raw.titles !== false,
    hook: text(raw.hook, 120),
    target: Number.isFinite(target) && target >= 5 && target <= 1800 ? Math.round(target) : null,
    ...(isTransition(raw.transition) ? { transition: raw.transition } : {}),
    ...(lives.length > 0 ? { lives } : {}),
    ...(text(raw.brief, MAX_BRIEF) ? { brief: text(raw.brief, MAX_BRIEF) } : {}),
    // What the AI answered to the description: what it built and why
    ...(text(raw.brief, MAX_BRIEF) && text(raw.answer, 800) ? { answer: text(raw.answer, 800) } : {}),
    ...(Array.isArray(raw.asks) && text(raw.brief, MAX_BRIEF)
      ? {
          asks: raw.asks
            .filter((a: any) => text(a?.ask, MAX_BRIEF))
            .slice(-MAX_ASKS)
            .map((a: any) => ({
              ask: text(a.ask, MAX_BRIEF),
              note: text(a.note, 500),
              // How many passages the change added and took out (shown with the AI's answer)
              ...(Number.isInteger(a.added) && a.added > 0 && a.added <= MAX_ITEMS ? { added: a.added } : {}),
              ...(Number.isInteger(a.removed) && a.removed > 0 && a.removed <= MAX_ITEMS ? { removed: a.removed } : {}),
              ...(Number.isInteger(a.recut) && a.recut > 0 && a.recut <= MAX_ITEMS ? { recut: a.recut } : {}),
            })),
        }
      : {}),
  }
}

/** Seconds of video a compilation makes */
export function compilationLength(compilation: Pick<Compilation, 'sections'>): number {
  return compilation.sections.reduce((sum, s) => sum + s.items.reduce((n, item) => n + (item.end - item.start), 0), 0)
}

export interface PieceState {
  /** Its clip is on disk and covers the moment */
  ready: boolean
  file: string
  /** Where the clip sits in the live (null: not cut yet) */
  file_start: number | null
  file_end: number | null
}

/** Where an item's clip stands: there and covering the moment, or still to cut */
export function pieceState(jobId: string, item: Pick<CompilationItem, 'id' | 'start' | 'end'>): PieceState {
  const file = pieceFile(item.id)
  const meta = readClipMeta(jobId, file)
  const onDisk = existsSync(path.join(clipDir(jobId), file))
  const covers = !!meta && meta.vod_start <= item.start + 0.05 && meta.vod_end >= item.end - 0.05
  // A clip cut before files were made to start on their first picture is cut again: its picture
  // could freeze for 2 s and its words were timed that much early
  return { ready: onDisk && covers && meta.settled === true, file, file_start: meta?.vod_start ?? null, file_end: meta?.vod_end ?? null }
}

/** Compilations with each item's clip state, as the app reads them */
export function describeCompilations(jobId: string, compilations: Compilation[]) {
  return compilations.map((c) => ({
    ...c,
    sections: c.sections.map((s) => ({ ...s, items: s.items.map((item) => ({ ...item, ...pieceState(itemJob(jobId, item), item) })) })),
  }))
}

const PIECE_FILES = ['.mp4', '_meta.json', '_probe.json', '_words.json']

/** A piece's clip and sidecars under another id (a duplicated compilation has clips of its own) */
export function copyPiece(jobId: string, from: string, to: string): void {
  if (!isPieceId(from) || !isPieceId(to)) return
  const dir = clipDir(jobId)
  for (const suffix of PIECE_FILES) {
    const source = path.join(dir, `piece_${from}${suffix}`)
    if (existsSync(source)) copyFileSync(source, path.join(dir, `piece_${to}${suffix}`))
  }
}

/** A compilation as a card shows it: how long, how many passages, the clip that stands for it */
export function summarizeCompilation(jobId: string, c: Compilation) {
  const items = c.sections.flatMap((s) => s.items)
  const cover = items.find((item) => pieceState(itemJob(jobId, item), item).ready)
  return {
    id: c.id,
    name: c.name,
    length: Math.round(compilationLength(c) * 10) / 10,
    passages: items.length,
    parts: c.sections.filter((s) => s.items.length > 0).length,
    described: !!c.brief,
    cover: cover ? pieceFile(cover.id) : null,
    // The live that clip is in, the live it is kept with (where it opens, is saved, exported),
    // and every live it takes passages from (that one first)
    cover_job: cover ? itemJob(jobId, cover) : null,
    home: jobId,
    lives: [jobId, ...(c.lives ?? [])],
    created_at: c.created_at,
    updated_at: c.updated_at,
  }
}

/**
 * Compilations once a live is gone (its project deleted): the passages they took from it are
 * dropped, and it is no longer one of their lives. The same array when none took anything from it.
 */
export function withoutLive(compilations: Compilation[], jobId: string): Compilation[] {
  if (!compilations.some((c) => c.lives?.includes(jobId))) return compilations
  return compilations.map((c) => {
    if (!c.lives?.includes(jobId)) return c
    const { lives, ...rest } = c
    const left = lives.filter((id) => id !== jobId)
    return {
      ...rest,
      sections: c.sections.map((s) => ({ ...s, items: s.items.filter((item) => item.job !== jobId) })),
      ...(left.length > 0 ? { lives: left } : {}),
    }
  })
}

/**
 * A compilation whose own live is going away (its project deleted), handed to another of its
 * lives: what it took from the live that goes is dropped, the passages of the one that takes
 * it become its own (their clips are already in that live's folder). Null when nothing of it
 * would be left: it then goes with the project.
 */
export function movedTo(c: Compilation, to: string): Compilation | null {
  if (!c.lives?.includes(to)) return null
  const { lives, ...rest } = c
  const sections = c.sections.map((s) => ({
    ...s,
    items: s.items
      .filter((item) => item.job)
      .map((item) => {
        if (item.job !== to) return item
        const { job: _its, ...own } = item
        return own
      }),
  }))
  if (!sections.some((s) => s.items.length > 0)) return null
  const left = lives.filter((id) => id !== to)
  return { ...rest, sections, ...(left.length > 0 ? { lives: left } : {}) }
}

/** Every file of a piece: its clip, sidecars, frames and backdrop */
export function deletePiece(jobId: string, id: string): void {
  if (!isPieceId(id)) return
  const dir = clipDir(jobId)
  const base = `piece_${id}`
  for (const suffix of PIECE_FILES) rmSync(path.join(dir, base + suffix), { force: true })
  dropClipCaches(jobId, pieceFile(id))
}

/**
 * Deletes the pieces no compilation uses any more: at once when `now` is
 * true, else only those cut over an hour ago (a search result being previewed
 * has a clip that no compilation holds yet). `compilations`: every compilation
 * that may hold a piece of this live, those kept with other lives included.
 */
export function dropUnusedPieces(jobId: string, compilations: Compilation[], now = false): number {
  const dir = clipDir(jobId)
  if (!existsSync(dir)) return 0
  const used = new Set(compilations.flatMap((c) => c.sections.flatMap((s) => s.items.map((item) => pieceFile(item.id)))))
  let dropped = 0
  for (const name of readdirSync(dir)) {
    const id = name.match(/^piece_([a-z0-9]{6,24})\.mp4$/)?.[1]
    if (!id || used.has(name)) continue
    try {
      if (!now && Date.now() - statSync(path.join(dir, name)).mtimeMs < UNUSED_PIECE_MS) continue
    } catch {
      continue
    }
    deletePiece(jobId, id)
    dropped++
  }
  return dropped
}

/** Pieces of every compilation with their place in the live, to cut them again after the clips were freed */
export function piecesToRestore(jobId: string, compilations: Compilation[]): { filename: string; start: number; end: number }[] {
  const pieces: { filename: string; start: number; end: number }[] = []
  for (const item of compilations.flatMap((c) => c.sections.flatMap((s) => s.items))) {
    const meta = readClipMeta(jobId, pieceFile(item.id))
    if (meta) pieces.push({ filename: pieceFile(item.id), start: meta.vod_start, end: meta.vod_end })
  }
  return pieces
}
