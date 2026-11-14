import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import { WorkerHttpError, WorkerUnavailableError } from '#services/worker_client'

/**
 * The worker's refusals as the app reads them: 409 the live has no transcript,
 * 402 no credits left / 401 key refused (the AI provider), 410 the live is gone
 * from Twitch, 503 the worker doesn't answer.
 */
export function workerFailure(response: HttpContext['response'], err: unknown) {
  if (err instanceof WorkerHttpError) {
    if (err.status === 409) return response.conflict({ error: 'no_transcript' })
    if (err.status === 402) return response.status(402).send({ error: 'credits' })
    if (err.status === 401) return response.status(402).send({ error: 'key' })
    if (err.status === 410) return response.status(410).send({ error: 'live_gone' })
    logger.warn({ err }, 'The worker failed')
    return response.status(502).send({ error: 'failed' })
  }
  if (err instanceof WorkerUnavailableError) return response.status(503).send({ error: 'unreachable' })
  throw err
}
