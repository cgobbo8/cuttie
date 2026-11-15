/**
 * The background musics a video can play. What they are (name, kinds of video they suit,
 * where they are in full swing, how loud they were recorded) is in the catalogue the app
 * ships with (public/musics/catalogue.json, written in frontend/src/lib/music). The tracks
 * themselves are looked for in the data folder first (<data dir>/musics/<id>.mp3: tracks the
 * streamer was given or added), then next to the catalogue. One whose file is missing is
 * simply not offered.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { DATA_DIR } from '#services/data_paths'

export interface MusicTrack {
  id: string
  name: string
  author: string
  source: string
  file: string
  genre: string
  /** The kinds of video it suits (see MUSIC_KINDS) */
  kinds: string[]
  bpm: number
  seconds: number
  /** Where it is in full swing: a video starts it there */
  start: number
  /** Its loudness as recorded (LUFS) */
  lufs: number
  /** What it sounds like and what it is for, in English: read by the AI */
  about: string
  /** One the streamer added themselves (kept in the data folder), with the description they see and can change */
  own?: boolean
  description?: string
}

/** What a video is, for choosing its music: the streamer can have a favourite for each */
export const MUSIC_KINDS = ['funny', 'skill', 'suspense', 'chill', 'hype']
export const isMusicKind = (value: unknown): value is string => typeof value === 'string' && MUSIC_KINDS.includes(value)

const SHIPPED = () => path.resolve('./public/musics')
const OWN = path.join(DATA_DIR, 'musics')
const ID = /^[a-z0-9]{2,24}$/

const usable = (t: any) => ID.test(t?.id ?? '') && Number.isFinite(t?.lufs) && Number.isFinite(t?.start)

let catalogue: MusicTrack[] | null = null
function shippedTracks(): MusicTrack[] {
  if (!catalogue) {
    try {
      const read = JSON.parse(readFileSync(path.join(SHIPPED(), 'catalogue.json'), 'utf-8'))
      catalogue = (Array.isArray(read?.tracks) ? read.tracks : []).filter(usable)
    } catch {
      catalogue = []
    }
  }
  return catalogue!
}

/** Most tracks a streamer can add */
export const MAX_OWN_MUSICS = 40
export const ownMusicsDir = () => OWN
const OWN_CATALOGUE = path.join(OWN, 'catalogue.json')

/** The tracks the streamer added, as they described them (read each time: it is theirs to change) */
export function ownTracks(): MusicTrack[] {
  try {
    const read = JSON.parse(readFileSync(OWN_CATALOGUE, 'utf-8'))
    return (Array.isArray(read?.tracks) ? read.tracks : []).filter(usable).map((t: MusicTrack) => ({ ...t, own: true }))
  } catch {
    return []
  }
}

export function saveOwnTracks(tracks: MusicTrack[]): void {
  mkdirSync(OWN, { recursive: true })
  writeFileSync(OWN_CATALOGUE, JSON.stringify({ tracks }, null, 2))
}

/** An id no track has: the tracks that ship have names, the streamer's own a letter and eight random characters */
export const newMusicId = () => `u${randomBytes(6).toString('hex').slice(0, 8)}`

/** A track's file gone from the data folder (the streamer removed the track) */
export function removeOwnFile(id: string): void {
  if (ID.test(id)) rmSync(path.join(OWN, `${id}.mp3`), { force: true })
}

/** Every track there is: those that ship, then the streamer's own */
export function musicTracks(): MusicTrack[] {
  const shipped = shippedTracks()
  return [...shipped, ...ownTracks().filter((track) => !shipped.some((s) => s.id === track.id))]
}

/** The kinds of video a track is said to suit, as sent: known kinds, three at most */
export function parseKinds(raw: unknown): string[] {
  return [...new Set((Array.isArray(raw) ? raw : []).filter((kind): kind is string => isMusicKind(kind)))].slice(0, 3)
}

export const findMusic = (id: unknown): MusicTrack | null => (typeof id === 'string' ? (musicTracks().find((track) => track.id === id) ?? null) : null)

/** Where a track's file is on this machine, null when it isn't there */
export function musicFile(id: unknown): string | null {
  if (!findMusic(id)) return null
  for (const dir of [OWN, SHIPPED()]) {
    const file = path.join(dir, `${id}.mp3`)
    if (existsSync(file)) return file
  }
  return null
}

/** The level every sound of an export is brought to (LUFS): a track is brought there, then turned down by its curve */
export const PROGRAM_LUFS = -14
export const trackGain = (track: Pick<MusicTrack, 'lufs'>): number => 10 ** ((PROGRAM_LUFS - track.lufs) / 20)

/** The music's level over a video: where it starts, then each change ([at, over, to], seconds and levels) */
export interface MusicCurve {
  start: number
  ramps: [number, number, number][]
}

/** A curve as the app sends it, null when it isn't one (levels from 0 to 1, times in order) */
export function parseCurve(raw: any): MusicCurve | null {
  const level = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  if (!raw || !level(raw.start) || !Array.isArray(raw.ramps) || raw.ramps.length > 400) return null
  const ramps: MusicCurve['ramps'] = []
  let last = 0
  for (const ramp of raw.ramps) {
    if (!Array.isArray(ramp) || ramp.length !== 3) return null
    const [at, over, to] = ramp
    if (![at, over].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 7200) || at < last || !level(to)) return null
    last = at
    ramps.push([at, over, to])
  }
  return { start: raw.start, ramps }
}
