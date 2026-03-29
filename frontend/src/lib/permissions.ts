/**
 * Central registry of all permissions — mirrors api/app/services/permissions.ts
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
