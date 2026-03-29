/**
 * Central registry of all permissions used in the app.
 *
 * Format: `domain:action`
 * Wildcards: `*` (all), `domain:*` (all actions in domain)
 *
 * Domains:
 * - editor-ai   AI assistant in the editor
 * - ai          Global AI features (future)
 * - jobs        Analyses / projects
 * - clips       Clips
 * - editor      Editor features
 * - renders     Exports
 * - assets      Assets (images, overlays)
 * - creators    Creators
 */
export const Permissions = {
  // ── Editor AI ──────────────────────────────────────────────────────────────
  EDITOR_AI_READ: 'editor-ai:read',
  EDITOR_AI_WRITE: 'editor-ai:write',

  // ── Editor ─────────────────────────────────────────────────────────────────
  EDITOR_READ: 'editor:read',
  EDITOR_WRITE: 'editor:write',
  EDITOR_EXPORT: 'editor:export',

  // ── Jobs ───────────────────────────────────────────────────────────────────
  JOBS_READ: 'jobs:read',
  JOBS_WRITE: 'jobs:write',
  JOBS_DELETE: 'jobs:delete',

  // ── Clips ──────────────────────────────────────────────────────────────────
  CLIPS_READ: 'clips:read',
  CLIPS_WRITE: 'clips:write',

  // ── Renders ────────────────────────────────────────────────────────────────
  RENDERS_READ: 'renders:read',
  RENDERS_WRITE: 'renders:write',
  RENDERS_DELETE: 'renders:delete',

  // ── Assets ─────────────────────────────────────────────────────────────────
  ASSETS_READ: 'assets:read',
  ASSETS_WRITE: 'assets:write',
  ASSETS_DELETE: 'assets:delete',

  // ── Creators ───────────────────────────────────────────────────────────────
  CREATORS_READ: 'creators:read',
  CREATORS_WRITE: 'creators:write',
} as const

export type Permission = (typeof Permissions)[keyof typeof Permissions]

/**
 * All available quota keys.
 */
export const Quotas = {
  JOBS: 'jobs',
  RENDERS: 'renders',
} as const

export type QuotaKey = (typeof Quotas)[keyof typeof Quotas]
