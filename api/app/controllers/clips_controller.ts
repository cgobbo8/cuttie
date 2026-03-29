import type { HttpContext } from '@adonisjs/core/http'
import path from 'node:path'
import Job from '#models/job'
import { getPresignedUrl } from '#services/s3'
import { loadJobSharedData, resolveEditEnv } from '#services/edit_env_resolver'

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

export default class ClipsController {
  // GET /api/clips/:jobId/:filename/edit-env
  async editEnv({ params, response, auth }: HttpContext) {
    const safeJobId = params.jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!(await verifyJobOwnership(safeJobId, auth))) {
      return response.notFound({ error: 'clip not found' })
    }

    const safeFilename = path.basename(params.filename)
    const shared = await loadJobSharedData(safeJobId, safeFilename)
    const env = await resolveEditEnv(safeJobId, safeFilename, shared)

    // Game crop math (mirrors vertical_clipper.py _build_filtergraph)
    const gameH = Math.floor(OUTPUT_HEIGHT * GAME_HEIGHT_RATIO)
    const gameAspect = OUTPUT_WIDTH / gameH
    let cropH = env.clip_height
    let cropW = Math.floor(cropH * gameAspect)
    if (cropW > env.clip_width) {
      cropW = env.clip_width
      cropH = Math.floor(cropW / gameAspect)
    }
    const cropX = Math.floor((env.clip_width - cropW) / 2)
    const cropY = Math.floor((env.clip_height - cropH) / 2)
    const gameY = OUTPUT_HEIGHT - gameH - GAME_MARGIN_BOTTOM

    return response.json({
      clip_width: env.clip_width,
      clip_height: env.clip_height,
      facecam: env.facecam,
      dominant_color: env.dominant_color,
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
      words: env.words,
      chat_messages: env.chat_messages,
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
