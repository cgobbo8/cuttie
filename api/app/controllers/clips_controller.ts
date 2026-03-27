import type { HttpContext } from '@adonisjs/core/http'
import { existsSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import Job from '#models/job'
import { getPresignedUrl } from '#services/s3'

const execFileAsync = promisify(execFile)
const CLIPS_BASE = path.resolve('..', 'backend', 'clips')

// ── Layout constants (mirrors vertical_clipper.py) ───────────────────────────
const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920
const GAME_HEIGHT_RATIO = 0.70
const GAME_MARGIN_BOTTOM = 60
const CAM_SIZE = 560
const CAM_MARGIN_TOP = 40
const CAM_BORDER_RADIUS = 20
const BLUR_SIGMA = 40

async function verifyJobOwnership(jobId: string, auth: HttpContext['auth']) {
  const user = auth.getUserOrFail()
  const job = await Job.find(jobId)
  if (!job || job.userId !== user.id) return null
  return job
}

/** Read clip dimensions from probe JSON (written by Python worker) or fallback to ffprobe */
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

  // Fallback: try ffprobe on local file (for legacy clips not yet migrated)
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

export default class ClipsController {
  // GET /api/clips/:jobId/:filename/edit-env
  async editEnv({ params, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }

    const safeFilename = path.basename(params.filename)
    const { width: inputW, height: inputH } = await getClipDimensions(safeJobId, safeFilename)

    // Facecam (from cached facecam.json)
    const facecamPath = path.join(CLIPS_BASE, safeJobId, 'facecam.json')
    let facecam: { x: number; y: number; w: number; h: number } | null = null
    if (existsSync(facecamPath)) {
      try { facecam = JSON.parse(readFileSync(facecamPath, 'utf-8')) } catch {}
    }

    // Game crop math (mirrors vertical_clipper.py _build_filtergraph)
    const gameH = Math.floor(OUTPUT_HEIGHT * GAME_HEIGHT_RATIO)
    const gameAspect = OUTPUT_WIDTH / gameH
    let cropH = inputH
    let cropW = Math.floor(cropH * gameAspect)
    if (cropW > inputW) {
      cropW = inputW
      cropH = Math.floor(cropW / gameAspect)
    }
    const cropX = Math.floor((inputW - cropW) / 2)
    const cropY = Math.floor((inputH - cropH) / 2)
    const gameY = OUTPUT_HEIGHT - gameH - GAME_MARGIN_BOTTOM

    // Words (from cached *_words.json)
    const base = path.basename(safeFilename, path.extname(safeFilename))
    const verticalBase = base.replace('clip_', 'vertical_')
    const wordsPath = path.join(CLIPS_BASE, safeJobId, `${verticalBase}_words.json`)
    let words: any[] = []
    if (existsSync(wordsPath)) {
      try { words = JSON.parse(readFileSync(wordsPath, 'utf-8')) } catch {}
    }

    // Lazy transcription: call Python Whisper if no cached words
    const clipPath = path.join(CLIPS_BASE, safeJobId, safeFilename)
    if (words.length === 0 && existsSync(clipPath)) {
      const BACKEND = path.resolve('../backend')
      try {
        const { stdout } = await execFileAsync(
          'uv', ['run', 'python', 'transcribe_clip.py', clipPath, wordsPath],
          { cwd: BACKEND, timeout: 120_000 }
        )
        words = JSON.parse(stdout)
      } catch { /* non-critical */ }
    }

    // Dominant color (from cached dominant_color.json)
    const dominantPath = path.join(CLIPS_BASE, safeJobId, 'dominant_color.json')
    let dominantColor: { r: number; g: number; b: number } | null = null
    if (existsSync(dominantPath)) {
      try { dominantColor = JSON.parse(readFileSync(dominantPath, 'utf-8')) } catch {}
    }

    // Chat messages (filtered to clip window, timestamps relative to clip start)
    const clipNumber = base.match(/clip_(\d+)/)?.[1] ?? null
    const metaPath = clipNumber ? path.join(CLIPS_BASE, safeJobId, `clip_${clipNumber}_meta.json`) : null
    const chatPath = path.join(CLIPS_BASE, safeJobId, 'chat.json')
    let chatMessages: { author: string; text: string; timestamp: number }[] = []
    if (metaPath && existsSync(metaPath) && existsSync(chatPath)) {
      try {
        const { vod_start, vod_end } = JSON.parse(readFileSync(metaPath, 'utf-8'))
        const allChat: { timestamp: number; text: string; author: string }[] = JSON.parse(readFileSync(chatPath, 'utf-8'))
        chatMessages = allChat
          .filter((m) => m.timestamp >= vod_start && m.timestamp <= vod_end)
          .map((m) => ({ author: m.author, text: m.text, timestamp: m.timestamp - vod_start }))
      } catch {}
    }

    return response.json({
      clip_width: inputW,
      clip_height: inputH,
      facecam,
      dominant_color: dominantColor,
      game_crop: { x: cropX, y: cropY, w: cropW, h: cropH },
      layout: {
        canvas_w: OUTPUT_WIDTH,
        canvas_h: OUTPUT_HEIGHT,
        game_h: gameH,
        game_y: gameY,
        cam_size: CAM_SIZE,
        cam_margin_top: CAM_MARGIN_TOP,
        cam_border_radius: CAM_BORDER_RADIUS,
        blur_sigma: BLUR_SIGMA,
        game_margin_bottom: GAME_MARGIN_BOTTOM,
      },
      words,
      chat_messages: chatMessages,
    })
  }

  // GET /api/clips/:jobId/:filename
  async show({ params, response, auth }: HttpContext) {
    const { jobId, filename } = params
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')

    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }

    const safeFilename = path.basename(filename)

    // Determine S3 key based on filename prefix
    const s3Key = safeFilename.startsWith('render_')
      ? `renders/${safeJobId}/${safeFilename}`
      : `clips/${safeJobId}/${safeFilename}`

    const presignedUrl = await getPresignedUrl(s3Key)
    return response.redirect(presignedUrl)
  }
}
