import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as vineErrors } from '@vinejs/vine'
import { errors as authErrors } from '@adonisjs/auth'

export default class HttpExceptionHandler extends ExceptionHandler {
  /**
   * In debug mode, the exception handler will display verbose errors
   * with pretty printed stack traces.
   */
  protected debug = !app.inProduction

  /**
   * The method is used for handling errors and returning
   * response to the client
   */
  async handle(error: unknown, ctx: HttpContext) {
    // VineJS validation errors — flatten to a single human-readable message
    if (error instanceof vineErrors.E_VALIDATION_ERROR) {
      const firstMessage = error.messages?.[0]?.message ?? 'Validation failed'
      return ctx.response.unprocessableEntity({ error: firstMessage, code: 'VALIDATION_ERROR' })
    }

    // AdonisJS auth errors — unauthorized
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.unauthorized({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    return super.handle(error, ctx)
  }

  /**
   * The method is used to report error to the logging service or
   * the a third party error monitoring service.
   *
   * @note You should not attempt to send a response from this method.
   */
  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
