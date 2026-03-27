import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('vod_title').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('vod_title')
    })
  }
}