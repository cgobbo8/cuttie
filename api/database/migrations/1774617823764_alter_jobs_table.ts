import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'jobs'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.float('vod_duration_seconds').nullable()
      table.string('vod_game').nullable()
      table.string('streamer').nullable()
      table.integer('view_count').nullable()
      table.string('stream_date').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('vod_duration_seconds')
      table.dropColumn('vod_game')
      table.dropColumn('streamer')
      table.dropColumn('view_count')
      table.dropColumn('stream_date')
    })
  }
}
