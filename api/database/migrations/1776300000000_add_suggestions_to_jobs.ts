import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The videos the AI proposed for a live once it was analysed (JSON: when, the ideas already
 * proposed, what it said; see services/suggestions.ts). The proposed videos themselves are
 * compilations; this remembers what was proposed so that an idea deleted is not proposed again.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('suggestions').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('suggestions')
    })
  }
}
