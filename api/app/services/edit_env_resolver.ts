/**
 * Resolves edit-environment data for a clip.
 * Extracted from ClipsController.editEnv() so it can be reused for batch renders.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { CLIPS_DIR as CLIPS_BASE } from '#services/data_paths'
import { listObjects } from '#services/storage'
import Job from '#models/job'
import { detectFacecam, transcribeClipWords } from '#services/worker_client'
import { brandFacecamFor, getBrandKit } from '#services/brand_kit'
import {
  camVisible,
  resolveFacecam,
  scaleRect,
  type FacecamSource,
  type Rect,
  type ResolvedFacecam,
} from '#services/facecam_resolver'

const execFileAsync = promisify(execFile)

export interface EditEnvironment {
  clip_width: number
  clip_height: number
  /** Webcam to use for this clip: null when there is none or it doesn't show in this clip */
  facecam: Rect | null
  /** How this live's webcam was resolved (see facecam_resolver.ts) */
  cam: { rect: Rect | null; source: FacecamSource | null; moved: boolean; visible: boolean }
  dominant_color: { r: number; g: number; b: number } | null
  words: { word: string; start: number; end: number }[]
  chat_messages: { author: string; text: string; timestamp: number }[]
}

/** Shared data that is per-job (not per-clip). Load once, reuse for batch. */
export interface JobSharedData {
  facecam: ResolvedFacecam
  /** People seen on each clip's frames by the worker (clip pixels), when checked */
  people: Record<string, [number, number][]> | null
  dominantColor: { r: number; g: number; b: number } | null
  allChat: { timestamp: number; text: string; author: string }[]
  clipWidth: number
  clipHeight: number
}

/** Read clip dimensions from probe JSON or ffprobe fallback */
export async function getClipDimensions(
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

/** What the worker found on a live's clips (clips/<job>/facecam.json), in clip pixels */
function readStoredFacecam(
  jobId: string,
  width: number,
  height: number
): { rect: Rect | null; people: Record<string, [number, number][]> | null } | null {
  const file = path.join(CLIPS_BASE, jobId, 'facecam.json')
  if (!existsSync(file)) return null
  try {
    const data = JSON.parse(readFileSync(file, 'utf-8'))
    if (data?.version === 2) {
      const fw = data.frame_w || width
      const fh = data.frame_h || height
      const people: Record<string, [number, number][]> = {}
      for (const [clip, points] of Object.entries(data.people ?? {})) {
        people[clip] = (points as [number, number][]).map(([x, y]) => [
          Math.round((x * width) / fw),
          Math.round((y * height) / fh),
        ])
      }
      return { rect: data.rect ? scaleRect(data.rect, fw, fh, width, height) : null, people }
    }
    // Before every live was checked: just the rectangle
    if (Number.isFinite(data?.x)) return { rect: { x: data.x, y: data.y, w: data.w, h: data.h }, people: null }
  } catch {}
  return null
}

const checking = new Map<string, Promise<unknown>>()

/** Locate the webcam on every clip of a live, once (analyses made before the worker did it) */
async function checkLiveFacecam(jobId: string): Promise<void> {
  let pending = checking.get(jobId)
  if (!pending) {
    pending = (async () => {
      const clipFilenames = (await listObjects(`clips/${jobId}/`))
        .map((key) => path.basename(key))
        .filter((name) => name.endsWith('.mp4') && !name.startsWith('render_'))
        .sort()
      // The worker stores the result in facecam.json
      if (clipFilenames.length > 0) await detectFacecam(jobId, clipFilenames)
    })().finally(() => checking.delete(jobId))
    checking.set(jobId, pending)
  }
  await pending
}

/** This live's webcam: set by hand, the streamer's usual one, or the one found on its clips */
async function resolveJobFacecam(jobId: string, width: number, height: number) {
  const job = await Job.find(jobId)
  const brand = brandFacecamFor(await getBrandKit(), width, height)
  const manual = job?.facecam
  const live =
    manual === false
      ? false
      : manual
        ? scaleRect(manual, manual.ref_w || 1920, manual.ref_h || 1080, width, height)
        : null

  let stored = readStoredFacecam(jobId, width, height)
  if (live === null && brand !== false && !stored?.people) {
    try {
      await checkLiveFacecam(jobId)
      stored = readStoredFacecam(jobId, width, height)
    } catch (err) {
      logger.warn({ err }, 'Facecam detection failed for job %s', jobId)
    }
  }

  return {
    resolved: resolveFacecam({ live, brand, detected: stored?.rect ?? null }),
    people: stored?.people ?? null,
  }
}

/** Load shared job data (facecam, dominant_color, chat). Cached per batch. */
export async function loadJobSharedData(jobId: string, sampleClipFilename: string): Promise<JobSharedData> {
  // Clip dimensions (same for all clips in a job since they come from the same VOD)
  const { width, height } = await getClipDimensions(jobId, sampleClipFilename)

  const facecam = await resolveJobFacecam(jobId, width, height)

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

  return { facecam: facecam.resolved, people: facecam.people, dominantColor, allChat, clipWidth: width, clipHeight: height }
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

  // Lazy transcription fallback — the worker transcribes the clip and caches <clip>_words.json
  if (words.length === 0 && existsSync(path.join(CLIPS_BASE, jobId, clipFilename))) {
    const MAX_RETRIES = 2
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.info('Whisper transcription attempt %d/%d for %s/%s...', attempt, MAX_RETRIES, jobId, clipFilename)
        words = await transcribeClipWords(jobId, clipFilename)
        logger.info('Whisper done for %s/%s: %d words', jobId, clipFilename, words.length)
        if (words.length > 0) break
        logger.warn('Whisper returned 0 words for %s/%s (attempt %d/%d)', jobId, clipFilename, attempt, MAX_RETRIES)
      } catch (err: any) {
        logger.error('Transcription failed for %s/%s (attempt %d/%d): %s', jobId, clipFilename, attempt, MAX_RETRIES, err.message)
        if (attempt < MAX_RETRIES) {
          // Wait briefly before retry (in case of transient rate limit)
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
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

  const { rect, source, moved } = shared.facecam
  const visible = camVisible(rect, shared.people?.[path.basename(clipFilename)])

  return {
    clip_width: shared.clipWidth,
    clip_height: shared.clipHeight,
    facecam: visible ? rect : null,
    cam: { rect, source, moved, visible },
    dominant_color: shared.dominantColor,
    words,
    chat_messages: chatMessages,
  }
}
