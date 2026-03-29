import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import accessControl from '#services/access_control'

/**
 * Access middleware — checks that the authenticated user has the required permission.
 * Usage in routes: `.use(middleware.access('ai:write'))`
 */
export default class AccessMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { permission: string }) {
    const user = ctx.auth.getUserOrFail()
    const allowed = await accessControl.can(user, options.permission)

    if (!allowed) {
      return ctx.response.status(403).json({
        error: 'Forbidden',
        message: `Missing permission: ${options.permission}`,
      })
    }

    return next()
  }
}
