import { BaseSchema } from '@adonisjs/lucid/schema'
import hash from '@adonisjs/core/services/hash'

export default class extends BaseSchema {
  async up() {
    // 1. Add user_id column to jobs and renders
    this.schema.alterTable('jobs', (table) => {
      table.integer('user_id').nullable().unsigned()
    })

    this.schema.alterTable('renders', (table) => {
      table.integer('user_id').nullable().unsigned()
    })

    // 2. Create admin user and backfill existing data
    this.defer(async (db) => {
      // Check if admin already exists
      const existing = await db.from('users').where('email', 'admin@cuttie.com').first()

      let adminId: number
      if (existing) {
        adminId = existing.id
      } else {
        const hashedPassword = await hash.make('admin')
        const [id] = await db.table('users').insert({
          full_name: 'Admin',
          email: 'admin@cuttie.com',
          password: hashedPassword,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        adminId = id
      }

      // 3. Assign all existing jobs and renders to admin
      await db.from('jobs').whereNull('user_id').update({ user_id: adminId })
      await db.from('renders').whereNull('user_id').update({ user_id: adminId })
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('user_id')
    })

    this.schema.alterTable('renders', (table) => {
      table.dropColumn('user_id')
    })
  }
}
