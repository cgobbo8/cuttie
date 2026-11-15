import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * The "sticker" intro is gone (the "hook" intro took its place in the picker): the videos that
 * opened on it open on "bands" from now on, rather than on nothing. `jobs.compilations` is JSON
 * as the model writes it (no space after a colon).
 */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db.rawQuery(`UPDATE jobs SET compilations = REPLACE(compilations, '"style":"sticker"', '"style":"bands"') WHERE compilations LIKE '%"style":"sticker"%'`)
    })
  }

  async down() {
    // Which videos had it is not kept: nothing to put back
  }
}
