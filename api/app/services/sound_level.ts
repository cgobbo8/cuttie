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

/** A short sound laid over the start of the video once its own sound is levelled (an intro's jingle) */
export interface Jingle {
  file: string
  /** 1: as recorded. The jingles are made a little under the level the video is brought to */
  gain: number
  /** It fades out from there (seconds of the video: where the first piece starts), over that long */
  fade?: { at: number; for: number }
  /** How fast it plays (1: as recorded): an intro that follows the music is played faster or slower, and its sound with it */
  rate?: number
}

/** A music played under the whole video, its level moving with what plays (see frontend/src/lib/music/mix.ts) */
export interface Music {
  file: string
  /** Where the track is started (seconds of the track); it starts over when it ends */
  from: number
  /** What brings the track to the level the video's sound is brought to */
  gain: number
  /** Its level over the video: where it starts, then each change ([at, over, to]) */
  curve: { start: number; ramps: [number, number, number][] }
  /** How long the video is, seconds */
  seconds: number
}

/** The level of a music over the video, as an ffmpeg expression of the time `t`: every change is a straight slope */
export function curveGain(curve: Music['curve']): string {
  let before = curve.start
  const slopes = curve.ramps.map(([at, over, to]) => {
    const step = to - before
    before = to
    return `${step < 0 ? '-' : '+'}${Math.abs(step).toFixed(4)}*clip((t-${at.toFixed(3)})/${Math.max(0.001, over).toFixed(3)},0,1)`
  })
  return `${curve.start.toFixed(4)}${slopes.join('')}`
}

/**
 * The second pass: the same picture, the sound at the target (what was measured
 * makes it exact; null: its loudness is left alone), its cuts smoothed. A
 * `jingle` and a `music` are mixed in after that: against the levelled sound
 * they are as loud as they were set to be, whatever the live's own level was.
 */
export function levelArgs(file: string, out: string, measured: Loudness | null, cuts: number[] = [], jingle?: Jingle, music?: Music): string[] {
  const known = measured
    ? `${AIM}:measured_I=${measured.loudness}:measured_TP=${measured.peak}:measured_LRA=${measured.range}` +
      `:measured_thresh=${measured.threshold}:offset=${measured.offset}:linear=true`
    : null
  const filters = [smoothCuts(cuts), known].filter(Boolean).join(',')
  // loudnorm works at 192 kHz: back to what players expect
  const sound = ['-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out]
  if (!jingle && !music) return ['-v', 'error', '-y', '-i', file, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy', '-af', filters, ...sound]

  const inputs = ['-i', file]
  const chains = [`[0:a:0]${filters ? `${filters},` : ''}aresample=48000[video]`]
  const mixed = ['[video]']
  if (jingle) {
    // A sound longer than its intro doesn't play on over the first words: gone a moment after the video starts
    const fade = jingle.fade ? `atrim=0:${(jingle.fade.at + jingle.fade.for).toFixed(3)},afade=t=out:st=${jingle.fade.at.toFixed(3)}:d=${jingle.fade.for.toFixed(3)},` : ''
    const tempo = jingle.rate && Math.abs(jingle.rate - 1) > 0.005 ? `atempo=${Math.min(2, Math.max(0.5, jingle.rate)).toFixed(4)},` : ''
    chains.push(`[${inputs.length / 2}:a:0]aresample=48000,${tempo}${fade}volume=${jingle.gain.toFixed(3)}[jingle]`)
    inputs.push('-i', jingle.file)
    mixed.push('[jingle]')
  }
  if (music) {
    // Read over and over for as long as the video lasts, its level set 47 times a second. A track that
    // starts over loses its clock (the level would stay where it was): it is given one that never stops
    const index = inputs.filter((arg) => arg === '-i').length
    chains.push(
      `[${index}:a:0]aresample=48000,asetpts=N/SR/TB,atrim=0:${music.seconds.toFixed(3)},asetnsamples=n=1024:p=0,` +
        `volume='${music.gain.toFixed(4)}*(${curveGain(music.curve)})':eval=frame[music]`
    )
    inputs.push('-stream_loop', '-1', '-ss', music.from.toFixed(3), '-i', music.file)
    mixed.push('[music]')
  }
  // Nothing is turned down to make room, and the sum never goes over the peak allowed
  const mix = `${mixed.join('')}amix=inputs=${mixed.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=${(10 ** (TARGET.peak / 20)).toFixed(3)}:level=false[out]`
  return ['-v', 'error', '-y', ...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '0:v:0', '-map', '[out]', '-c:v', 'copy', ...sound]
}

export async function measureLoudness(file: string): Promise<Loudness | null> {
  const { stderr } = await execFileAsync('ffmpeg', measureArgs(file), { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
  return parseLoudness(stderr)
}

/**
 * Brings the sound of the video at `file` to the target, in place, and smooths
 * the cuts between its pieces (`cuts`: where they are, seconds of the video);
 * `jingle`: an intro's sound, mixed in at the start; `music`: a music under the whole video.
 * Returns what it measured before and after (LUFS), or null when it left the
 * file as it was (no sound, nothing to do, or ffmpeg failed: an export never
 * fails over this).
 */
export async function levelSound(file: string, cuts: number[] = [], jingle?: Jingle, music?: Music): Promise<{ from: number; to: number } | null> {
  const out = `${file}.level.mp4`
  try {
    const measured = await measureLoudness(file)
    if (!measured) return null
    const level = needsLevelling(measured)
    if (!level && !smoothCuts(cuts) && !jingle && !music) return null
    await execFileAsync('ffmpeg', levelArgs(file, out, level ? measured : null, cuts, jingle, music), { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 })
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
