import type { HttpContext } from '@adonisjs/core/http'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { uploadFile, getPresignedUrl, listObjects } from '#services/s3'
import app from '@adonisjs/core/services/app'

export default class AssetsController {
  // GET /api/assets
  async index({ response }: HttpContext) {
    const keys = await listObjects('assets/')
    const files = keys.map((key) => {
      const filename = key.replace('assets/', '')
      return { filename, url: `/api/assets/${filename}` }
    })
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

    const ext = path.extname(file.clientName || 'img.png') || '.png'
    const assetId = randomBytes(6).toString('hex')
    const filename = `${assetId}${ext}`

    // Move to temp, upload to S3, delete local
    const tmpDir = app.tmpPath('uploads')
    await file.move(tmpDir, { name: filename, overwrite: true })
    const tmpPath = path.join(tmpDir, filename)

    const contentType = file.headers['content-type'] ?? 'application/octet-stream'
    await uploadFile(`assets/${filename}`, tmpPath, contentType)

    // Clean up local temp file
    const { unlinkSync } = await import('node:fs')
    try { unlinkSync(tmpPath) } catch {}

    return response.created({ id: assetId, filename, url: `/api/assets/${filename}` })
  }

  // GET /api/assets/:filename
  async show({ params, response }: HttpContext) {
    const filename = path.basename(params.filename)
    const presignedUrl = await getPresignedUrl(`assets/${filename}`)
    return response.redirect(presignedUrl)
  }
}
