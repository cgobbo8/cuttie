import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // 1. Create streamers table — each streamer belongs to ONE user
    this.schema.createTable('streamers', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('twitch_login').notNullable() // e.g. "squeezie" — shared Twitch identity (data only)
      table.string('display_name').notNullable() // e.g. "Squeezie"
      table.string('avatar_url').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    // 2. Add streamer_id to jobs and renders
    this.schema.alterTable('jobs', (table) => {
      table.integer('streamer_id').nullable().unsigned().references('id').inTable('streamers').onDelete('SET NULL')
    })

    this.schema.alterTable('renders', (table) => {
      table.integer('streamer_id').nullable().unsigned().references('id').inTable('streamers').onDelete('SET NULL')
    })

    // 3. Backfill: create one streamer per (user_id, streamer_name) pair
    this.defer(async (db) => {
      const pairs = await db
        .from('jobs')
        .whereNotNull('streamer')
        .where('streamer', '!=', '')
        .whereNotNull('user_id')
        .distinct('user_id', 'streamer')
        .select('user_id', 'streamer')

      const now = new Date().toISOString()

      for (const row of pairs) {
        const name = row.streamer as string
        const userId = row.user_id as number
        const login = name.toLowerCase().replace(/\s+/g, '')

        // Create a streamer for this user
        const [streamerId] = await db.table('streamers').insert({
          user_id: userId,
          twitch_login: login,
          display_name: name,
          created_at: now,
          updated_at: now,
        })

        // Update jobs for this (user_id, streamer) pair
        await db
          .from('jobs')
          .where('user_id', userId)
          .where('streamer', name)
          .update({ streamer_id: streamerId })

        // Update renders linked to those jobs
        await db.rawQuery(
          `UPDATE renders SET streamer_id = ? WHERE job_id IN (SELECT id FROM jobs WHERE user_id = ? AND streamer = ?)`,
          [streamerId, userId, name]
        )
      }
    })
  }

  async down() {
    this.schema.alterTable('renders', (table) => {
      table.dropColumn('streamer_id')
    })

    this.schema.alterTable('jobs', (table) => {
      table.dropColumn('streamer_id')
    })

    this.schema.dropTable('streamers')
  }
}
