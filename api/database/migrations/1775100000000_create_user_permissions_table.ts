import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('user_permissions', (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('permission').notNullable()
      table.timestamp('created_at').notNullable()

      table.unique(['user_id', 'permission'])
      table.index(['user_id'])
    })

    this.schema.createTable('user_quotas', (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('key').notNullable()
      table.integer('limit').notNullable()
      table.string('period').notNullable() // 'daily' | 'monthly' | 'yearly' | 'lifetime'
      table.timestamp('created_at').notNullable()

      table.unique(['user_id', 'key'])
      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable('user_quotas')
    this.schema.dropTable('user_permissions')
  }
}
