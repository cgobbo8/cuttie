import type { HttpContext } from '@adonisjs/core/http'
import { MAX_NOTE, MAX_NOTES, cleanNote, createNote, deleteNote, listNotes, saveNote } from '#services/notes'

/**
 * The notes the streamer writes for the AI (page « Ma chaîne »): what it should know about them,
 * the people around them and their games. See services/notes.ts for what a note is.
 */
export default class NotesController {
  /** GET /api/notes — every note, and how much can be written */
  async index() {
    return { notes: listNotes(), max: MAX_NOTES, max_chars: MAX_NOTE }
  }

  /** POST /api/notes { title, games?, body } — a new note */
  async store({ request, response }: HttpContext) {
    const fields = cleanNote(request.body())
    if (!fields) return response.badRequest({ error: 'title and body required' })
    const note = createNote(fields)
    if (!note) return response.badRequest({ error: 'too many notes' })
    return response.created({ note })
  }

  /** PUT /api/notes/:id { title, games?, body } — the note as it is now */
  async update({ params, request, response }: HttpContext) {
    const fields = cleanNote(request.body())
    if (!fields) return response.badRequest({ error: 'title and body required' })
    const note = saveNote(params.id, fields)
    if (!note) return response.notFound({ error: 'note not found' })
    return { note }
  }

  /** DELETE /api/notes/:id */
  async destroy({ params, response }: HttpContext) {
    if (!deleteNote(params.id)) return response.notFound({ error: 'note not found' })
    return { deleted: true }
  }
}
