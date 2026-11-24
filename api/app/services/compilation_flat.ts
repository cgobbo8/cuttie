/**
 * A compilation as one clip, to open it in the layer editor.
 *
 * The layer editor works on one clip: one video, one clock, one set of layers.
 * A compilation is many clips. So its passages are joined end to end in one
 * file, flat_<compilation>_<signature>.mp4, with the sidecars a clip has: its
 * size, the words said (each passage's words moved to where it now plays) and
 * the chat. From there it edits and exports like any clip.
 *
 * What does not survive: the editor has one layout for the whole video, so the
 * transitions between passages and a passage's own template are not carried.
 * The signature names the passages and their cuts: a compilation that has not
 * changed gives the same file, and the editor finds its work again.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { dropClipCaches, readClipMeta } from '#services/clip_extend'
import { clipDir } from '#services/data_paths'
import { itemJob, type Compilation } from '#services/compilations'

const execFileAsync = promisify(execFile)

/** flat_<compilation id>_<signature>.mp4 */
const FLAT = /^flat_([a-z0-9]{10})_([a-f0-9]{8})\.mp4$/
export const isFlatClip = (name: string): boolean => FLAT.test(name)
/** The compilation a joined clip was made from */
export const flatCompilation = (name: string): string | null => name.match(FLAT)?.[1] ?? null

/** The sound goes down to nothing and comes back over this long at each join, seconds (a wave cut in two clicks) */
const DIP = 0.008
/** Frame rates a joined clip is made at */
const MAX_FPS = 60

/** One passage in the joined clip: the file it plays, from where, for how long, and where that is in its live */
export interface FlatPart {
  live: string
  file: string
  from: number
  length: number
  liveStart: number
  /** A video of the media library, not a moment of the live */
  media?: boolean
}

interface Word {
  word: string
  start: number
  end: number
  speaker?: string
}

const thousandth = (s: number) => Math.round(s * 1000) / 1000

/**
 * The passages of a compilation as parts of the joined clip, in the order
 * they play. Null when a passage has no clip, or one that does not hold it.
 */
export function flatParts(jobId: string, compilation: Pick<Compilation, 'sections'>): FlatPart[] | null {
  const parts: FlatPart[] = []
  for (const item of compilation.sections.flatMap((s) => s.items)) {
    const live = itemJob(jobId, item)
    const file = `piece_${item.id}.mp4`
    const meta = readClipMeta(live, file)
    if (!meta || !existsSync(path.join(clipDir(live), file))) return null
    if (meta.vod_start > item.start + 0.05 || meta.vod_end < item.end - 0.05) return null
    parts.push({ live, file, from: thousandth(Math.max(0, item.start - meta.vod_start)), length: thousandth(item.end - item.start), liveStart: item.start, ...(meta.media ? { media: true } : {}) })
  }
  return parts
}

/** Names the passages and their cuts: the same compilation gives the same joined clip */
export function flatSignature(parts: FlatPart[]): string {
  return createHash('sha1').update(JSON.stringify(['v1', ...parts.map((p) => [p.live, p.file, p.from, p.length])])).digest('hex').slice(0, 8)
}

/** Where each part starts in the joined clip, on its frames (a part is a whole number of frames long) */
export function flatStarts(parts: Pick<FlatPart, 'length'>[], fps: number): { starts: number[]; duration: number } {
  const starts: number[] = []
  let frames = 0
  for (const part of parts) {
    starts.push(frames / fps)
    frames += Math.max(1, Math.round(part.length * fps))
  }
  return { starts, duration: frames / fps }
}

/**
 * ffmpeg's arguments to join the parts: each one cut exactly (the picture is
 * encoded again: a copy could only start on a key frame), all brought to the
 * same size and rate, the sound smoothed at each join.
 */
export function flatArgs(parts: (FlatPart & { path: string })[], out: string, size: { width: number; height: number; fps: number }): string[] {
  const inputs = parts.flatMap((part) => ['-ss', String(part.from), '-t', String(part.length), '-i', part.path])
  const { width, height, fps } = size
  const chains = parts.map((part, i) => {
    const frames = Math.max(1, Math.round(part.length * fps))
    const seconds = thousandth(frames / fps)
    const video = `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=end_frame=${frames},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`
    const dipAt = thousandth(Math.max(0, seconds - DIP))
    const audio = `[${i}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=end=${seconds},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${DIP},afade=t=out:st=${dipAt}:d=${DIP},apad=whole_dur=${seconds}[a${i}]`
    return `${video};${audio}`
  })
  const joined = `${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${parts.length}:v=1:a=1[v][a]`
  return [
    '-v', 'error', '-y', ...inputs,
    '-filter_complex', [...chains, joined].join(';'),
    '-map', '[v]', '-map', '[a]',
    // A key frame every second: the editor moves through it freely
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-g', String(fps), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', out,
  ]
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** The words of every part, each moved to where its part plays in the joined clip */
export function flatWords(parts: (FlatPart & { words: Word[] })[], starts: number[]): Word[] {
  return parts.flatMap((part, i) =>
    part.words
      .filter((w) => {
        const middle = (w.start + w.end) / 2
        return middle >= part.from && middle <= part.from + part.length
      })
      .map((w) => ({
        ...w,
        start: thousandth(starts[i] + Math.max(0, w.start - part.from)),
        end: thousandth(starts[i] + Math.min(part.length, w.end - part.from)),
      }))
  )
}

async function frameRate(file: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file])
    const [n, d] = stdout.trim().split('/').map(Number)
    const fps = Math.round(n / (d || 1))
    return Number.isFinite(fps) && fps >= 10 ? Math.min(MAX_FPS, fps) : 30
  } catch {
    return 30
  }
}

