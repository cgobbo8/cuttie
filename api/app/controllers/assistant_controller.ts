import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import Job from '#models/job'
import { hydrate, newMessageId, nowAsking, readConversation, saveConversation, startConversation, type AssistantAction, type AssistantMessage } from '#services/assistant'
import { WorkerHttpError, WorkerUnavailableError, assistantForget, assistantProgress, assistantTurn } from '#services/worker_client'

/**
 * The assistant's panel: one conversation with the streamer, kept from one page to the next
 * (and from one launch to the next: on disk, the page's address may change). The worker runs
 * the assistant (backend/app/services/assistant.py); see services/assistant.ts for what it
 * asks of the app while it works.
 */

const LANGUAGES = ['fr', 'en', 'es']
/** A conversation answering at a time, by user (the worker refuses a second request too) */
const answering = new Set<number>()

/** Why the worker could not answer, as the panel says it */
function failure(err: unknown): string {
  if (err instanceof WorkerUnavailableError) return 'unreachable'
  if (err instanceof WorkerHttpError) {
    if (err.status === 402) return 'credits'
    if (err.status === 401) return 'key'
    if (err.status === 501) return 'dev'
    if (err.status === 409) return /nothing_waiting/.test(err.message) ? 'nothing_waiting' : 'busy'
  }
  return 'failed'
}

/** Where the streamer was when they asked, in a few words (shown under what they said) */
function whereOf(context: Record<string, any>): string[] {
  const name = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 80) : '')
  return [name(context.title), name(context.video?.name) || name(context.clip?.name)].filter(Boolean)
}

/** What the page says of where the streamer is: an object of a few short things, about their own live */
async function contextOf(userId: number, raw: unknown): Promise<Record<string, any>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || JSON.stringify(raw).length > 4000) return {}
  const context = { ...(raw as Record<string, any>) }
  if (context.job !== undefined) {
    const own = typeof context.job === 'string' && /^[0-9a-f-]{36}$/.test(context.job) ? await Job.query().where('id', context.job).where('user_id', userId).first() : null
    if (!own) return { page: typeof context.page === 'string' ? context.page : undefined }
    context.title = own.customTitle || own.vodTitle || ''
  }
  return context
}

export default class AssistantController {
  /** GET /api/assistant — the conversation so far, and whether the assistant is answering */
  async index({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    return { messages: readConversation(user.id).messages, busy: answering.has(user.id) }
  }

  /**
   * POST /api/assistant/turn { text?, resume?: { call, result }, context, language }
   * What the streamer says, or the answer to what the assistant waits for (`resume`: the page
   * did what it was handed, or the streamer said yes or no). Answers once the assistant is done
   * or waits again: { message, said?, changed } — `message` is its answer (the same message,
   * grown, when this was the answer to an action), `said` the streamer's message as kept,
   * `changed` the lives its work changed on the app's side. 409: it is already answering
   * (`busy`), or nothing waits for this answer any more (`nothing_waiting`).
   */
  async turn({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const text = typeof request.input('text') === 'string' ? request.input('text').trim().slice(0, 4000) : ''
    const resume = request.input('resume')
    const resuming = resume && typeof resume === 'object' && typeof resume.call === 'string'
    if (!text && !resuming) return response.badRequest({ error: 'nothing_asked' })
    if (answering.has(user.id)) return response.conflict({ error: 'busy' })

    const language = LANGUAGES.includes(request.input('language')) ? request.input('language') : 'fr'
    const context = await contextOf(user.id, request.input('context'))
    const conversation = readConversation(user.id)
    const last = conversation.messages.at(-1)
    const now = () => new Date().toISOString()

    let said: AssistantMessage | undefined
    let answer: AssistantMessage
    let dropped: { message: AssistantMessage; action: AssistantAction } | undefined
    if (resuming) {
      // The answer to the action its last message waits on: that message goes on
      if (last?.role !== 'assistant' || last.action?.call !== resume.call) return response.conflict({ error: 'nothing_waiting' })
      answer = last
    } else {
      // Something new is asked: an action still waited on is dropped (the worker tells the model so)
      if (last?.role === 'assistant' && last.action) {
        dropped = { message: last, action: last.action }
        last.action = null
      }
      said = { id: newMessageId(), role: 'user', at: now(), text, where: whereOf(context) }
      answer = { id: newMessageId(), role: 'assistant', at: now() }
      conversation.messages.push(said, answer)
    }
    // (kept before the answer: the streamer's message is there if the page is loaded again meanwhile)
    if (said) saveConversation(user.id, { ...conversation, messages: conversation.messages.slice(0, -1) })

    answering.add(user.id)
    const done = nowAsking(user.id)
    let changed: string[] = []
    try {
      const turn = await assistantTurn({ thread: conversation.thread, ...(resuming ? { resume: { call: resume.call, result: resume.result ?? null } } : { text }), context, language })
      answer.reply = await hydrate(user.id, turn.reply)
      answer.steps = (Array.isArray(turn.steps) ? turn.steps : []).filter((step): step is string => typeof step === 'string').slice(-60)
      answer.cost = Number.isFinite(turn.cost) ? turn.cost : 0
      answer.action = turn.status === 'action' && turn.action ? (turn.action as AssistantAction) : null
      delete answer.failed
    } catch (err) {
      const why = failure(err)
      if (why === 'busy') {
        // (the worker is still on an earlier request of this conversation: nothing of this one is kept)
        if (dropped) dropped.message.action = dropped.action
        if (said) saveConversation(user.id, { ...conversation, messages: conversation.messages.slice(0, -2) })
        return response.conflict({ error: 'busy' })
      }
      if (why === 'failed') logger.warn({ err }, 'The assistant failed')
      answer.action = null
      answer.failed = why
    } finally {
      changed = done()
      answering.delete(user.id)
    }
    answer.at = now()
    saveConversation(user.id, conversation)
    return { message: answer, ...(said ? { said } : {}), changed }
  }

  /** GET /api/assistant/progress — what the assistant is doing right now (shown while the page waits) */
  async progress({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    if (!answering.has(user.id)) return { steps: [], running: false }
    try {
      const doing = await assistantProgress(readConversation(user.id).thread)
      return { steps: (doing.steps ?? []).slice(-60), running: !!doing.running, ...(doing.sub ? { sub: doing.sub } : {}) }
    } catch {
      return { steps: [], running: true }
    }
  }

  /** DELETE /api/assistant — a new conversation: what was said is forgotten (409: it is answering) */
  async destroy({ auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (answering.has(user.id)) return response.conflict({ error: 'busy' })
    try {
      await assistantForget(readConversation(user.id).thread)
    } catch (err) {
      if (err instanceof WorkerHttpError && err.status === 409) return response.conflict({ error: 'busy' })
      // (engine away: the new conversation has another name anyway, the old one is never read again)
    }
    startConversation(user.id)
    return { messages: [], busy: false }
  }
}
