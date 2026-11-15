import type { HttpContext } from '@adonisjs/core/http'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'
import { streamFile } from '#services/file_stream'
import { MUSIC_KINDS, musicFile, musicTracks } from '#services/musics'
import { measureLoudness } from '#services/sound_level'

/** How loud a live's clips are, kept next to them once measured */
const LEVEL_FILE = '_loudness.json'

export default class MusicsController {
  /** GET /api/musics — the background musics there are, and which have their file on this machine */
  async index() {
    return {
      kinds: MUSIC_KINDS,
      musics: musicTracks().map(({ file: _file, source: _source, ...track }) => ({ ...track, available: !!musicFile(track.id) })),
    }
  }

  /** GET /api/musics/:id — a track, to listen to it and to play it under the preview */
  async show({ params, request, response }: HttpContext) {
    const file = musicFile(params.id)
    if (!file) return response.notFound({ error: 'music not found' })
    response.header('Content-Type', 'audio/mpeg')
    response.header('Cache-Control', 'private, max-age=86400')
    return streamFile({ request, response }, file, statSync(file).size)
  }

  /**
   * GET /api/jobs/:id/loudness — how loud this live's clips are (LUFS, null: nothing to measure).
   * An export brings the video's sound to a fixed level before the music is added; the preview
   * plays the clips as they are, so it turns the music down by as much to sound the same.
   */
  async level({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const job = await Job.query().where('id', params.id).where('user_id', user.id).first()
    if (!job) return response.notFound({ error: 'job not found' })
    const dir = clipDir(job.id)
    const kept = path.join(dir, LEVEL_FILE)
    try {
      const known = JSON.parse(readFileSync(kept, 'utf-8'))
      if (Number.isFinite(known?.lufs)) return { lufs: known.lufs }
    } catch {}
    if (!existsSync(dir)) return { lufs: null }
    // Its longest clips say it best (never an export: its sound was already levelled)
    const clips = readdirSync(dir)
      .filter((name) => name.endsWith('.mp4') && !name.startsWith('render_') && !name.startsWith('flat_') && !name.includes('_bg'))
      .map((name) => ({ file: path.join(dir, name), size: statSync(path.join(dir, name)).size }))
      .filter((clip) => clip.size > 100_000)
      .sort((a, b) => b.size - a.size)
      .slice(0, 3)
    const measured: number[] = []
    for (const clip of clips) {
      const loudness = await measureLoudness(clip.file).catch(() => null)
      if (loudness && Number.isFinite(loudness.loudness) && loudness.loudness > -60) measured.push(loudness.loudness)
    }
    if (measured.length === 0) return { lufs: null }
    const lufs = Math.round((measured.reduce((sum, n) => sum + n, 0) / measured.length) * 10) / 10
    try {
      writeFileSync(kept, JSON.stringify({ lufs }))
    } catch {}
    return { lufs }
  }
}