/** The joined clips made from a compilation before, deleted (all but `keep`) */
export function dropFlats(jobId: string, compilationId: string, keep?: string): void {
  const dir = clipDir(jobId)
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const clip = name.match(/^(flat_([a-z0-9]{10})_[a-f0-9]{8})(\.mp4|_probe\.json|_words\.json|_chat\.json)$/)
    if (!clip || clip[2] !== compilationId || `${clip[1]}.mp4` === keep) continue
    rmSync(path.join(dir, name), { force: true })
    if (clip[3] === '.mp4') dropClipCaches(jobId, name)
  }
}

const making = new Map<string, Promise<void>>()

/**
 * The compilation as one clip in its live's folder, made when it isn't there
 * yet. Null when a passage's clip is missing (the app cuts them first).
 * `chatOf`: a live's whole chat.
 */
export async function flattenCompilation(
  jobId: string,
  compilation: Pick<Compilation, 'id' | 'sections'>,
  chatOf: (live: string) => { author: string; text: string; timestamp: number; emotes?: string[] }[]
): Promise<{ clip: string; duration: number; fresh: boolean; starts: number[] } | null> {
  const parts = flatParts(jobId, compilation)
  if (!parts || parts.length === 0) return null
  const dir = clipDir(jobId)
  const clip = `flat_${compilation.id}_${flatSignature(parts)}.mp4`
  const base = clip.slice(0, -4)
  const target = path.join(dir, clip)
  const first = path.join(clipDir(parts[0].live), parts[0].file)
  const probe = readJson<{ width?: number; height?: number }>(path.join(clipDir(parts[0].live), `${parts[0].file.slice(0, -4)}_probe.json`), {})
  const fps = await frameRate(first)
  const size = { width: probe.width ?? 1920, height: probe.height ?? 1080, fps }
  const { starts, duration } = flatStarts(parts, fps)

  const fresh = !existsSync(target) || !existsSync(path.join(dir, `${base}_probe.json`))
  if (fresh) {
    // Asked twice at once (a double click): made once
    let pending = making.get(target)
    if (!pending) {
      pending = (async () => {
        const part = `${target}.part.mp4`
        try {
          await execFileAsync('ffmpeg', flatArgs(parts.map((p) => ({ ...p, path: path.join(clipDir(p.live), p.file) })), part, size), { timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 })
          renameSync(part, target)
        } finally {
          rmSync(part, { force: true })
        }
        const words = flatWords(parts.map((p) => ({ ...p, words: readJson<Word[]>(path.join(clipDir(p.live), `${p.file.slice(0, -4)}_words.json`), []) })), starts)
        // What the chat wrote while each passage ran, on the joined clip's clock
        const chat = parts.flatMap((p, i) =>
          // (a video of the media library was never on the stream: no chat ran with it)
          (p.media ? [] : chatOf(p.live))
            .filter((m) => m.timestamp >= p.liveStart && m.timestamp <= p.liveStart + p.length)
            .map((m) => ({ ...m, timestamp: thousandth(starts[i] + (m.timestamp - p.liveStart)) }))
        )
        writeFileSync(path.join(dir, `${base}_words.json`), JSON.stringify(words))
        writeFileSync(path.join(dir, `${base}_chat.json`), JSON.stringify(chat))
        // Written last: with it, the clip is whole
        writeFileSync(path.join(dir, `${base}_probe.json`), JSON.stringify({ width: size.width, height: size.height, duration: thousandth(duration) }))
      })().finally(() => making.delete(target))
      making.set(target, pending)
    }
    await pending
    dropClipCaches(jobId, clip)
  }
  // The ones made for other versions of this compilation are of no use any more
  dropFlats(jobId, compilation.id, clip)
  return { clip, duration: thousandth(duration), fresh, starts: starts.map(thousandth) }
}
