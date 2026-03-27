import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Flexible auth middleware — accepts Bearer token from either:
 * 1. Authorization header (standard)
 * 2. ?token= query parameter (for EventSource, <video src>, <img src>)
 *
 * The silent_auth_middleware runs globally before route middleware and caches
 * the auth result. If the token is only in the query param, silent_auth won't
 * find it. We work around this by injecting the header and resetting the
 * guard's internal "attempted" flag so it re-reads the header.
 */
export default class SseAuthMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    // If already authenticated via header (silent_auth picked it up), proceed
    if (ctx.auth.isAuthenticated) {
      return next()
    }

    // Try query param token — inject it as Authorization header
    const token = ctx.request.input('token') as string | undefined
    if (token) {
      ctx.request.request.headers.authorization = `Bearer ${token}`

      // Reset the guard's "attempted" flag so it re-reads the header
      const guard = ctx.auth.use('api') as any
      guard.authenticationAttempted = false
    }

    await ctx.auth.authenticateUsing(['api'])
    return next()
  }
}
