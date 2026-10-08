import { BaseSchema } from '@adonisjs/lucid/schema'

/** Webcam framing set by hand for this live (overrides the usual position) */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('facecam').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('facecam')
    })
  }
}
