import { BaseSchema } from '@adonisjs/lucid/schema'

/** Videos made of pieces of the live found by searching it (JSON: sections of moments, see services/compilations.ts) */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('compilations').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('compilations')
    })
  }
}
