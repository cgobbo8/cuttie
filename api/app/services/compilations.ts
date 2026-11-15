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
import { findMusic } from '#services/musics'

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
  /** The AI named it as the moment the video can open on, as a teaser of what is coming */
  opening?: boolean
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
  /** The jingle it opens with (absent: none) */
  intro?: Intro
  /** The music it plays in the background (absent: none): a track of the catalogue, and how present it is (1: as set by the app) */
  music?: { track: string; volume?: number }
  /** Described to the AI: what the streamer first asked for, what the AI answered, then each change asked and its answer */
  brief?: string
  answer?: string
  asks?: { ask: string; note: string; added?: number; removed?: number; recut?: number; remembered?: string[] }[]
  /**
   * The AI proposed this video on its own once the live was analysed (services/suggestions.ts):
   * `brief` is then the request it wrote in the streamer's place. Kept by the server, never
   * taken from what the app sends.
   */
  suggestion?: Suggestion
  /** Other lives it takes passages from, besides the one it is kept with (job ids) */
  lives?: string[]
  created_at: string
  updated_at: string
}

/** What the AI saw in the live that makes a video it proposes */
export interface Suggestion {
  /** Names the idea from one look through the live to the next */
  key: string
  /** One sentence said to the streamer: what it noticed */
  pitch: string
  tags: string[]
  /** The kind of video (see musics.MUSIC_KINDS) */
  kind?: string
  /** 0-100: how well it should do as a short */
  score: number
  /** The moments it spotted for it (live seconds): where the video is built from */
  moments: number[]
}

/** A video the AI proposed that nobody has had built yet: no passage, no answer */
export const isWaiting = (c: Pick<Compilation, 'suggestion' | 'answer' | 'sections'>): boolean =>
  !!c.suggestion && !c.answer && c.sections.every((s) => s.items.length === 0)

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

/** The tastes the AI said it noted from a request, as kept with the turn: a few short sentences */
const remembered = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : [])
    .filter((said): said is string => typeof said === 'string' && !!said.trim())
    .map((said) => said.replace(/\s+/g, ' ').trim().slice(0, 220))
    .slice(0, 3)

const ID = /^[a-z0-9]{6,24}$/
const SOURCES = new Set(['voice', 'chat', 'ai', 'manual'])

/** One of the 7 layouts or a template of the streamer's own ("custom-...") */
const TEMPLATE_KEY = /^[a-z][a-z0-9-]{1,39}$/
export const isTemplateKey = (value: unknown): value is string => typeof value === 'string' && TEMPLATE_KEY.test(value)

export const isPieceId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)

/** The ready-made transitions between two pieces (drawn by api/remotion/transitions.ts) */
export const TRANSITIONS = ['flash', 'zoom', 'slide', 'swipe', 'shake', 'pop', 'fade']
export const isTransition = (value: unknown): value is string => typeof value === 'string' && TRANSITIONS.includes(value)

/**
 * The ready-made intros (drawn by api/remotion/intro): how long each holds the screen before the
 * video starts, then how long it takes to leave over the first piece, in frames at 30 a second.
 * And the sound effects one can play (api/public/sounds/intro-<id>.mp3). "hook" is the odd one:
 * no jingle, a moment of the video plays first, and it holds the screen for as long as that
 * moment lasts (its number here is only what the picker's sketch plays); what frames that moment
 * is one of twelve looks, each named after a jingle.
 */
export const INTROS: Record<string, [number, number]> = {
  hook: [150, 8], slam: [48, 8], bands: [54, 12], glitch: [45, 6], neon: [60, 10], rush: [46, 7], sticker: [54, 10],
  split: [50, 12], arcade: [56, 8], news: [54, 10], shatter: [50, 12], countdown: [60, 8], fuse: [54, 10],
}
export const INTRO_SOUNDS = ['boom', 'swish', 'zap', 'shine', 'rush', 'drum', 'clash', 'coin', 'sting', 'glass', 'beep', 'fizz']
export const isIntro = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(INTROS, value)
export const isIntroSound = (value: unknown): value is string => typeof value === 'string' && INTRO_SOUNDS.includes(value)
/** A jingle: any intro but the hook. It is also what a look of the hook is named after */
export const isJingle = (value: unknown): value is string => isIntro(value) && value !== 'hook'
/** Longest moment a "hook" intro plays, seconds (the app keeps it under 8) */
const HOOK_LONGEST = 8.5

/** The intro a compilation keeps: its style, its own title (else the video's name), its sound (else its style's; "none": silent) */
export interface Intro {
  style: string
  title?: string
  sound?: string
  /** False: without the channel's follow button */
  follow?: boolean
  /**
   * "ai": the AI chose this style (absent: the streamer did, or it is the one they prefer). The AI's next
   * choices stay away from the intros it gave the last videos, never from those the streamer picked.
   */
  by?: 'ai'
  /**
   * The "hook" intro: the moment of the video it plays first, a passage and the part of it that is
   * shown (seconds of that passage's live). `auto`: the app chose it and chooses again when the
   * video changes; without it, the streamer did. The app writes it: the video's length counts it.
   */
  hook?: { item: string; start: number; end: number; auto?: true }
  /** The "hook" intro: the look that frames its moment, by the name of a jingle (absent: the app's default one) */
  look?: string
}

