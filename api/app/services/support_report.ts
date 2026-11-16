/**
 * What whoever helps from afar needs to know of a live beyond its analysis, for the journal
 * export: how its transcript is cut into lines, and what its compilations hold.
 *
 * The AI that searches a live picks passages by lines of its transcript. A streamer once got
 * videos of two 40-second passages where the same request gave a dozen of 4 seconds elsewhere:
 * his computer (NVIDIA card, app up to 0.2.5) had transcribed the live in half-minute lines.
 * Nothing in the export said so. These two summaries do.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Compilation } from '#services/compilations'
import { TRANSCRIPTS_DIR } from '#services/data_paths'

/** A line that is half a minute of talk rather than a sentence (the worker's own numbers: vod_transcript.py) */
const LONG_SECONDS = 15
const LONG_WORDS = 25

export interface TranscriptShape {
  /** 10-minute chunks on disk */
  chunks: number
  lines: number
  dated_words: number
  /** What a line lasts, seconds: a sentence is 2 or 3, a half-minute line is the problem */
  median_seconds: number
  longest_seconds: number
  /** Share of the words said that sit in lines too long to be a sentence (0-1) */
  long_share: number
  /** The live was transcribed again by this computer because its lines were half minutes */
  relistened: boolean
}

/** How the live's transcript is cut, null when it was never transcribed (or its transcript is gone) */
export function transcriptShape(jobId: string): TranscriptShape | null {
  const folder = path.join(TRANSCRIPTS_DIR, jobId)
  let names: string[]
  try {
    names = readdirSync(folder).filter((name) => /^chunk_\d+\.json$/.test(name))
  } catch {
    return null
  }
  const lasts: number[] = []
  let chunks = 0
  let words = 0
  let said = 0
  let long = 0
  for (const name of names) {
    let chunk: { segments?: unknown; words?: unknown }
    try {
      chunk = JSON.parse(readFileSync(path.join(folder, name), 'utf-8'))
    } catch {
      continue
    }
    chunks++
    words += Array.isArray(chunk.words) ? chunk.words.length : 0
    for (const line of Array.isArray(chunk.segments) ? chunk.segments : []) {
      if (!Array.isArray(line)) continue
      const seconds = Number(line[1]) - Number(line[0])
      const count = String(line[2] ?? '').split(/\s+/).filter(Boolean).length
      if (!Number.isFinite(seconds)) continue
      lasts.push(seconds)
      said += count
      if (seconds >= LONG_SECONDS && count >= LONG_WORDS) long += count
    }
  }
  if (!lasts.length) return null
  lasts.sort((a, b) => a - b)
  return {
    chunks,
    lines: lasts.length,
    dated_words: words,
    median_seconds: Math.round(lasts[Math.floor(lasts.length / 2)] * 10) / 10,
    longest_seconds: Math.round(lasts[lasts.length - 1] * 10) / 10,
    long_share: said ? Math.round((long / said) * 1000) / 1000 : 0,
    relistened: existsSync(path.join(folder, 'relistened.json')),
  }
}

const short = (text: unknown, length: number) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, length)

/** Each compilation of a live in a few numbers: its parts, what each passage lasts, what was asked of the AI */
export function compilationsReport(compilations: Compilation[] | null | undefined) {
  return (compilations ?? []).map((c) => {
    const items = (c.sections ?? []).flatMap((s) => s.items ?? [])
    const seconds = items.map((item) => Math.round((item.end - item.start) * 10) / 10)
    return {
      id: c.id,
      name: short(c.name, 80),
      updated_at: c.updated_at,
      target_seconds: c.target ?? null,
      parts: (c.sections ?? []).length,
      passages: items.length,
      seconds: Math.round(seconds.reduce((sum, s) => sum + s, 0)),
      // The first 60: a video of 12 passages of 3 seconds reads at a glance, one of 2 of 40 too
      passage_seconds: seconds.slice(0, 60),
      // Still waiting for their clip to be cut on their words
      rough_cuts: items.filter((item) => item.fit).length,
      other_lives: (c.lives ?? []).length,
      proposed_by_ai: !!c.suggestion,
      ...(c.brief ? { brief: short(c.brief, 300) } : {}),
      ...(c.asks?.length ? { asks: c.asks.slice(-20).map((a) => ({ ask: short(a.ask, 160), added: a.added ?? 0, removed: a.removed ?? 0, recut: a.recut ?? 0 })) } : {}),
    }
  })
}
