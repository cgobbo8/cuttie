/**
 * The streamer's media library: short videos of their own (an outro, a meme, a reaction filmed on
 * a phone, a clip made elsewhere) that a video can take as a passage, like a moment of a live.
 *
 * Each is kept in the data folder, <data dir>/media/<id>.mp4, brought to what the app's player and
 * its renderer are sure to play (H.264 and AAC, a constant frame rate, 1920 at most on its long
 * side, a sound track even when it had none), with a picture (<id>.jpg) and, once it was listened
 * to, its words (<id>_words.json). library.json says what each one is.
 *
 * A passage made of one (`item.media`) plays the same file: it is linked into the live's folder as
 * piece_<id>.mp4, with the sidecars every clip has, so it is cut, dressed and exported like any
 * other passage. Its times are the video's own seconds, from 0.
 */

import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { DATA_DIR, clipDir } from '#services/data_paths'

const execFileAsync = promisify(execFile)

export interface MediaItem {
  id: string
  name: string
  /** How long it lasts, and its picture's size once kept (a phone's video is already turned upright) */
  seconds: number
  width: number
  height: number
  /** Bytes on the disk */
  size: number
  added_at: string
}

/** Most videos a library holds, the longest one it takes (a passage's longest), and the long side they are kept at */
export const MAX_MEDIA = 80
export const MAX_MEDIA_SECONDS = 180
export const MEDIA_LONG_SIDE = 1920
/** What a video can be sent as */
export const MEDIA_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi']

const DIR = path.join(DATA_DIR, 'media')
const LIBRARY = path.join(DIR, 'library.json')
const ID = /^m[a-f0-9]{8}$/

export const mediaDir = () => DIR
export const isMediaId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
export const newMediaId = () => `m${randomBytes(4).toString('hex')}`

const usable = (m: any) => isMediaId(m?.id) && Number.isFinite(m?.seconds) && m.seconds > 0 && Number.isFinite(m?.width) && Number.isFinite(m?.height)

/** Every video of the library whose file is there, the newest first (read each time: it is the streamer's to change) */
export function mediaItems(): MediaItem[] {
  try {
    const read = JSON.parse(readFileSync(LIBRARY, 'utf-8'))
    return (Array.isArray(read?.items) ? read.items : []).filter((m: any) => usable(m) && existsSync(path.join(DIR, `${m.id}.mp4`)))
  } catch {
    return []
  }
}

/** Written beside then put in place: nobody reads half a library */
export function saveMediaItems(items: MediaItem[]): void {
  mkdirSync(DIR, { recursive: true })
  const beside = `${LIBRARY}.${process.pid}.tmp`
  writeFileSync(beside, JSON.stringify({ items }, null, 2))
  renameSync(beside, LIBRARY)
}

export const findMedia = (id: unknown): MediaItem | null => (isMediaId(id) ? (mediaItems().find((m) => m.id === id) ?? null) : null)
export const mediaFile = (id: string) => path.join(DIR, `${id}.mp4`)
export const mediaThumb = (id: string) => path.join(DIR, `${id}.jpg`)
const mediaWordsFile = (id: string) => path.join(DIR, `${id}_words.json`)

/** A name for a video from its file's: "outro_finale-2026.mov" -> "Outro finale 2026" */
export function mediaName(file: string): string {
  const words = path
    .basename(file, path.extname(file))
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (words ? words[0].toUpperCase() + words.slice(1) : 'Vidéo').slice(0, 60)
}

/** Why a file can't be kept: not a video, or too long for a passage */
export class MediaRefused extends Error {
  constructor(
    public reason: 'not_video' | 'too_long' | 'full',
    public seconds?: number
  ) {
    super(reason)
  }
}

interface Probed {
  seconds: number
  width: number
  height: number
  fps: number
  sound: boolean
}

/** What a file is, as ffprobe reads it (null: not a video) */
async function probe(file: string): Promise<Probed | null> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { timeout: 30_000 })
    const read = JSON.parse(stdout || '{}')
    const streams: any[] = Array.isArray(read.streams) ? read.streams : []
    // (a cover picture stuck in a sound file is not a video)
    const picture = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
    if (!picture) return null
    const seconds = Number(read.format?.duration ?? picture.duration)
    if (!Number.isFinite(seconds) || seconds <= 0) return null
    return { seconds, width: Number(picture.width) || 0, height: Number(picture.height) || 0, fps: frameRate(picture.avg_frame_rate ?? picture.r_frame_rate), sound: streams.some((s) => s.codec_type === 'audio') }
  } catch {
    return null
  }
}

/** A rate as ffprobe writes it ("30000/1001") in pictures a second, kept between 24 and 60 (30 when it says nothing usable) */
export function frameRate(raw: unknown): number {
  const [a, b] = String(raw ?? '').split('/').map(Number)
  const rate = Number.isFinite(a) && a > 0 ? a / (Number.isFinite(b) && b > 0 ? b : 1) : 0
  if (!(rate >= 10 && rate <= 240)) return 30
  return Math.round(Math.min(60, Math.max(24, rate)) * 1000) / 1000
}

