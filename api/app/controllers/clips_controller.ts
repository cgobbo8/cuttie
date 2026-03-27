import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'

// Python backend stores clips in backend/clips/<job_id>/
const CLIPS_BASE = path.resolve('..', 'backend', 'clips')

export default class ClipsController {
  // GET /api/clips/:jobId/:filename
  async show({ params, request, response }: HttpContext) {
    const { jobId, filename } = params

    // Sanitize to prevent path traversal
    const safeFilename = path.basename(filename)
    const safeJobId = jobId.replace(/[^a-zA-Z0-9_-]/g, '')
    const filePath = path.join(CLIPS_BASE, safeJobId, safeFilename)

    if (!existsSync(filePath)) {
      return response.notFound({ error: 'clip not found' })
    }

    const stat = statSync(filePath)
    const fileSize = stat.size
    const range = request.header('range')

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-')
      const start = parseInt(startStr, 10)
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1
      const chunkSize = end - start + 1

      response.response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      })
      createReadStream(filePath, { start, end }).pipe(response.response)
    } else {
      response.response.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      })
      createReadStream(filePath).pipe(response.response)
    }
  }
}
