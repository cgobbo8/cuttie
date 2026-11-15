/**
 * What the streamer writes for the AI about themselves and their streams (page « Ma chaîne »):
 * free-text Markdown notes, one file each in <data dir>/notes/<id>.md. The worker reads them
 * (backend/app/services/notes.py) whenever the AI analyses a live, searches it or builds a
 * video: a note saved here is used by the very next question.
 *
 *   ---
 *   title: GTA V RP sur FlashFA
 *   games: Grand Theft Auto V
 *   ---
 *   (the note)
 *
 * `games` (optional, comma-separated, as Twitch names them): the note is then given only for
 * lives on one of these games; without it, for every live. Plain files on purpose: one can be
 * written elsewhere and dropped in the folder, or sent to someone who imports it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '#services/data_paths'

/** Longest note, and how many there can be: the AI reads them on every question (the worker holds the same numbers) */
export const MAX_NOTE = 4000
export const MAX_NOTES = 12
const MAX_TITLE = 80
const MAX_GAMES = 8

export interface Note {
  id: string
  title: string
  /** The games it is about (as Twitch names them); none: every live */
  games: string[]
  body: string
  updated_at: string
}

export type NoteFields = Pick<Note, 'title' | 'games' | 'body'>

export const notesDir = () => path.join(DATA_DIR, 'notes')
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/
export const isNoteId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const fileOf = (id: string) => path.join(notesDir(), `${id}.md`)

const oneLine = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** A note's file as its fields. The lines between a first `---` and the next are `key: value`; a file without them is all body */
export function parseNoteFile(text: string, fallback = ''): NoteFields {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let title = fallback
  let games: string[] = []
  let body = lines.join('\n')
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const colon = line.indexOf(':')
        if (colon < 0) continue
        const key = line.slice(0, colon).trim().toLowerCase()
        const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
        if (key === 'title' && value) title = value
        else if (key === 'games') games = value.split(',').map((game) => game.trim()).filter(Boolean)
      }
      body = lines.slice(end + 1).join('\n')
    }
  }
  return { title: title.slice(0, MAX_TITLE), games: games.slice(0, MAX_GAMES), body: body.trim().slice(0, MAX_NOTE) }
}

/** A note as its file */
function fileText({ title, games, body }: NoteFields): string {
  return ['---', `title: ${title}`, ...(games.length > 0 ? [`games: ${games.join(', ')}`] : []), '---', body, ''].join('\n')
}

/** A note as the app sends it, made safe to keep: null when it has no title or says nothing */
export function cleanNote(raw: any): NoteFields | null {
  const title = oneLine(raw?.title, MAX_TITLE)
  const body = typeof raw?.body === 'string' ? raw.body.replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTE) : ''
  if (!title || !body) return null
  const games = [
    ...new Set<string>(
      (Array.isArray(raw?.games) ? raw.games : [])
        // (a comma would cut a game's name in two in the file)
        .map((game: unknown) => oneLine(game, 60).replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_GAMES)
  return { title, games, body }
}

/** Every note there is, by file name */
export function listNotes(): Note[] {
  const dir = notesDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .filter(isNoteId)
    .sort()
    .map((id) => readNote(id))
    .filter((note): note is Note => !!note)
}

export function readNote(id: string): Note | null {
  if (!isNoteId(id) || !existsSync(fileOf(id))) return null
  try {
    return { id, ...parseNoteFile(readFileSync(fileOf(id), 'utf-8'), id), updated_at: statSync(fileOf(id)).mtime.toISOString() }
  } catch {
    return null
  }
}

/** A file name from a title: "GTA V RP sur FlashFA" -> "gta-v-rp-sur-flashfa" */
export function slugOf(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug || 'note'
}

function write(id: string, fields: NoteFields): Note {
  mkdirSync(notesDir(), { recursive: true })
  // Written beside, then put in place: the worker never reads half a note
  const draft = `${fileOf(id)}.tmp`
  writeFileSync(draft, fileText(fields), 'utf-8')
  renameSync(draft, fileOf(id))
  return readNote(id)!
}

/** A new note, named after its title (null: there are as many as there can be) */
export function createNote(fields: NoteFields): Note | null {
  if (listNotes().length >= MAX_NOTES) return null
  const base = slugOf(fields.title)
  let id = base
  for (let n = 2; existsSync(fileOf(id)); n++) id = `${base.slice(0, 55)}-${n}`
  return write(id, fields)
}

/** A note changed (null: there is no such note). Its file keeps its name: what names it is its title */
export function saveNote(id: string, fields: NoteFields): Note | null {
  return readNote(id) ? write(id, fields) : null
}

export function deleteNote(id: string): boolean {
  if (!readNote(id)) return false
  rmSync(fileOf(id), { force: true })
  return true
}
