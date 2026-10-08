import { JobSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'
import type { FacecamRect } from '#services/brand_kit'

export default class Job extends JobSchema {
  static selfAssignPrimaryKey = true

  @column()
  declare userId: number | null

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

  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare vodContext: any | null

  /** Per clip filename: kept / passed, and trim bounds in clip seconds */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare selection: Record<string, ClipSelection> | null

  /** Live view of the analysis (see backend/app/services/timeline.py) */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare timeline: JobTimeline | null

  /** Webcam framing set by hand for this live: a rectangle, or false for no cam */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare facecam: FacecamRect | false | null
}

export interface TimelineCandidate {
  /** Position in the VOD, seconds */
  t: number
  state: 'pending' | 'rated' | 'kept' | 'dropped' | 'clip'
  score?: number
  name?: string
  category?: string
}

export interface JobTimeline {
  duration?: number
  energy?: number[]
  chat?: number[]
  candidates?: TimelineCandidate[]
}

export interface ClipSelection {
  state?: 'kept' | 'passed'
  trim?: [number, number]
}