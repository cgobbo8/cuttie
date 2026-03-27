import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'

export default class AuthMeController {
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    return serialize({ user: UserTransformer.transform(user) })
  }
}
