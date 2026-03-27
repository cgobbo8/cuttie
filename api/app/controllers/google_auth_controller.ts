import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import User from '#models/user'

const FRONTEND_URL = env.get('FRONTEND_URL', 'http://localhost:5173')

export default class GoogleAuthController {
  /** GET /api/auth/google/redirect — start OAuth flow */
  async redirect({ ally }: HttpContext) {
    return ally.use('google').redirect()
  }

  /** GET /api/auth/google/callback — Google redirects here */
  async callback({ ally, auth, session, response }: HttpContext) {
    const google = ally.use('google')

    if (google.accessDenied()) {
      return response.redirect(`${FRONTEND_URL}/login?error=access_denied`)
    }

    if (google.stateMisMatch()) {
      return response.redirect(`${FRONTEND_URL}/login?error=state_mismatch`)
    }

    if (google.hasError()) {
      return response.redirect(`${FRONTEND_URL}/login?error=${google.getError()}`)
    }

    let googleUser
    try {
      googleUser = await google.user()
    } catch (err) {
      console.error('[Google OAuth] Token exchange failed:', err.message)
      return response.redirect(`${FRONTEND_URL}/login?error=token_exchange_failed`)
    }

    // Find or create user by email
    const user = await User.firstOrCreate(
      { email: googleUser.email! },
      {
        fullName: googleUser.name ?? googleUser.email!.split('@')[0],
        email: googleUser.email!,
        // Random password — user authenticates via Google, not password
        password: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      }
    )

    // Log in via session (cookie set automatically)
    await auth.use('web').login(user)

    // Tag session with user ID for remote revocation
    if (session.supportsTagging()) {
      await session.tag(String(user.id))
    }

    // Redirect to frontend — no token in URL!
    return response.redirect(`${FRONTEND_URL}/`)
  }
}
