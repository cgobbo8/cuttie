import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary() // UUID from Python worker
      table.string('url').notNullable()
      table.string('status').notNullable().defaultTo('PENDING')
      table.string('error').nullable()
      table.json('hot_points').nullable()  // array of HotPoint
      table.json('clips').nullable()       // array of clip metadata
      table.integer('progress').defaultTo(0)
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}