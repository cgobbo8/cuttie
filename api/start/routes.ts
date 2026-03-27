/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import router from '@adonisjs/core/services/router'

router.get('/', () => {
  return { status: 'ok' }
})

router
  .group(() => {
    // Job endpoints (no auth for MVP)
    router.post('/analyze', [() => import('#controllers/jobs_controller'), 'store'])
    router.get('/jobs', [() => import('#controllers/jobs_controller'), 'index'])
    router.get('/jobs/:id', [() => import('#controllers/jobs_controller'), 'show'])
    router.post('/jobs/:id/retry', [() => import('#controllers/jobs_controller'), 'retry'])
    router.get('/jobs/:id/sse', [() => import('#controllers/jobs_controller'), 'stream'])
    router.patch('/jobs/:id/clips/:clipFilename/name', [() => import('#controllers/jobs_controller'), 'renameClip'])

    // Clip serving
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
  })
  .prefix('/api')
