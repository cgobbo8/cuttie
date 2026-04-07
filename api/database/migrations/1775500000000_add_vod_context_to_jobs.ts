import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.text('vod_context').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('vod_context')
    })
  }
}