/** The intro a new video opens with when the channel prefers one (its kit): a jingle, or a hook with the look they like */
export function preferredIntro(kit: { intro: string | null; intro_look?: string | null }): Intro | undefined {
  if (!isIntro(kit.intro)) return undefined
  return { style: kit.intro, ...(kit.intro === 'hook' && isJingle(kit.intro_look) ? { look: kit.intro_look } : {}) }
}

/** An intro as the app sends it, null when it isn't one this server can draw */
export function parseIntro(raw: any): Intro | null {
  if (!raw || typeof raw !== 'object' || !isIntro(raw.style)) return null
  const style: string = raw.style
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : ''
  const hook = style === 'hook' ? parseHook(raw.hook) : null
  return {
    style,
    ...(title ? { title } : {}),
    ...(isIntroSound(raw.sound) || raw.sound === 'none' ? { sound: raw.sound } : {}),
    ...(raw.follow === false ? { follow: false } : {}),
    ...(raw.by === 'ai' ? { by: 'ai' as const } : {}),
    ...(hook ? { hook } : {}),
    ...(style === 'hook' && isJingle(raw.look) ? { look: raw.look } : {}),
  }
}

/** The moment of a "hook" intro as the app sends it, null when it isn't one */
function parseHook(raw: any): Intro['hook'] | null {
  const start = Number(raw?.start)
  const end = Number(raw?.end)
  if (!isPieceId(raw?.item) || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > HOOK_LONGEST) return null
  return { item: raw.item, start: hundredth(start), end: hundredth(end), ...(raw.auto === true ? { auto: true as const } : {}) }
}

/** A compilation's music as the app sends it, null when it isn't a track of the catalogue */
export function parseMusic(raw: any): { track: string; volume?: number } | null {
  if (!raw || typeof raw !== 'object' || !findMusic(raw.track)) return null
  const volume = Number(raw.volume)
  return { track: raw.track, ...(Number.isFinite(volume) && volume !== 1 ? { volume: Math.min(2, Math.max(0.3, Math.round(volume * 100) / 100)) } : {}) }
}

/** Frames an intro holds the screen before the first piece, at the video's own rate (0: not an intro) */
export const introFrames = (style: unknown, fps: number): number => (isIntro(style) ? Math.max(1, Math.round((INTROS[style][0] * fps) / 30)) : 0)

/** When an intro's sound fades out, seconds: from where the video starts, for as long as the intro takes to leave and a little more */
export function introFade(style: unknown): { at: number; for: number } | null {
  return isIntro(style) ? { at: INTROS[style][0] / 30, for: (INTROS[style][1] + 24) / 30 } : null
}

/** Seconds an intro adds to the video (a hook: what its moment lasts, nothing while it has none) */
export function introSeconds(intro: Intro | undefined | null): number {
  if (!intro || !isIntro(intro.style)) return 0
  if (intro.style === 'hook') return intro.hook ? Math.max(0, intro.hook.end - intro.hook.start) : 0
  return INTROS[intro.style][0] / 30
}

/**
 * Frames a montage's intro holds the screen before the first piece, at the video's own rate: its
 * style's, or as long as the moment a hook plays (0: no intro, or a hook without its moment).
 */
export function introHoldFrames(intro: { style: string; hook?: { duration: number } } | undefined | null, fps: number): number {
  if (!intro) return 0
  if (intro.style === 'hook') return intro.hook ? Math.max(1, Math.round(intro.hook.duration * fps)) : 0
  return introFrames(intro.style, fps)
}

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
    // The AI named it as the moment the video can open on (what a "hook" intro plays unless the streamer chose another)
    ...(raw.opening === true ? { opening: true } : {}),
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
  // A hook plays one of the video's own passages: the moment of one that is gone is forgotten
  const intro = parseIntro(raw.intro)
  if (intro?.hook && !sections.some((s) => s.items.some((item) => item.id === intro.hook!.item))) delete intro.hook
  return {
    name: text(raw.name, 80) || 'Compilation',
    sections,
    template: text(raw.template, 60) || null,
    titles: raw.titles !== false,
    hook: text(raw.hook, 120),
    target: Number.isFinite(target) && target >= 5 && target <= 1800 ? Math.round(target) : null,
    ...(isTransition(raw.transition) ? { transition: raw.transition } : {}),
    ...(intro ? { intro } : {}),
    ...(parseMusic(raw.music) ? { music: parseMusic(raw.music)! } : {}),
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
              // Lasting tastes stated in the request, that the AI noted in its memory (shown under its answer)
              ...(remembered(a.remembered).length > 0 ? { remembered: remembered(a.remembered) } : {}),
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
    // Its intro is part of the video
    length: Math.round((compilationLength(c) + introSeconds(c.intro)) * 10) / 10,
    passages: items.length,
    parts: c.sections.filter((s) => s.items.length > 0).length,
    described: !!c.brief,
    // Proposed by the AI: what it saw (how many moments, not which), and whether the video still waits to be built
    suggestion: c.suggestion
      ? { pitch: c.suggestion.pitch, tags: c.suggestion.tags, kind: c.suggestion.kind ?? null, score: c.suggestion.score, moments: c.suggestion.moments.length }
      : null,
    waiting: isWaiting(c),
    target: c.target,
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
