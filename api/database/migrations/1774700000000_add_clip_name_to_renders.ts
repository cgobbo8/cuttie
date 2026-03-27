import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'renders'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.string('clip_name').nullable()
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('clip_name')
    })
  }
}
