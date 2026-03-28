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

        // Games
        router.get('/games', [() => import('#controllers/games_controller'), 'index'])

        // Jobs
        router.post('/analyze', [() => import('#controllers/jobs_controller'), 'store'])
        router.get('/jobs', [() => import('#controllers/jobs_controller'), 'index'])
        router.get('/jobs/:id', [() => import('#controllers/jobs_controller'), 'show'])
        router.post('/jobs/:id/retry', [() => import('#controllers/jobs_controller'), 'retry'])
        router.delete('/jobs/:id', [() => import('#controllers/jobs_controller'), 'destroy'])
        router.get('/jobs/:id/sse', [() => import('#controllers/jobs_controller'), 'stream'])
        router.patch('/jobs/:id/clips/:clipFilename/name', [() => import('#controllers/jobs_controller'), 'renameClip'])

        // Clips
        router.get('/clips/:jobId/:filename/edit-env', [() => import('#controllers/clips_controller'), 'editEnv'])
        router.get('/clips/:jobId/:filename', [() => import('#controllers/clips_controller'), 'show'])

        // Assets
        router.get('/assets', [() => import('#controllers/assets_controller'), 'index'])
        router.post('/assets/upload', [() => import('#controllers/assets_controller'), 'store'])
        router.get('/assets/:filename', [() => import('#controllers/assets_controller'), 'show'])

        // Renders
        router.post('/clips/:jobId/:filename/render', [() => import('#controllers/renders_controller'), 'store'])
        router.get('/renders', [() => import('#controllers/renders_controller'), 'index'])
        router.get('/renders/:renderId', [() => import('#controllers/renders_controller'), 'show'])
        router.get('/renders/:renderId/download', [() => import('#controllers/renders_controller'), 'download'])
        router.delete('/renders/:renderId', [() => import('#controllers/renders_controller'), 'destroy'])
      })
      .use(middleware.auth())
  })
  .prefix('/api')
