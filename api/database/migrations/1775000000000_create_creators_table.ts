import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'creators'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id').primary()
      table.string('twitch_id').nullable().unique()
      table.string('login').notNullable().unique()
      table.string('display_name').notNullable()
      table.string('thumbnail').nullable()
      table.integer('user_id').notNullable().references('id').inTable('users')
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
