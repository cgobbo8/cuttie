import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class AccessTokenController {
  async store({ request, auth, session, serialize }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.verifyCredentials(email, password)

    await auth.use('web').login(user)

    // Tag session with user ID for remote revocation
    if (session.supportsTagging()) {
      await session.tag(String(user.id))
    }

    return serialize({
      user: UserTransformer.transform(user),
    })
  }

  async destroy({ auth, session, response }: HttpContext) {
    const user = auth.user
    if (user && session.supportsTagging()) {
      await session.untag(String(user.id))
    }

    await auth.use('web').logout()
    return response.json({ message: 'Logged out successfully' })
  }
}
