import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, statSync } from 'node:fs'
import path from 'node:path'
import { storagePath, verifySignature } from '#services/storage'

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

export default class StorageController {
  /** GET /api/storage/* — serve a stored file from a signed URL (supports Range requests) */
  async show({ params, request, response }: HttpContext) {
    const key = (params['*'] as string[]).map((segment) => decodeURIComponent(segment)).join('/')
    const expires = Number(request.input('exp'))
    const sig = String(request.input('sig') ?? '')

    if (!verifySignature(key, expires, sig)) {
      return response.forbidden({ error: 'invalid or expired link' })
    }

    let filePath: string
    let size: number
    try {
      filePath = storagePath(key)
      size = statSync(filePath).size
    } catch {
      return response.notFound({ error: 'file not found' })
    }

    response.header('Content-Type', MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
    response.header('Accept-Ranges', 'bytes')
    response.header('Cache-Control', 'private, max-age=3600')
    // Signed URLs are capabilities: let <video crossOrigin> and the Remotion renderer read them
    response.header('Access-Control-Allow-Origin', '*')

    const downloadName = request.input('download') as string | undefined
    if (downloadName) {
      const asciiName = downloadName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
      response.header(
        'Content-Disposition',
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
      )
    }

    const range = request.header('range')
    if (!range) {
      response.header('Content-Length', String(size))
      return response.stream(createReadStream(filePath))
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    let start = match?.[1] ? Number(match[1]) : NaN
    let end = match?.[2] ? Number(match[2]) : size - 1
    if (match && !match[1] && match[2]) {
      // Suffix range: last N bytes
      start = Math.max(0, size - Number(match[2]))
      end = size - 1
    }
    if (!match || Number.isNaN(start) || start > end || start >= size) {
      response.header('Content-Range', `bytes */${size}`)
      return response.status(416).send('')
    }
    end = Math.min(end, size - 1)

    response.status(206)
    response.header('Content-Range', `bytes ${start}-${end}/${size}`)
    response.header('Content-Length', String(end - start + 1))
    return response.stream(createReadStream(filePath, { start, end }))
  }
}
