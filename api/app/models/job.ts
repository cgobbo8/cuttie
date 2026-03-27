import { JobSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'

export default class Job extends JobSchema {
  static selfAssignPrimaryKey = true

  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare hotPoints: any[] | null

  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare clips: any[] | null

  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare stepTimings: Record<string, { start: number; duration_seconds: number | null }> | null
}