/** How ffmpeg turns a file into the video the library keeps (`sound`: it has a sound track; without one it gets a silent one) */
export function keepArgs(source: string, target: string, from: Pick<Probed, 'fps' | 'sound'>): string[] {
  const side = MEDIA_LONG_SIDE
  return [
    '-v', 'error', '-y',
    '-i', source,
    ...(from.sound ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
    '-map', '0:v:0', '-map', from.sound ? '0:a:0' : '1:a:0',
    // Never bigger than the renderer needs, even sides, a constant rate (a phone's is not)
    '-vf', `scale=w='min(${side},iw)':h='min(${side},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${from.fps},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', String(Math.round(from.fps * 2)),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
    // (a silent track has no end of its own)
    ...(from.sound ? [] : ['-shortest']),
    '-movflags', '+faststart',
    target,
  ]
}

/**
 * A file becomes a video of the library. Refused (MediaRefused) when it isn't a video, lasts
 * longer than a passage can, or the library is full; anything it left is removed.
 */
export async function importMedia(source: string, name: string): Promise<MediaItem> {
  const items = mediaItems()
  if (items.length >= MAX_MEDIA) throw new MediaRefused('full')
  const found = await probe(source)
  if (!found) throw new MediaRefused('not_video')
  if (found.seconds > MAX_MEDIA_SECONDS + 0.5) throw new MediaRefused('too_long', found.seconds)

  const id = newMediaId()
  mkdirSync(DIR, { recursive: true })
  const beside = path.join(DIR, `${id}.${process.pid}.tmp.mp4`)
  try {
    await execFileAsync('ffmpeg', keepArgs(source, beside, found), { timeout: 10 * 60_000 })
    // What was kept is what counts: turned upright, shrunk, its length to the picture
    const kept = await probe(beside)
    if (!kept) throw new MediaRefused('not_video')
    renameSync(beside, mediaFile(id))
    await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(1, kept.seconds * 0.3)), '-i', mediaFile(id), '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', mediaThumb(id)], { timeout: 60_000 }).catch(() => {})
    const item: MediaItem = {
      id,
      name: name.trim().slice(0, 60) || 'Vidéo',
      seconds: Math.round(kept.seconds * 100) / 100,
      width: kept.width,
      height: kept.height,
      size: statSync(mediaFile(id)).size,
      added_at: new Date().toISOString(),
    }
    saveMediaItems([item, ...mediaItems()])
    return item
  } catch (err) {
    removeMediaFiles(id)
    throw err
  } finally {
    rmSync(beside, { force: true })
  }
}

function removeMediaFiles(id: string): void {
  if (!isMediaId(id)) return
  for (const file of [mediaFile(id), mediaThumb(id), mediaWordsFile(id)]) rmSync(file, { force: true })
}

/** A video leaves the library (the passages already made of it keep their own file). False: no such video */
export function removeMedia(id: string): boolean {
  const items = mediaItems()
  if (!items.some((m) => m.id === id)) return false
  saveMediaItems(items.filter((m) => m.id !== id))
  removeMediaFiles(id)
  return true
}

export function renameMedia(id: string, name: string): MediaItem | null {
  const items = mediaItems()
  const item = items.find((m) => m.id === id)
  const said = name.trim().slice(0, 60)
  if (!item || !said) return null
  item.name = said
  saveMediaItems(items)
  return item
}

/** The words said in a video (its own seconds), once it was listened to; null: nobody listened yet */
export function mediaWords(id: string): { word: string; start: number; end: number }[] | null {
  try {
    const read = JSON.parse(readFileSync(mediaWordsFile(id), 'utf-8'))
    return Array.isArray(read) ? read : null
  } catch {
    return null
  }
}

/** What was heard in a video, kept for every passage made of it (an empty list: nobody speaks in it) */
export function keepMediaWords(id: string, words: unknown): void {
  if (!isMediaId(id) || !Array.isArray(words) || !existsSync(mediaFile(id))) return
  writeFileSync(mediaWordsFile(id), JSON.stringify(words))
}

/**
 * A video of the library as a passage's clip in a live's folder: the same file under the piece's
 * name (linked, so it takes no more room; copied where links can't be made), where it sits (from 0
 * to its end, in its own seconds, and which video it is), its size, and its words when they are
 * known. False when the video is no longer in the library.
 */
export function mediaAsPiece(jobId: string, mediaId: string, pieceId: string): boolean {
  const item = findMedia(mediaId)
  if (!item || !/^[a-z0-9]{6,24}$/.test(pieceId)) return false
  const dir = clipDir(jobId)
  mkdirSync(dir, { recursive: true })
  const base = path.join(dir, `piece_${pieceId}`)
  rmSync(`${base}.mp4`, { force: true })
  try {
    linkSync(mediaFile(item.id), `${base}.mp4`)
  } catch {
    copyFileSync(mediaFile(item.id), `${base}.mp4`)
  }
  writeFileSync(`${base}_meta.json`, JSON.stringify({ vod_start: 0, vod_end: item.seconds, settled: true, media: item.id }))
  writeFileSync(`${base}_probe.json`, JSON.stringify({ width: item.width, height: item.height, duration: item.seconds }))
  const words = mediaWords(item.id)
  if (words) writeFileSync(`${base}_words.json`, JSON.stringify(words))
  else rmSync(`${base}_words.json`, { force: true })
  return true
}
