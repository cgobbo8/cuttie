import { BaseSchema } from '@adonisjs/lucid/schema'

/** When a project's clips were deleted to free disk space (its exports stay; null = clips there) */
export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('jobs', (table) => {
      table.timestamp('clips_freed_at').nullable()
    })
  }

  async down() {
    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('clips_freed_at')
    })
  }
}
