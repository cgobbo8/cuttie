/**
 * The sound of an export brought to the loudness social platforms play at.
 *
 * A live is often quiet (a real export measured -26 LUFS where TikTok, Shorts
 * and Reels play at about -14: heard less than half as loud) and uneven: someone
 * on the radio is far below the streamer's own voice. ffmpeg's loudnorm
 * measures the whole export, then brings it to the target: one gain when that
 * is enough, a gain that follows the sound when quiet and loud parts are far
 * apart. The picture is copied as it is: a few seconds per minute of video.
 */

import { execFile } from 'node:child_process'
import { renameSync, rmSync } from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Loudness aimed for (LUFS), highest peak allowed (dBTP), and how far apart quiet and loud parts may stay (LU) */
export const TARGET = { loudness: -14, peak: -1.5, range: 11 }
/** An export this close to the target (LU) and under the peak is left alone */
const CLOSE_ENOUGH = 1
const AIM = `loudnorm=I=${TARGET.loudness}:TP=${TARGET.peak}:LRA=${TARGET.range}`

export interface Loudness {
  /** Integrated loudness (LUFS), true peak (dBTP), loudness range (LU), gating threshold (LUFS) */
  loudness: number
  peak: number
  range: number
  threshold: number
  /** What loudnorm would still be off by after its own pass (LU) */
  offset: number
}

/** What loudnorm measured, read in what ffmpeg printed (null: no sound to measure, or silence) */
export function parseLoudness(printed: string): Loudness | null {
  const from = printed.lastIndexOf('{')
  const to = printed.indexOf('}', from)
  if (from === -1 || to === -1) return null
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(printed.slice(from, to + 1))
  } catch {
    return null
  }
  const read = (key: string) => Number.parseFloat(String(raw[key]))
  const measured = {
    loudness: read('input_i'),
    peak: read('input_tp'),
    range: read('input_lra'),
    threshold: read('input_thresh'),
    offset: read('target_offset'),
  }
  // Silence measures as -inf: nothing to bring up
  return Object.values(measured).every(Number.isFinite) ? measured : null
}

/** Whether a measured sound is far enough from the target to be worth a pass */
export function needsLevelling(measured: Loudness): boolean {
  return Math.abs(measured.loudness - TARGET.loudness) > CLOSE_ENOUGH || measured.peak > TARGET.peak + 0.5
}

export function measureArgs(file: string): string[] {
  return ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `${AIM}:print_format=json`, '-f', 'null', '-']
}

/** How long the sound takes to go down before a cut and to come back up after it, seconds */
const DIP = 0.008
/** Most cuts smoothed in one export (the filter is one expression) */
const MAX_CUTS = 150

/**
 * The filter that smooths the cuts between the pieces of a montage: the sound
 * dips to nothing over 8 ms and comes back as fast, at each of `cuts` (seconds
 * of the video). A voice or a noise cut in the middle of its wave makes a click;
 * nobody hears 16 ms missing. Null when there is no cut.
 */
export function smoothCuts(cuts: number[]): string | null {
  const at = [...new Set(cuts.filter((t) => Number.isFinite(t) && t > 0).map((t) => t.toFixed(4)))].slice(0, MAX_CUTS)
  if (at.length === 0) return null
  // The gain is the distance to the nearest cut, counted in dips, never over 1
  const gain = at.reduce((nearest, t) => `min(${nearest},abs(t-${t})/${DIP})`, '1')
  // Small frames: the gain is worked out once per frame, 64 samples are 1.3 ms
  return `asetnsamples=n=64:p=0,volume='${gain}':eval=frame`
}

/**
 * The second pass: the same picture, the sound at the target (what was measured
 * makes it exact; null: its loudness is left alone), its cuts smoothed.
 */
export function levelArgs(file: string, out: string, measured: Loudness | null, cuts: number[] = []): string[] {
  const known = measured
    ? `${AIM}:measured_I=${measured.loudness}:measured_TP=${measured.peak}:measured_LRA=${measured.range}` +
      `:measured_thresh=${measured.threshold}:offset=${measured.offset}:linear=true`
    : null
  const filters = [smoothCuts(cuts), known].filter(Boolean).join(',')
  return [
    '-v', 'error', '-y', '-i', file,
    '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
    // loudnorm works at 192 kHz: back to what players expect
    '-af', filters, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart', out,
  ]
}

export async function measureLoudness(file: string): Promise<Loudness | null> {
  const { stderr } = await execFileAsync('ffmpeg', measureArgs(file), { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
  return parseLoudness(stderr)
}

/**
 * Brings the sound of the video at `file` to the target, in place, and smooths
 * the cuts between its pieces (`cuts`: where they are, seconds of the video).
 * Returns what it measured before and after (LUFS), or null when it left the
 * file as it was (no sound, nothing to do, or ffmpeg failed: an export never
 * fails over this).
 */
export async function levelSound(file: string, cuts: number[] = []): Promise<{ from: number; to: number } | null> {
  const out = `${file}.level.mp4`
  try {
    const measured = await measureLoudness(file)
    if (!measured) return null
    const level = needsLevelling(measured)
    if (!level && !smoothCuts(cuts)) return null
    await execFileAsync('ffmpeg', levelArgs(file, out, level ? measured : null, cuts), { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 })
    const after = await measureLoudness(out)
    if (!after) throw new Error('the levelled file has no sound to measure')
    renameSync(out, file)
    return { from: measured.loudness, to: after.loudness }
  } catch (err: any) {
    console.warn(`[Render] Sound left as it was: ${String(err?.message ?? err).split('\n')[0]}`)
    rmSync(out, { force: true })
    return null
  }
}
