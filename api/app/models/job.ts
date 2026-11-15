import { JobSchema } from '#database/schema'
import { column } from '@adonisjs/lucid/orm'
import type { FacecamRect } from '#services/brand_kit'
import type { Compilation } from '#services/compilations'
import type { JobSuggestions } from '#services/suggestions'

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

  /** Things that degraded the analysis without failing it, sent by the worker */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare notices: JobNotice[] | null

  /** Webcam framing set by hand for this live: a rectangle, or false for no cam */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare facecam: FacecamRect | false | null

  /** Videos made of pieces of the live found by searching it (see services/compilations.ts) */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare compilations: Compilation[] | null

  /** What the AI proposed for this live once it was analysed (see services/suggestions.ts) */
  @column({
    prepare: (value) => (value !== null && value !== undefined ? JSON.stringify(value) : null),
    consume: (value) => (typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare suggestions: JobSuggestions | null
}

/** e.g. { kind: 'transcription', failed: 37, total: 200 } */
export interface JobNotice {
  kind: string
  [detail: string]: unknown
}

export interface TimelineCandidate {
  /** Position in the VOD, seconds */
  t: number
  state: 'pending' | 'rated' | 'kept' | 'dropped' | 'clip'
  score?: number
  name?: string
  category?: string
  /** What happens there, in a sentence (analyses made since the AI searches the live with tools) */
  what?: string
}

export interface JobTimeline {
  duration?: number
  energy?: number[]
  chat?: number[]
  candidates?: TimelineCandidate[]
  /** When the analysis started and should be done, unix seconds (worker's estimate, eta.py) */
  eta?: { start: number; end: number }
}

export interface ClipSelection {
  state?: 'kept' | 'passed'
  /** The cut, clip seconds; with `segments`, the span they cover */
  trim?: [number, number]
  /** The clip cut in several pieces played one after the other (2 or more), clip seconds */
  segments?: [number, number][]
}