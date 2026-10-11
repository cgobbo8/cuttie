/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'
import transmit from '@adonisjs/transmit/services/main'
import { middleware } from '#start/kernel'
import { rateLimit } from '#middleware/rate_limit_middleware'
import { Permissions } from '#services/permissions'

// Register Transmit SSE routes (/__transmit/events, subscribe, unsubscribe)
transmit.registerRoutes()

const SpaController = () => import('#controllers/spa_controller')

// Rate limit: 5 login attempts per 15 minutes per IP
const authRateLimit = rateLimit(5, 15 * 60 * 1000)

router
  .group(() => {
    // ── Local app (public) ──────────────────────────────────────────────────
    router.get('/app/info', [() => import('#controllers/app_controller'), 'info'])
    // Signed URLs (see services/storage.ts) — no session needed for <video>/<img>/Remotion
    router.get('/storage/*', [() => import('#controllers/storage_controller'), 'show'])
    // Status events pushed by the Python worker (shared-secret auth)
    router.post('/internal/worker-events', [() => import('#controllers/internal_controller'), 'workerEvents'])

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

        // Brand kit (streamer DA) + their Twitch channel
        router.get('/brand-kit', [() => import('#controllers/brand_controller'), 'show'])
        router.put('/brand-kit', [() => import('#controllers/brand_controller'), 'update'])
        router.post('/brand-kit/detect-colors', [() => import('#controllers/brand_controller'), 'detectColors'])
        router.post('/brand-kit/detect-facecam', [() => import('#controllers/brand_controller'), 'detectFacecam'])
        router.get('/brand-kit/frame', [() => import('#controllers/brand_controller'), 'frame'])
        router.get('/twitch/channel', [() => import('#controllers/brand_controller'), 'channel'])
        router.get('/twitch/lookup', [() => import('#controllers/brand_controller'), 'lookup'])
        router.get('/twitch/lookup/colors', [() => import('#controllers/brand_controller'), 'lookupColors'])
        router.get('/twitch/vods/:id/storyboard', [() => import('#controllers/brand_controller'), 'storyboard'])

        // Local app: settings (API keys) + diagnostics
        router.get('/settings', [() => import('#controllers/app_controller'), 'showSettings'])
        router.put('/settings', [() => import('#controllers/app_controller'), 'updateSettings'])
        router.post('/settings/verify', [() => import('#controllers/app_controller'), 'verifyKey'])
        router.get('/diagnostics', [() => import('#controllers/app_controller'), 'diagnostics'])
        router.get('/machine', [() => import('#controllers/app_controller'), 'machine'])
        router.post('/diagnostics/local-test', [() => import('#controllers/app_controller'), 'localTest'])

        // Games
        router.get('/games', [() => import('#controllers/games_controller'), 'index'])

        // Creators
        router.get('/creators', [() => import('#controllers/creators_controller'), 'index'])

        // Jobs
        router.post('/analyze', [() => import('#controllers/jobs_controller'), 'store'])
        router.post('/jobs/:id/add-clip', [() => import('#controllers/jobs_controller'), 'addClip'])
        router.get('/jobs', [() => import('#controllers/jobs_controller'), 'index'])
        router.get('/jobs/:id', [() => import('#controllers/jobs_controller'), 'show'])
        router.patch('/jobs/:id', [() => import('#controllers/jobs_controller'), 'update'])
        router.get('/jobs/:id/chat', [() => import('#controllers/jobs_controller'), 'chat'])
        router.patch('/jobs/:id/selection', [() => import('#controllers/jobs_controller'), 'updateSelection'])
        router.put('/jobs/:id/facecam', [() => import('#controllers/jobs_controller'), 'updateFacecam'])
        router.post('/jobs/:id/retry', [() => import('#controllers/jobs_controller'), 'retry'])
        router.delete('/jobs/:id', [() => import('#controllers/jobs_controller'), 'destroy'])
        router.delete('/jobs/:id/clips/:clipFilename', [() => import('#controllers/jobs_controller'), 'destroyClip'])
        router.patch('/jobs/:id/clips/:clipFilename/name', [() => import('#controllers/jobs_controller'), 'renameClip'])
        router.post('/jobs/:jobId/batch-render', [() => import('#controllers/renders_controller'), 'batchStore'])

        // Clips
        router.post('/clips/:jobId/:filename/extend', [() => import('#controllers/clips_controller'), 'extend'])
        router.get('/clips/:jobId/:filename/edit-env', [() => import('#controllers/clips_controller'), 'editEnv'])
        router.get('/clips/:jobId/:filename/thumb', [() => import('#controllers/clips_controller'), 'thumb'])
        router.get('/clips/:jobId/:filename/background', [() => import('#controllers/clips_controller'), 'background'])
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

        // Workers
        router.get('/workers', [() => import('#controllers/workers_controller'), 'index'])
        router.post('/workers/flush', [() => import('#controllers/workers_controller'), 'flush'])
        router.post('/workers/cancel/:id', [() => import('#controllers/workers_controller'), 'cancel'])
        router.post('/workers/cancel-render/:id', [() => import('#controllers/workers_controller'), 'cancelRender'])

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

// Built frontend (desktop app): everything that is not an API route
router.get('/', [SpaController, 'handle']).as('spa.root')
router.get('*', [SpaController, 'handle']).as('spa.fallback')
