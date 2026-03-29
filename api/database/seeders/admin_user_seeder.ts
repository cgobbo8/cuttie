import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'

export default class AdminUserSeeder extends BaseSeeder {
  async run() {
    const user = await User.firstOrCreate(
      { email: 'admin@cuttie.com' },
      { fullName: 'Admin', email: 'admin@cuttie.com', password: 'admin' }
    )

    // Grant wildcard permission (admin = access to everything)
    await db
      .insertQuery()
      .table('user_permissions')
      .insert({ user_id: user.id, permission: '*', created_at: new Date().toISOString() })
      .onConflict(['user_id', 'permission'])
      .ignore()
  }
}
