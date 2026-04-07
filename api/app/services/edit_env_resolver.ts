/**
 * Resolves edit-environment data for a clip.
 * Extracted from ClipsController.editEnv() so it can be reused for batch renders.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { getPresignedUrl, listObjects } from '#services/s3'

const execFileAsync = promisify(execFile)
const CLIPS_BASE = path.resolve('..', 'backend', 'clips')

export interface EditEnvironment {
  clip_width: number
  clip_height: number
  facecam: { x: number; y: number; w: number; h: number } | null
  dominant_color: { r: number; g: number; b: number } | null
  words: { word: string; start: number; end: number }[]
  chat_messages: { author: string; text: string; timestamp: number }[]
}

/** Shared data that is per-job (not per-clip). Load once, reuse for batch. */
export interface JobSharedData {
  facecam: { x: number; y: number; w: number; h: number } | null
  dominantColor: { r: number; g: number; b: number } | null
  allChat: { timestamp: number; text: string; author: string }[]
  clipWidth: number
  clipHeight: number
}

/** Read clip dimensions from probe JSON or ffprobe fallback */
async function getClipDimensions(
  jobId: string,
  clipFilename: string
): Promise<{ width: number; height: number }> {
  const base = path.basename(clipFilename, path.extname(clipFilename))
  const probePath = path.join(CLIPS_BASE, jobId, `${base}_probe.json`)

  if (existsSync(probePath)) {
    try {
      const probe = JSON.parse(readFileSync(probePath, 'utf-8'))
      return { width: probe.width ?? 1920, height: probe.height ?? 1080 }
    } catch {}
  }

  const clipPath = path.join(CLIPS_BASE, jobId, clipFilename)
  if (existsSync(clipPath)) {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', clipPath,
    ])
    const stream = JSON.parse(stdout).streams?.[0] ?? {}
    return { width: stream.width ?? 1920, height: stream.height ?? 1080 }
  }

  return { width: 1920, height: 1080 }
}

/** Load shared job data (facecam, dominant_color, chat). Cached per batch. */
export async function loadJobSharedData(jobId: string, sampleClipFilename: string): Promise<JobSharedData> {
  // Facecam
  const facecamPath = path.join(CLIPS_BASE, jobId, 'facecam.json')
  let facecam: { x: number; y: number; w: number; h: number } | null = null
  if (existsSync(facecamPath)) {
    try { facecam = JSON.parse(readFileSync(facecamPath, 'utf-8')) } catch {}
  }
  if (!facecam) {
    const BACKEND = path.resolve('../backend')
    try {
      const s3Keys = await listObjects(`clips/${jobId}/`)
      const clipKeys = s3Keys
        .filter((k: string) => k.endsWith('.mp4'))
        .sort()
        .slice(0, 5)
      if (clipKeys.length > 0) {
        const urls = await Promise.all(clipKeys.map((k: string) => getPresignedUrl(k)))
        const { stdout } = await execFileAsync(
          'uv', ['run', 'python', 'detect_facecam_cli.py', facecamPath, ...urls],
          { cwd: BACKEND, timeout: 180_000 }
        )
        const parsed = JSON.parse(stdout.trim())
        if (parsed) facecam = parsed
      }
    } catch (err) {
      logger.warn({ err }, 'Facecam detection failed for job %s', jobId)
    }
  }

  // Dominant color
  const dominantPath = path.join(CLIPS_BASE, jobId, 'dominant_color.json')
  let dominantColor: { r: number; g: number; b: number } | null = null
  if (existsSync(dominantPath)) {
    try { dominantColor = JSON.parse(readFileSync(dominantPath, 'utf-8')) } catch {}
  }

  // Chat
  const chatPath = path.join(CLIPS_BASE, jobId, 'chat.json')
  let allChat: { timestamp: number; text: string; author: string }[] = []
  if (existsSync(chatPath)) {
    try { allChat = JSON.parse(readFileSync(chatPath, 'utf-8')) } catch {}
  }

  // Clip dimensions (same for all clips in a job since they come from the same VOD)
  const { width, height } = await getClipDimensions(jobId, sampleClipFilename)

  return { facecam, dominantColor, allChat, clipWidth: width, clipHeight: height }
}

