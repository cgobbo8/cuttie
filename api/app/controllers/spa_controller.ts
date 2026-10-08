import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import env from '#start/env'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

/** Serves the built React app (FRONTEND_DIST) with an index.html fallback for client-side routes. */
export default class SpaController {
  async handle({ request, response }: HttpContext) {
    const distSetting = env.get('FRONTEND_DIST')
    if (!distSetting) return response.ok({ status: 'ok' })
    const dist = path.resolve(distSetting)

    const urlPath = decodeURIComponent(request.url())
    if (urlPath.startsWith('/api/') || urlPath.startsWith('/__transmit')) {
      return response.notFound({ error: 'not found' })
    }

    let file = path.resolve(dist, `.${urlPath}`)
    const isAsset = file.startsWith(dist + path.sep) && existsSync(file) && statSync(file).isFile()
    if (!isAsset) file = path.join(dist, 'index.html')

    response.header('Content-Type', MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
    // Vite fingerprints everything under /assets; index.html must always be revalidated
    response.header(
      'Cache-Control',
      isAsset && urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    )
    return response.stream(createReadStream(file))
  }
}
