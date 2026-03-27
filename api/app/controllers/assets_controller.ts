import type { HttpContext } from '@adonisjs/core/http'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'

const ASSETS_DIR = path.resolve('..', 'backend', 'clips', '_assets')

function ensureDir() {
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR, { recursive: true })
}

export default class AssetsController {
  // GET /api/assets
  async index({ response }: HttpContext) {
    if (!existsSync(ASSETS_DIR)) return response.json([])

    const files = readdirSync(ASSETS_DIR)
      .filter((f) => !f.startsWith('.'))
      .sort()
      .map((f) => ({ filename: f, url: `/api/assets/${f}` }))

    return response.json(files)
  }

  // POST /api/assets/upload
  async store({ request, response }: HttpContext) {
    const file = request.file('file', {
      extnames: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      size: '10mb',
    })

    if (!file) return response.badRequest({ error: 'No file provided' })
    if (!file.isValid) return response.badRequest({ error: file.errors[0]?.message ?? 'Invalid file' })

    ensureDir()

    const ext = path.extname(file.clientName || 'img.png') || '.png'
    const assetId = randomBytes(6).toString('hex') // 12-char hex
    const filename = `${assetId}${ext}`

    await file.move(ASSETS_DIR, { name: filename, overwrite: false })

    return response.created({ id: assetId, filename, url: `/api/assets/${filename}` })
  }

  // GET /api/assets/:filename
  async show({ params, response }: HttpContext) {
    const filename = path.basename(params.filename)
    const filePath = path.join(ASSETS_DIR, filename)

    if (!existsSync(filePath)) return response.notFound({ error: 'Asset not found' })

    response.header('Cache-Control', 'public, max-age=31536000')
    return response.download(filePath)
  }
}
