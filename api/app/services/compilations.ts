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

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
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

const ID = /^[a-z0-9]{6,24}$/
const SOURCES = new Set(['voice', 'chat', 'ai', 'manual'])

/** One of the 7 layouts or a template of the streamer's own ("custom-...") */
const TEMPLATE_KEY = /^[a-z][a-z0-9-]{1,39}$/
export const isTemplateKey = (value: unknown): value is string => typeof value === 'string' && TEMPLATE_KEY.test(value)

export const isPieceId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
export const pieceFile = (id: string) => `piece_${id}.mp4`

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const hundredth = (s: number) => Math.round(s * 100) / 100

function parseItem(raw: any, liveDuration: number): CompilationItem | null {
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
export function parseCompilation(raw: any, liveDuration: number): Omit<Compilation, 'id' | 'created_at' | 'updated_at'> | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sections)) return null
  const seen = new Set<string>()
  const sections: CompilationSection[] = []
  for (const section of raw.sections.slice(0, MAX_SECTIONS)) {
    if (!isPieceId(section?.id) || seen.has(section.id) || !Array.isArray(section.items)) continue
    seen.add(section.id)
    const items: CompilationItem[] = []
    for (const item of section.items.slice(0, MAX_ITEMS)) {
      const parsed = parseItem(item, liveDuration)
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
    sections: c.sections.map((s) => ({ ...s, items: s.items.map((item) => ({ ...item, ...pieceState(jobId, item) })) })),
  }))
}

/** Every file of a piece: its clip, sidecars, frames and backdrop */
export function deletePiece(jobId: string, id: string): void {
  if (!isPieceId(id)) return
  const dir = clipDir(jobId)
  const base = `piece_${id}`
  for (const suffix of ['.mp4', '_meta.json', '_probe.json', '_words.json']) rmSync(path.join(dir, base + suffix), { force: true })
  dropClipCaches(jobId, pieceFile(id))
}

/**
 * Deletes the pieces no compilation uses any more: at once when `now` is
 * true, else only those cut over an hour ago (a search result being previewed
 * has a clip that no compilation holds yet).
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
