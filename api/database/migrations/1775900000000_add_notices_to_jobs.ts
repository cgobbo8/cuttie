import { BaseSchema } from '@adonisjs/lucid/schema'

/** Things that degraded an analysis without failing it (e.g. segments Whisper could not transcribe) */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('notices').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('notices')
    })
  }
}
