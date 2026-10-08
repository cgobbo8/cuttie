import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'

export default class AuthMeController {
  async show({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()

    const permissionRows = await db
      .from('user_permissions')
      .where('user_id', user.id)
      .select('permission')

    const quotaRows = await db
      .from('user_quotas')
      .where('user_id', user.id)
      .select('key', 'limit', 'period')

    return serialize({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        initials: user.initials,
        permissions: permissionRows.map((r) => r.permission),
        quotas: quotaRows.map((r) => ({ key: r.key, limit: r.limit, period: r.period })),
      },
    })
  }
}
