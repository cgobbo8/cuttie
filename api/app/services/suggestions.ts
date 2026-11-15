/**
 * Compilations the AI proposes on its own once a live is analysed.
 *
 * The worker looks through the live (live_ideas.py: what is said again and again, the same
 * thing happening many times, a story the live tells) and gives a few ideas, each with the
 * request a streamer would have typed to get that video. Each idea becomes a compilation
 * that waits: its name, that request as its description (`brief`), and what the AI saw
 * (`suggestion`: why, tags, how well it should do, the moments spotted). Nothing is built
 * yet: the video is planned from the request when the streamer opens it, like any video
 * they describe, and they go on from there.
 *
 * Finding the ideas costs under a cent; building a video (a few cents) is only paid for the
 * ideas that get opened.
 */

import { randomBytes } from 'node:crypto'
import logger from '@adonisjs/core/services/logger'
import transmit from '@adonisjs/transmit/services/main'
import Job from '#models/job'
import { getBrandKit } from '#services/brand_kit'
import { MAX_COMPILATIONS, isIntro, isWaiting, type Compilation } from '#services/compilations'
import { isMusicKind } from '#services/musics'
import { WorkerUnavailableError, findLiveIdeas, type LiveContext, type LiveIdea } from '#services/worker_client'

/** What a live was proposed, kept with it (jobs.suggestions) */
export interface JobSuggestions {
  /** When the live was last looked through */
  at: string
  /** Every idea proposed so far (their keys): one that was deleted is not proposed again */
  keys: string[]
  /** What the AI said of the live, in its words */
  note: string
}

const newId = () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 10)

/** What the AI works from besides the transcript: the live's length, its voice energy, who and what, where to listen to it */
export function liveContext(job: Job): LiveContext {
  return {
    duration: job.vodDurationSeconds ?? 0,
    energy: job.timeline?.energy ?? null,
    meta: { streamer: job.streamer, game: job.vodGame, title: job.customTitle || job.vodTitle, date: job.streamDate ?? null },
    url: job.url,
    // The 50 or so candidates the analysis rated, clipped or not: the worker only kept the clipped ones
    moments: job.timeline?.candidates ?? [],
  }
}

/** Compilations of a live that wait to be built: proposed by the AI, never opened */
export const waitingCount = (compilations: Compilation[] | null | undefined): number => (compilations ?? []).filter(isWaiting).length

/**
 * The ideas the worker gave as compilations that wait to be built: those never proposed for
 * this live (`known`: the keys of what was), the best first, no more than there is `room` for.
 * `intro`: the intro the streamer prefers, as on any new compilation.
 */
export function proposed(ideas: LiveIdea[], known: Set<string>, room: number, intro: string | null = null, now = new Date().toISOString()): Compilation[] {
  const made: Compilation[] = []
  const seen = new Set(known)
  for (const idea of ideas) {
    if (made.length >= room) break
    const key = typeof idea?.key === 'string' ? idea.key.slice(0, 40) : ''
    const name = typeof idea?.title === 'string' ? idea.title.trim().slice(0, 80) : ''
    const brief = typeof idea?.brief === 'string' ? idea.brief.trim().slice(0, 4000) : ''
    const score = Number(idea?.score)
    if (!key || seen.has(key) || !name || !brief || !Number.isFinite(score)) continue
    seen.add(key)
    const seconds = Number(idea.seconds)
    made.push({
      id: newId(),
      name,
      sections: [{ id: newId(), title: '', query: '', items: [] }],
      template: null,
      titles: true,
      hook: '',
      target: Number.isFinite(seconds) && seconds >= 5 && seconds <= 1800 ? Math.round(seconds) : 45,
      ...(intro && isIntro(intro) ? { intro: { style: intro } } : {}),
      brief,
      suggestion: {
        key,
        pitch: typeof idea.pitch === 'string' ? idea.pitch.trim().slice(0, 280) : '',
        tags: (Array.isArray(idea.tags) ? idea.tags : []).filter((tag): tag is string => typeof tag === 'string' && !!tag.trim()).map((tag) => tag.trim().slice(0, 24)).slice(0, 4),
        ...(isMusicKind(idea.kind) ? { kind: idea.kind } : {}),
        score: Math.round(Math.min(100, Math.max(0, score))),
        moments: (Array.isArray(idea.moments) ? idea.moments : []).filter((at): at is number => Number.isFinite(at) && at >= 0).slice(0, 40),
      },
      created_at: now,
      updated_at: now,
    })
  }
  return made
}

export interface Suggested {
  /** The compilations just proposed (none when the live was already looked through, or has nothing) */
  created: Compilation[]
  /** Ideas the AI gave in all, those already proposed included */
  found: number
  note: string
  cost: number
  cached: boolean
}

// One look through a live at a time (the end of its analysis and the streamer asking may meet)
const running = new Map<string, Promise<Suggested>>()

/** The AI is looking through this live right now */
export const isLooking = (jobId: string): boolean => running.has(jobId)

/**
 * Has the AI look through an analysed live and keeps what it proposes as compilations that
 * wait to be built. Asked again, the same live answers from the worker's disk and nothing is
 * proposed twice. Throws what the worker throws (engine away, no transcript, no credits).
 */
export function suggestCompilations(jobId: string): Promise<Suggested> {
  const already = running.get(jobId)
  if (already) return already
  const run = look(jobId).finally(() => running.delete(jobId))
  running.set(jobId, run)
  return run
}

async function look(jobId: string): Promise<Suggested> {
  const asked = await Job.find(jobId)
  if (!asked) throw new Error('job not found')
  const answer = await findLiveIdeas(jobId, liveContext(asked))
  // Read again: the look takes half a minute, and the streamer may have saved a compilation meanwhile
  const job = await Job.find(jobId)
  if (!job) throw new Error('job not found')
  const existing = job.compilations ?? []
  const known = new Set([...(job.suggestions?.keys ?? []), ...existing.flatMap((c) => (c.suggestion ? [c.suggestion.key] : []))])
  const created = proposed(answer.ideas ?? [], known, MAX_COMPILATIONS - existing.length, (await getBrandKit()).intro ?? null)
  job.compilations = [...existing, ...created]
  job.suggestions = { at: new Date().toISOString(), keys: [...known, ...created.map((c) => c.suggestion!.key)], note: String(answer.note ?? '').slice(0, 800) }
  await job.save()
  if (created.length > 0) {
    // Whoever has this live on screen learns it has videos to propose
    transmit.broadcast(`jobs/${jobId}`, { job_id: jobId, type: 'suggestions', count: created.length, suggested: waitingCount(job.compilations) })
  }
  return { created, found: (answer.ideas ?? []).length, note: job.suggestions.note, cost: answer.cost ?? 0, cached: !!answer.cached }
}

/**
 * A live has just been analysed: the AI looks through it for videos to propose, in the
 * background. Nothing here may fail the analysis: what goes wrong is only written down.
 */
export function afterAnalysis(jobId: string): void {
  suggestCompilations(jobId).then(
    (done) => logger.info(`[${jobId.slice(0, 8)}] ${done.created.length} compilation(s) proposed by the AI (${done.found} idea(s), ~${done.cost.toFixed(4)} $)`),
    (err) => {
      // No engine (tests, the app closing): nothing to say
      if (!(err instanceof WorkerUnavailableError)) logger.warn(`[${jobId.slice(0, 8)}] no compilation proposed: ${err instanceof Error ? err.message : err}`)
    }
  )
}
