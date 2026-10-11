import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Raw updates once wrote ISO text ("2026-10-10T23:25:06.123Z") in jobs' times,
 * where Lucid writes and reads "2026-10-10 23:25:06" (UTC): put them back in
 * Lucid's format, or the model sees an invalid date.
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      for (const column of ['created_at', 'updated_at']) {
        await db.rawQuery(`UPDATE jobs SET ${column} = replace(substr(${column}, 1, 19), 'T', ' ') WHERE ${column} LIKE '____-__-__T%'`)
      }
    })
  }

  async down() {}
}
