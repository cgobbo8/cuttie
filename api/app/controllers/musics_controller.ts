import type { HttpContext } from '@adonisjs/core/http'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import Job from '#models/job'
import { clipDir } from '#services/data_paths'
import { streamFile } from '#services/file_stream'
import { getBrandKit, saveBrandKit } from '#services/brand_kit'
import { MAX_OWN_MUSICS, MUSIC_KINDS, musicFile, musicTracks, newMusicId, ownMusicsDir, ownTracks, parseKinds, removeOwnFile, saveOwnTracks, type MusicTrack } from '#services/musics'
import { measureLoudness } from '#services/sound_level'
import { describeMusic } from '#services/worker_client'
import { workerFailure } from '#services/worker_failure'

/** A track as the app shows it: what it is, never where its file is */
function shown({ file: _file, source: _source, ...track }: MusicTrack) {
  return { ...track, own: track.own === true, available: !!musicFile(track.id) }
}

/** A name for a track from its file's: "sub_clair-drift-phonk-550480.mp3" -> "Sub clair drift phonk" */
function nameOf(file: string): string {
  const words = path
    .basename(file, path.extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (words ? words[0].toUpperCase() + words.slice(1) : 'Ma musique').slice(0, 60)
}

/** How loud a live's clips are, kept next to them once measured */
const LEVEL_FILE = '_loudness.json'

export default class MusicsController {
  /** GET /api/musics — the background musics there are (those that ship, then the streamer's own), and which have their file on this machine */
  async index() {
    return { kinds: MUSIC_KINDS, musics: musicTracks().map(shown) }
  }

  /**
   * POST /api/musics (multipart: file, language?) — the streamer adds a track of their own. It is kept
   * as an MP3 in the data folder, measured, and listened to by the AI, which fills in what it is for
   * (the streamer can change it). `heard: false`: nobody could listen (`why`: "credits", "key",
   * "failed"); the track is there all the same, its description left for the streamer to write.
   */
  async store({ request, response }: HttpContext) {
    const file = request.file('file', { extnames: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'], size: '60mb' })
    if (!file) return response.badRequest({ error: 'No file provided' })
    if (!file.isValid) return response.badRequest({ error: file.errors[0]?.message ?? 'Invalid file' })
    const own = ownTracks()
    if (own.length >= MAX_OWN_MUSICS) return response.badRequest({ error: 'too many musics' })

    const id = newMusicId()
    const dir = ownMusicsDir()
    const extension = (path.extname(file.clientName || '').toLowerCase().match(/^\.[a-z0-9]{2,5}$/) ?? ['.mp3'])[0]
    const source = path.join(dir, `${id}.added${extension}`)
    const target = path.join(dir, `${id}.mp3`)
    mkdirSync(dir, { recursive: true })
    await file.move(dir, { name: path.basename(source), overwrite: true })
    const language = ['fr', 'en', 'es'].includes(request.input('language')) ? request.input('language') : 'fr'
    const title = nameOf(file.clientName || '')
    try {
      const described = await describeMusic({ source, target, language, hint: path.basename(file.clientName || '').slice(0, 120) })
      const track: MusicTrack = {
        id,
        name: title,
        author: '',
        source: 'added by the streamer',
        file: path.basename(file.clientName || `${id}.mp3`).slice(0, 160),
        genre: described.genre,
        kinds: parseKinds(described.kinds),
        // (to the hundredth: an intro played on it lasts four of its beats, and what lands in it lands on them)
        bpm: Math.round((Number(described.bpm) || 0) * 100) / 100,
        seconds: Number(described.seconds) || 0,
        start: Math.max(0, Number(described.start) || 0),
        lufs: Number.isFinite(described.lufs) ? described.lufs : -14,
        about: String(described.about ?? '').slice(0, 360),
        description: String(described.description ?? '').slice(0, 300),
        own: true,
      }
      saveOwnTracks([...own.map(({ own: _own, ...kept }) => kept), track])
      return response.created({ music: shown(track), heard: described.heard === true, why: described.why ?? null, cost: Number(described.cost) || 0 })
    } catch (err) {
      removeOwnFile(id)
      return workerFailure(response, err)
    } finally {
      rmSync(source, { force: true })
    }
  }

  /** PUT /api/musics/:id { name?, kinds?, description? } — the streamer corrects what one of their own tracks is */
  async update({ params, request, response }: HttpContext) {
    const own = ownTracks()
    const track = own.find((t) => t.id === params.id)
    if (!track) return response.notFound({ error: 'music not found' })
    const body = request.body() as Record<string, unknown>
    if (typeof body.name === 'string' && body.name.trim()) track.name = body.name.trim().slice(0, 60)
    if (body.kinds !== undefined) track.kinds = parseKinds(body.kinds)
    if (typeof body.description === 'string') {
      track.description = body.description.trim().slice(0, 300)
      // What the streamer says of their track is what the AI reads from now on
      track.about = track.description
    }
    saveOwnTracks(own.map(({ own: _own, ...kept }) => kept))
    return { music: shown(track) }
  }

  /** DELETE /api/musics/:id — one of the streamer's own tracks is removed (the tracks that ship stay) */
  async destroy({ params, response }: HttpContext) {
    const own = ownTracks()
    if (!own.some((t) => t.id === params.id)) return response.notFound({ error: 'music not found' })
    saveOwnTracks(own.filter((t) => t.id !== params.id).map(({ own: _own, ...kept }) => kept))
    removeOwnFile(params.id)
    // It was somebody's favourite: no longer
    const kit = await getBrandKit()
    const favourites = Object.fromEntries(Object.entries(kit.musics).filter(([, id]) => id !== params.id))
    if (Object.keys(favourites).length !== Object.keys(kit.musics).length) saveBrandKit({ musics: favourites })
    return { success: true }
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
