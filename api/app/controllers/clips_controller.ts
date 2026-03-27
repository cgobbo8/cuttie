import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

const CLIPS_BASE = path.resolve('..', 'backend', 'clips')

export default class ClipsController {
  // GET /api/clips/:jobId/:filename
  async show({ params, request, response }: HttpContext) {
    const { jobId, filename } = params

    const safeFilename = path.basename(filename)
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    const filePath = path.join(CLIPS_BASE, safeJobId, safeFilename)

    if (!existsSync(filePath)) {
      return response.notFound({ error: 'clip not found' })
    }

    const stat = statSync(filePath)
    const fileSize = stat.size
    const range = request.header('range')

    // Range requests for video seeking
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1
      const chunkSize = end - start + 1

      response.status(206)
      response.header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Length', String(chunkSize))
      response.header('Content-Type', 'video/mp4')
      response.stream(createReadStream(filePath, { start, end }))
    } else {
      response.header('Accept-Ranges', 'bytes')
      response.header('Content-Type', 'video/mp4')
      return response.download(filePath)
    }
  }
}
