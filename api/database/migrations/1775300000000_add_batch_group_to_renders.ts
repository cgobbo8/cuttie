import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('renders', (table) => {
      table.string('batch_group_id').nullable()
      table.index(['batch_group_id'])
    })
  }

  async down() {
    this.schema.alterTable('renders', (table) => {
      table.dropIndex(['batch_group_id'])
      table.dropColumn('batch_group_id')
    })
  }
}
