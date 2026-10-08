import type { HttpContext } from '@adonisjs/core/http'
import { timingSafeEqual } from 'node:crypto'
import env from '#start/env'
import jobStatusBus, { type JobStatusUpdate } from '#services/job_status_bus'

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
}
