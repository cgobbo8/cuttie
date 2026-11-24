import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { streamFile } from '#services/file_stream'
import {
  MAX_MEDIA,
  MAX_MEDIA_SECONDS,
  MEDIA_EXTENSIONS,
  MediaRefused,
  findMedia,
  importMedia,
  keepMediaWords,
  mediaDir,
  mediaFile,
  mediaItems,
  mediaName,
  mediaThumb,
  mediaWords,
  newMediaId,
  removeMedia,
  renameMedia,
  type MediaItem,
} from '#services/media_library'
import { mediaWordsOf } from '#services/worker_client'

/** A video as the app shows it: what it is, and whether somebody listened to it yet (`spoken`: it has words; null: not heard) */
function shown(item: MediaItem) {
  const words = mediaWords(item.id)
  return { ...item, spoken: words ? words.length > 0 : null }
}

/** The media library: short videos of the streamer's own that a video can take as a passage */
export default class MediaController {
  /** GET /api/media — the videos of the library, the newest first, and what it can take */
  async index() {
    return { media: mediaItems().map(shown), max: MAX_MEDIA, longest: MAX_MEDIA_SECONDS }
  }

  /**
   * POST /api/media (multipart: file, name?) — a video joins the library. It is brought to what the
   * montage plays, then listened to once (its words: subtitles, cuts on words), which may fail
   * without anything being lost. 422 { error: "not_video" | "too_long" | "full" }.
   */
  async store({ request, response }: HttpContext) {
    const file = request.file('file', { extnames: MEDIA_EXTENSIONS, size: '400mb' })
    if (!file) return response.badRequest({ error: 'No file provided' })
    if (!file.isValid) return response.unprocessableEntity({ error: 'not_video', detail: file.errors[0]?.message ?? 'Invalid file' })
    // (kept in the data folder while it is converted: the app's own folder may not be written to once installed)
    const folder = mediaDir()
    mkdirSync(folder, { recursive: true })
    const sent = `${newMediaId()}.sent${(path.extname(file.clientName || '').toLowerCase().match(/^\.[a-z0-9]{2,5}$/) ?? ['.mp4'])[0]}`
    await file.move(folder, { name: sent, overwrite: true })
    const source = path.join(folder, sent)
    try {
      const said = request.input('name')
      const item = await importMedia(source, typeof said === 'string' && said.trim() ? said : mediaName(file.clientName || ''))
      try {
        keepMediaWords(item.id, (await mediaWordsOf(mediaFile(item.id))).words)
      } catch (err) {
        // (not heard: a passage made of it is listened to when it is first used)
        logger.warn({ err }, 'Media %s was not listened to', item.id)
      }
      return response.created({ media: shown(item) })
    } catch (err) {
      if (err instanceof MediaRefused) return response.unprocessableEntity({ error: err.reason, ...(err.seconds ? { seconds: Math.round(err.seconds) } : {}), longest: MAX_MEDIA_SECONDS })
      logger.error({ err }, 'Importing a video failed')
      return response.unprocessableEntity({ error: 'not_video' })
    } finally {
      rmSync(source, { force: true })
    }
  }

  /** PUT /api/media/:id { name } — its name */
  async update({ params, request, response }: HttpContext) {
    const name = request.input('name')
    const item = typeof name === 'string' ? renameMedia(params.id, name) : null
    if (!item) return findMedia(params.id) ? response.badRequest({ error: 'name required' }) : response.notFound({ error: 'media not found' })
    return { media: shown(item) }
  }

  /** DELETE /api/media/:id — it leaves the library (the passages already made of it keep playing) */
  async destroy({ params, response }: HttpContext) {
    if (!removeMedia(params.id)) return response.notFound({ error: 'media not found' })
    return { success: true }
  }

  /** GET /api/media/:id/file — the video itself (Range), to watch it in the library */
  async file({ params, request, response }: HttpContext) {
    const item = findMedia(params.id)
    if (!item) return response.notFound({ error: 'media not found' })
    response.header('Content-Type', 'video/mp4')
    response.header('Cache-Control', 'private, max-age=86400')
    return streamFile({ request, response }, mediaFile(item.id), statSync(mediaFile(item.id)).size)
  }

  /** GET /api/media/:id/thumb — a picture of it */
  async thumb({ params, request, response }: HttpContext) {
    const item = findMedia(params.id)
    const file = item ? mediaThumb(item.id) : ''
    if (!item || !existsSync(file)) return response.notFound({ error: 'media not found' })
    response.header('Content-Type', 'image/jpeg')
    response.header('Cache-Control', 'private, max-age=86400')
    return streamFile({ request, response }, file, statSync(file).size)
  }
}
