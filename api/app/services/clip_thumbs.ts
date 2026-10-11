/**
 * Thumbnails of clips and exports: frames extracted on demand with ffmpeg and
 * cached next to the video (<folder>/<job>/thumbs/<base>_<width>_<tenths>.jpg).
 * They outlive the clips freed to make room (disk_space.ts): a project keeps its
 * pictures without its videos.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { storagePath } from '#services/data_paths'

const execFileAsync = promisify(execFile)

export const THUMB_WIDTHS = [480, 1280]
const MAX_FFMPEG = 3
let ffmpegRunning = 0
const ffmpegWaiters: (() => void)[] = []

async function withFfmpegSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (ffmpegRunning >= MAX_FFMPEG) await new Promise<void>((resolve) => ffmpegWaiters.push(resolve))
  ffmpegRunning++
  try {
    return await fn()
  } finally {
    ffmpegRunning--
    ffmpegWaiters.shift()?.()
  }
}

/** 40 % into the clip: past the lead-in, before the payoff fades out */
export function defaultThumbTime(jobId: string, filename: string): number {
  const probe = storagePath(`clips/${jobId}/${filename.replace(/\.mp4$/, '')}_probe.json`)
  try {
    const duration = Number(JSON.parse(readFileSync(probe, 'utf-8')).duration)
    if (duration > 0) return Math.round(duration * 4) / 10
  } catch {}
  return 1
}

export function thumbPath(folder: 'clips' | 'renders', jobId: string, filename: string, width: number, seconds: number): string {
  const base = filename.replace(/\.mp4$/, '')
  return storagePath(`${folder}/${jobId}/thumbs/${base}_${width}_${Math.round(seconds * 10)}.jpg`)
}

/** A thumbnail already made for this video (same width first), when the video itself is gone */
export function anyThumb(folder: 'clips' | 'renders', jobId: string, filename: string, width: number): string | null {
  const dir = storagePath(`${folder}/${jobId}/thumbs`)
  if (!existsSync(dir)) return null
  const base = filename.replace(/\.mp4$/, '')
  const made = readdirSync(dir).filter((name) => name.startsWith(`${base}_`) && /^_\d+_\d+\.jpg$/.test(name.slice(base.length)))
  const best = made.find((name) => name.startsWith(`${base}_${width}_`)) ?? made[0]
  return best ? path.join(dir, best) : null
}

export async function extractFrame(videoPath: string, seconds: number, width: number, dest: string) {
  mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp.jpg`
  await withFfmpegSlot(() =>
    execFileAsync(
      'ffmpeg',
      ['-v', 'error', '-ss', String(seconds), '-i', videoPath, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-y', tmp],
      { timeout: 30_000 }
    )
  )
  renameSync(tmp, dest)
}

/** The thumbnail the app shows for a clip at `width`, made now if missing (before the clip is freed) */
export async function keepThumb(jobId: string, filename: string, width: number): Promise<void> {
  const clip = storagePath(`clips/${jobId}/${filename}`)
  const dest = thumbPath('clips', jobId, filename, width, defaultThumbTime(jobId, filename))
  if (existsSync(dest) || !existsSync(clip)) return
  await extractFrame(clip, defaultThumbTime(jobId, filename), width, dest)
}
