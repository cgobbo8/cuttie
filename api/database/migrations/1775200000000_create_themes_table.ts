import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.createTable('themes', (table) => {
      table.increments('id').notNullable()
      table.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('name').notNullable()
      table.json('layers').notNullable()
      table.boolean('is_default').notNullable().defaultTo(false)
      table.boolean('built_in').notNullable().defaultTo(false)
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()

      table.index(['user_id'])
    })
  }

  async down() {
    this.schema.dropTable('themes')
  }
}
