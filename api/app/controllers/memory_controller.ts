import type { HttpContext } from '@adonisjs/core/http'
import {
  applyProposal,
  clearMemory,
  ignoreProposal,
  lastReading,
  listLives,
  pendingProposals,
  readMemory,
  readingCost,
  readingNow,
  saveMemory,
  startReading,
  stopReading,
  unreadLives,
} from '#services/memory'

/**
 * What the AI remembers of the streamer from one live to the next (page « Ma chaîne », « Mémoire »):
 * read it, correct it, have the AI read the lives analysed before, answer the corrections it
 * proposes for the streamer's own notes. See services/memory.ts.
 */
export default class MemoryController {
  /** GET /api/memory — the memory, the lives read, those that wait and what reading them costs, what is going on */
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const unread = await unreadLives(user.id)
    return {
      ...readMemory(),
      lives: listLives(),
      unread: unread.map((job) => ({ id: job.id, title: job.customTitle || job.vodTitle || '', date: job.streamDate ?? null, game: job.vodGame ?? null, duration: job.vodDurationSeconds ?? 0 })),
      cost: readingCost(unread),
      reading: readingNow(),
      last: lastReading(),
      proposals: pendingProposals(),
    }
  }

  /** PUT /api/memory { sections?, paused? } — the streamer corrects what the AI noted, or stops it from reading each new live */
  async update({ request }: HttpContext) {
    return saveMemory(request.body())
  }

  /** DELETE /api/memory — everything the AI remembers is thrown away */
  async destroy({ response }: HttpContext) {
    if (readingNow()) return response.conflict({ error: 'reading' })
    clearMemory()
    return { cleared: true }
  }

  /** POST /api/memory/read — the AI reads the lives analysed before, the oldest first (202; 409: none left to read) */
  async read({ auth, response }: HttpContext) {
    const reading = await startReading(auth.getUserOrFail().id)
    if (!reading) return response.conflict({ error: 'nothing_to_read' })
    return response.accepted({ reading })
  }

  /** DELETE /api/memory/read — stop after the live being read */
  async stop() {
    return { stopping: stopReading() }
  }

  /** GET /api/memory/proposals — the corrections of the streamer's notes that wait for their answer */
  async proposals() {
    return { proposals: pendingProposals() }
  }

  /** POST /api/memory/proposals/:id/apply — the note is changed as proposed (409: it no longer says that) */
  async apply({ params, response }: HttpContext) {
    const note = applyProposal(params.id)
    if (!note) return response.notFound({ error: 'proposal not found' })
    if (note === 'changed') return response.conflict({ error: 'note_changed' })
    return { note }
  }

  /** DELETE /api/memory/proposals/:id — refused: that sentence is not brought up again */
  async ignore({ params, response }: HttpContext) {
    if (!ignoreProposal(params.id)) return response.notFound({ error: 'proposal not found' })
    return { ignored: true }
  }
}