/** Resolve full edit environment for a single clip, using shared job data. */
export async function resolveEditEnv(
  jobId: string,
  clipFilename: string,
  shared: JobSharedData,
): Promise<EditEnvironment> {
  const base = path.basename(clipFilename, path.extname(clipFilename))

  // Words (per-clip)
  const wordsPath = path.join(CLIPS_BASE, jobId, `${base}_words.json`)
  let words: { word: string; start: number; end: number; speaker?: string }[] = []
  if (existsSync(wordsPath)) {
    try { words = JSON.parse(readFileSync(wordsPath, 'utf-8')) } catch {}
  }

  // Lazy transcription fallback — download from S3 if not local
  if (words.length === 0) {
    const clipPath = path.join(CLIPS_BASE, jobId, clipFilename)
    let downloadedFromS3 = false

    if (!existsSync(clipPath)) {
      try {
        const s3Key = `clips/${jobId}/${clipFilename}`
        const presignedUrl = await getPresignedUrl(s3Key, 600)
        const res = await fetch(presignedUrl)
        if (res.ok) {
          mkdirSync(path.dirname(clipPath), { recursive: true })
          const buf = Buffer.from(await res.arrayBuffer())
          writeFileSync(clipPath, buf)
          downloadedFromS3 = true
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to download clip from S3 for transcription: %s/%s', jobId, clipFilename)
      }
    }

    if (existsSync(clipPath)) {
      const BACKEND = path.resolve('../backend')
      const MAX_RETRIES = 2
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          logger.info('Whisper transcription attempt %d/%d for %s/%s...', attempt, MAX_RETRIES, jobId, clipFilename)
          const { stdout, stderr } = await execFileAsync(
            'uv', ['run', 'python', 'transcribe_clip.py', clipPath, wordsPath],
            { cwd: BACKEND, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 }
          )
          if (stderr) logger.info('Whisper stderr: %s', stderr.slice(0, 500))
          words = JSON.parse(stdout)
          logger.info('Whisper done for %s/%s: %d words', jobId, clipFilename, words.length)
          if (words.length > 0) break
          logger.warn('Whisper returned 0 words for %s/%s (attempt %d/%d)', jobId, clipFilename, attempt, MAX_RETRIES)
        } catch (err: any) {
          logger.error('Transcription failed for %s/%s (attempt %d/%d): code=%s killed=%s stderr=%s', jobId, clipFilename, attempt, MAX_RETRIES, err.code, err.killed, err.stderr?.slice(0, 500))
          if (attempt < MAX_RETRIES) {
            // Wait briefly before retry (in case of transient rate limit)
            await new Promise((r) => setTimeout(r, 3000))
          }
        }
      }
    }

    // Clean up S3-downloaded clip to save disk space
    if (downloadedFromS3) {
      try { unlinkSync(clipPath) } catch {}
    }
  }

  // Chat messages (per-clip window)
  const metaPath = path.join(CLIPS_BASE, jobId, `${base}_meta.json`)
  let chatMessages: { author: string; text: string; timestamp: number }[] = []
  if (existsSync(metaPath) && shared.allChat.length > 0) {
    try {
      const { vod_start, vod_end } = JSON.parse(readFileSync(metaPath, 'utf-8'))
      chatMessages = shared.allChat
        .filter((m) => m.timestamp >= vod_start && m.timestamp <= vod_end)
        .map((m) => ({ author: m.author, text: m.text, timestamp: m.timestamp - vod_start }))
    } catch {}
  }

  return {
    clip_width: shared.clipWidth,
    clip_height: shared.clipHeight,
    facecam: shared.facecam,
    dominant_color: shared.dominantColor,
    words,
    chat_messages: chatMessages,
  }
}
