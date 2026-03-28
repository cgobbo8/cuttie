import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  async up() {
    // 1. Create streamers table
    this.schema.createTable('streamers', (table) => {
      table.increments('id')
      table.string('twitch_login').notNullable() // e.g. "kamet0"
      table.string('display_name').notNullable() // e.g. "Kamet0"
      table.string('avatar_url').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })

    // 2. Create user_streamers pivot table (many-to-many)
    this.schema.createTable('user_streamers', (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.integer('streamer_id').unsigned().notNullable().references('id').inTable('streamers').onDelete('CASCADE')
      table.unique(['user_id', 'streamer_id'])
      table.timestamp('created_at').notNullable()
    })

    // 3. Add streamer_id to jobs and renders
    this.schema.alterTable('jobs', (table) => {
      table.integer('streamer_id').nullable().unsigned().references('id').inTable('streamers').onDelete('SET NULL')
    })

    this.schema.alterTable('renders', (table) => {
      table.integer('streamer_id').nullable().unsigned().references('id').inTable('streamers').onDelete('SET NULL')
    })

    // 4. Backfill: create streamers from existing jobs and link them
    this.defer(async (db) => {
      // Get distinct streamer names from jobs
      const streamerNames = await db
        .from('jobs')
        .whereNotNull('streamer')
        .where('streamer', '!=', '')
        .distinct('streamer')
        .select('streamer')

      const now = new Date().toISOString()

      for (const row of streamerNames) {
        const name = row.streamer as string
        const login = name.toLowerCase().replace(/\s+/g, '')

        // Create the streamer
        const [streamerId] = await db.table('streamers').insert({
          twitch_login: login,
          display_name: name,
          created_at: now,
          updated_at: now,
        })

        // Link this streamer to all users who have jobs with this streamer name
        const userIds = await db
          .from('jobs')
          .where('streamer', name)
          .whereNotNull('user_id')
          .distinct('user_id')
          .select('user_id')

        for (const u of userIds) {
          await db.table('user_streamers').insert({
            user_id: u.user_id,
            streamer_id: streamerId,
            created_at: now,
          }).catch(() => {}) // ignore duplicate
        }

        // Update jobs with the streamer_id
        await db.from('jobs').where('streamer', name).update({ streamer_id: streamerId })

        // Update renders linked to those jobs
        await db
          .rawQuery(
            `UPDATE renders SET streamer_id = ? WHERE job_id IN (SELECT id FROM jobs WHERE streamer = ?)`,
            [streamerId, name]
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

    this.schema.dropTable('user_streamers')
    this.schema.dropTable('streamers')
  }
}
