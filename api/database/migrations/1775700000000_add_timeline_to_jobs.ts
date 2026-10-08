import { BaseSchema } from '@adonisjs/lucid/schema'

/** Live view of the analysis: intensity curve, chat activity, rated candidates */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.json('timeline').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('timeline')
    })
  }
}
