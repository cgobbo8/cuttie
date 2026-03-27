import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'

export default class AdminUserSeeder extends BaseSeeder {
  async run() {
    await User.firstOrCreate(
      { email: 'admin@cuttie.com' },
      { fullName: 'Admin', email: 'admin@cuttie.com', password: 'admin' }
    )
  }
}
