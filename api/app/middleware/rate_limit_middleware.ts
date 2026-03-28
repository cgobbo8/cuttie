import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Simple in-memory sliding window rate limiter.
 * Limits requests per IP address within a configurable time window.
 *
 * Not suitable for multi-process/clustered deployments — use Redis-backed
 * rate limiting (e.g. @adonisjs/limiter) for production at scale.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 15 * 60 * 1000)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}, 5 * 60 * 1000).unref()

export default class RateLimitMiddleware {
  /**
   * @param maxRequests - Maximum requests allowed within the window
   * @param windowMs - Time window in milliseconds
   */
  constructor(
    private maxRequests: number = 10,
    private windowMs: number = 15 * 60 * 1000
  ) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const ip = ctx.request.ip()
    const key = `${ip}:${ctx.request.url()}`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry) {
      entry = { timestamps: [] }
      store.set(key, entry)
    }

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => now - t < this.windowMs)

    if (entry.timestamps.length >= this.maxRequests) {
      const retryAfter = Math.ceil((entry.timestamps[0]! + this.windowMs - now) / 1000)
      ctx.response.header('Retry-After', String(retryAfter))
      ctx.response.header('X-RateLimit-Limit', String(this.maxRequests))
      ctx.response.header('X-RateLimit-Remaining', '0')
      return ctx.response.tooManyRequests({
        error: 'Too many requests. Please try again later.',
        code: 'RATE_LIMITED',
      })
    }

    entry.timestamps.push(now)

    ctx.response.header('X-RateLimit-Limit', String(this.maxRequests))
    ctx.response.header('X-RateLimit-Remaining', String(this.maxRequests - entry.timestamps.length))

    return next()
  }
}

/**
 * Factory to create rate limit middleware with custom options.
 * Usage in routes: .use(rateLimit(5, 15 * 60 * 1000))
 */
export function rateLimit(maxRequests: number = 10, windowMs: number = 15 * 60 * 1000) {
  const instance = new RateLimitMiddleware(maxRequests, windowMs)
  return async (ctx: HttpContext, next: NextFn) => instance.handle(ctx, next)
}
