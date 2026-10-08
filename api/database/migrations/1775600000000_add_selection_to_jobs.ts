import { BaseSchema } from '@adonisjs/lucid/schema'

/** The streamer's choices per clip: kept / passed, and trim bounds */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('selection').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('selection')
    })
  }
}
