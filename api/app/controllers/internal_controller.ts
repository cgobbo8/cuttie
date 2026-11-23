import type { HttpContext } from '@adonisjs/core/http'
import { timingSafeEqual } from 'node:crypto'
import env from '#start/env'
import jobStatusBus, { type JobStatusUpdate } from '#services/job_status_bus'
import { asker, assistantTool } from '#services/assistant'
import { ensureLocalUser } from '#services/local_user'

function hasValidSecret(given: string | undefined): boolean {
  const expected = env.get('CUTTIE_INTERNAL_SECRET')
  if (!expected || !given) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default class InternalController {
  /** POST /api/internal/worker-events — status updates pushed by the Python worker */
  async workerEvents({ request, response }: HttpContext) {
    if (!hasValidSecret(request.header('x-cuttie-secret'))) {
      return response.unauthorized({ error: 'invalid secret' })
    }
    await jobStatusBus.handle(request.body() as JobStatusUpdate)
    return response.noContent()
  }

  /**
   * POST /api/internal/assistant { tool, args } — what the assistant asks of the app while it
   * answers the streamer (their lives, clips and videos; keep a clip; start an analysis they
   * agreed to). Answers data, or { error } said to the model as it is.
   */
  async assistant({ request, response }: HttpContext) {
    if (!hasValidSecret(request.header('x-cuttie-secret'))) {
      return response.unauthorized({ error: 'invalid secret' })
    }
    const tool = request.input('tool')
    const args = request.input('args')
    if (typeof tool !== 'string') return response.badRequest({ error: 'no tool named' })
    // Whose lives: the streamer the assistant is answering (the local user when asked out of a request)
    const userId = asker() ?? (await ensureLocalUser()).id
    return assistantTool(userId, tool, args && typeof args === 'object' && !Array.isArray(args) ? args : {})
  }
}
