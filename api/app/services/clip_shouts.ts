/**
 * Where someone shouts in a clip: the instants its sound jumps well above its usual level.
 *
 * The montage's effects bring the webcam closer on them (see frontend/src/lib/effects.ts).
 * Nothing is recognised here: ffmpeg reads how loud the clip is ten times a second, and an
 * instant counts when the sound stays for a while both far above the clip's usual level and
 * among its loudest moments. A game's explosion does that too: the app only keeps the instants
 * where a word is being said. Measured once for each clip and kept beside it
 * (`<clip>_shouts.json`).
 */

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** How often the level is read, seconds */
export const SHOUT_STEP = 0.1
/** Under this, nothing is heard (dB) */
const QUIET = -50
/** A shout is this far above the clip's usual level (dB), and within this of its loudest moments */
const OVER = 9
const NEAR_TOP = 6
/** ...for at least this long, and two of them are at least this far apart (readings) */
const LASTS = 3
const APART = 15

export interface Shout {
  /** Seconds from the clip's start */
  at: number
  /** How far above the clip's usual level, dB */
  over: number
}

/** How ffmpeg reads a clip's level every tenth of a second (one line a reading, on its standard output) */
export function levelArgs(file: string): string[] {
  return [
    '-v', 'error', '-nostats',
    '-i', file,
    '-vn',
    // (one channel at 8000 Hz, in the filters themselves: set on the output, the readings would be counted on the clip's own rate)
    '-af', 'aformat=sample_rates=8000:channel_layouts=mono,asetnsamples=n=800:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null', '-',
  ]
}

/** The levels ffmpeg printed, in order, dB (silence: -120) */
export function parseLevels(printed: string): number[] {
  const levels: number[] = []
  for (const found of printed.matchAll(/RMS_level=(-?inf|nan|-?[\d.]+)/g)) {
    const level = Number(found[1])
    levels.push(Number.isFinite(level) ? Math.max(-120, level) : -120)
  }
  return levels
}

/** The shouts in a clip's levels (one every `step` seconds), in order */
export function shoutsIn(levels: number[], step = SHOUT_STEP): Shout[] {
  const heard = levels.filter((level) => level > QUIET).sort((a, b) => a - b)
  if (heard.length < 20) return []
  const usual = heard[Math.floor(heard.length / 2)]
  const top = heard[Math.floor(heard.length * 0.98)]
  const bar = Math.max(usual + OVER, top - NEAR_TOP)
  const shouts: (Shout & { reading: number })[] = []
  let run = 0
  let peak = -120
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && levels[i] >= bar) {
      run++
      peak = Math.max(peak, levels[i])
      continue
    }
    const start = i - run
    // (a second burst right after the first is the same shout)
    if (run >= LASTS && (shouts.length === 0 || start - shouts[shouts.length - 1].reading > APART)) {
      shouts.push({ reading: start, at: Math.round(start * step * 100) / 100, over: Math.round((peak - usual) * 10) / 10 })
    }
    run = 0
    peak = -120
  }
  return shouts.map(({ at, over }) => ({ at, over }))
}

/**
 * The shouts of a clip file, measured once and kept beside it. A clip that is not there (its
 * project's clips were freed) or that cannot be read has none.
 */
export async function clipShouts(file: string): Promise<Shout[]> {
  if (!existsSync(file)) return []
  const kept = path.join(path.dirname(file), `${path.basename(file, path.extname(file))}_shouts.json`)
  const { size, mtimeMs } = statSync(file)
  // (a clip made longer or cut again is another file: measured again)
  const stamp = `${size}-${Math.round(mtimeMs)}`
  try {
    const known = JSON.parse(readFileSync(kept, 'utf-8'))
    if (known?.stamp === stamp && Array.isArray(known.shouts)) return known.shouts
  } catch {}
  try {
    const { stdout } = await execFileAsync('ffmpeg', levelArgs(file), { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 })
    const shouts = shoutsIn(parseLevels(stdout))
    try {
      writeFileSync(kept, JSON.stringify({ stamp, shouts }))
    } catch {}
    return shouts
  } catch {
    return []
  }
}
