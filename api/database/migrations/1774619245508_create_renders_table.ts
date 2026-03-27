import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'renders'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.string('id').primary()
      table.string('job_id').notNullable()
      table.string('clip_filename').notNullable()
      table.string('status').notNullable().defaultTo('rendering')
      table.float('progress').notNullable().defaultTo(0)
      table.string('output_filename').nullable()
      table.float('size_mb').nullable()
      table.text('error').nullable()
      table.datetime('created_at')
      table.datetime('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}