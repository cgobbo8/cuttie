import type { HttpContext } from '@adonisjs/core/http'
import Job from '#models/job'
import { watchPlace, watchStream } from '#services/live_watch'
import { workerFailure } from '#services/worker_failure'

/** A live gone through by hand: watched from any time, to pick the passage one wants in a video */
export default class LiveWatchController {
  async #job({ params, auth }: HttpContext): Promise<Job | null> {
    const user = auth.getUserOrFail()
    return Job.query().where('id', params.id).where('user_id', user.id).first()
  }

  #time(ctx: HttpContext, job: Job): number {
    const asked = Number(ctx.request.input('t'))
    const last = Math.max(0, (job.vodDurationSeconds ?? 0) - 1)
    return Math.min(last > 0 ? last : Number.MAX_SAFE_INTEGER, Math.max(0, Number.isFinite(asked) ? asked : 0))
  }

  /**
   * GET /api/jobs/:id/watch/at?t=<seconds> — where playing really starts when this time is asked
   * for: `from`, the head of the piece of the live that holds it (a few seconds before at most).
   * The player's clock is that time plus what it has played. 410: the live left Twitch.
   */
  async at(ctx: HttpContext) {
    const job = await this.#job(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    try {
      const place = await watchPlace(job.url, this.#time(ctx, job))
      return { from: place.from, duration: job.vodDurationSeconds ?? 0 }
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
  }

  /** GET /api/jobs/:id/watch?t=<seconds> — the live's video from that time on (the time `at` gave), as a stream a player takes as it comes */
  async stream(ctx: HttpContext) {
    const job = await this.#job(ctx)
    if (!job) return ctx.response.notFound({ error: 'job not found' })
    let place: { url: string; from: number }
    try {
      place = await watchPlace(job.url, this.#time(ctx, job))
    } catch (err) {
      return workerFailure(ctx.response, err)
    }
    const { stream, stop } = watchStream(job.userId ?? 0, place.url, place.from)
    // The player went away (another time asked for, the window closed): nothing more is read from Twitch
    ctx.response.response.on('close', stop)
    ctx.response.header('Content-Type', 'video/mp4')
    ctx.response.header('Cache-Control', 'no-store')
    return ctx.response.stream(stream)
  }
}
