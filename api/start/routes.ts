/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'
import { rateLimit } from '#middleware/rate_limit_middleware'
import { Permissions } from '#services/permissions'

router.get('/', () => {
  return { status: 'ok' }
})

// Rate limit: 5 login attempts per 15 minutes per IP
const authRateLimit = rateLimit(5, 15 * 60 * 1000)

router
  .group(() => {
    // ── Auth (public, rate-limited) ────────────────────────────────────────
    router.post('/auth/login', [() => import('#controllers/access_token_controller'), 'store']).use(authRateLimit)
    router.get('/auth/google/redirect', [() => import('#controllers/google_auth_controller'), 'redirect'])
    router.get('/auth/google/callback', [() => import('#controllers/google_auth_controller'), 'callback']).use(authRateLimit)

    // ── All protected routes (session cookie auth) ─────────────────────────
    router
      .group(() => {
        // Auth
        router.delete('/auth/logout', [() => import('#controllers/access_token_controller'), 'destroy'])
        router.get('/auth/me', [() => import('#controllers/auth_me_controller'), 'show'])

        // Dashboard
        router.get('/dashboard', [() => import('#controllers/dashboard_controller'), 'index'])

        // Games
        router.get('/games', [() => import('#controllers/games_controller'), 'index'])

        // Creators
        router.get('/creators', [() => import('#controllers/creators_controller'), 'index'])

        // Jobs
        router.post('/analyze', [() => import('#controllers/jobs_controller'), 'store'])
        router.post('/jobs/:id/add-clip', [() => import('#controllers/jobs_controller'), 'addClip'])
        router.get('/jobs', [() => import('#controllers/jobs_controller'), 'index'])
        router.get('/jobs/:id', [() => import('#controllers/jobs_controller'), 'show'])
        router.post('/jobs/:id/retry', [() => import('#controllers/jobs_controller'), 'retry'])
        router.delete('/jobs/:id', [() => import('#controllers/jobs_controller'), 'destroy'])
        router.get('/jobs/:id/sse', [() => import('#controllers/jobs_controller'), 'stream'])
        router.patch('/jobs/:id/clips/:clipFilename/name', [() => import('#controllers/jobs_controller'), 'renameClip'])
        router.post('/jobs/:jobId/batch-render', [() => import('#controllers/renders_controller'), 'batchStore'])

        // Clips
        router.get('/clips/:jobId/:filename/edit-env', [() => import('#controllers/clips_controller'), 'editEnv'])
        router.get('/clips/:jobId/:filename', [() => import('#controllers/clips_controller'), 'show'])

        // Assets
        router.get('/assets', [() => import('#controllers/assets_controller'), 'index'])
        router.post('/assets/upload', [() => import('#controllers/assets_controller'), 'store'])
        router.get('/assets/:filename', [() => import('#controllers/assets_controller'), 'show'])

        // AI Editor
        router.post('/ai/editor/chat', [() => import('#controllers/ai_editor_controller'), 'chat']).use(rateLimit(20, 60 * 1000)).use(middleware.access({ permission: Permissions.EDITOR_AI_WRITE }))

        // Themes
        router.get('/themes', [() => import('#controllers/themes_controller'), 'index'])
        router.post('/themes', [() => import('#controllers/themes_controller'), 'store'])
        router.patch('/themes/:id', [() => import('#controllers/themes_controller'), 'update'])
        router.delete('/themes/:id', [() => import('#controllers/themes_controller'), 'destroy'])
        router.post('/themes/:id/default', [() => import('#controllers/themes_controller'), 'setDefault'])

        // Renders
        router.post('/clips/:jobId/:filename/render', [() => import('#controllers/renders_controller'), 'store'])
        router.get('/renders', [() => import('#controllers/renders_controller'), 'index'])
        router.get('/renders/batch/:batchGroupId/download', [() => import('#controllers/renders_controller'), 'batchDownload'])
        router.get('/renders/:renderId', [() => import('#controllers/renders_controller'), 'show'])
        router.get('/renders/:renderId/download', [() => import('#controllers/renders_controller'), 'download'])
        router.delete('/renders/:renderId', [() => import('#controllers/renders_controller'), 'destroy'])
      })
      .use(middleware.auth())
  })
  .prefix('/api')
