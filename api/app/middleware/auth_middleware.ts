import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { tryLocalAutoLogin } from '#services/local_user'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users. In the local desktop app, requests from
 * the app itself are signed in as the local user instead.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    try {
      await ctx.auth.authenticateUsing(options.guards)
    } catch (error) {
      if (!(await tryLocalAutoLogin(ctx))) throw error
    }
    return next()
  }
}
