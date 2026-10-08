/**
 * Derived versions of a clip, made on demand with ffmpeg and cached next to it.
 *
 * Background: the clip cropped to 9:16, shrunk and blurred — the moving
 * backdrop of the vertical templates. Blurring the full-size video in the
 * renderer cost ~150 ms per frame; this file takes a few seconds once.
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { storagePath } from '#services/storage'

const execFileAsync = promisify(execFile)

export const BACKGROUND_SIZE = { width: 270, height: 480 }

const inflight = new Map<string, Promise<string>>()

export function backgroundKey(jobId: string, clipFilename: string): string {
  return `clips/${jobId}/bg/${path.basename(clipFilename, '.mp4')}_bg.mp4`
}

/** Storage key of the clip's blurred background, created if needed */
export function ensureBackground(jobId: string, clipFilename: string): Promise<string> {
  const key = backgroundKey(jobId, clipFilename)
  if (existsSync(storagePath(key))) return Promise.resolve(key)

  let pending = inflight.get(key)
  if (!pending) {
    pending = (async () => {
      const dest = storagePath(key)
      mkdirSync(path.dirname(dest), { recursive: true })
      const tmp = `${dest}.${process.pid}.tmp.mp4`
      const { width, height } = BACKGROUND_SIZE
      await execFileAsync(
        'ffmpeg',
        [
          '-v', 'error', '-y',
          '-i', storagePath(`clips/${jobId}/${clipFilename}`),
          '-an',
          '-vf', `crop=ih*9/16:ih,scale=${width}:${height},gblur=sigma=9`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          tmp,
        ],
        { timeout: 180_000 }
      )
      renameSync(tmp, dest)
      return key
    })().finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}
