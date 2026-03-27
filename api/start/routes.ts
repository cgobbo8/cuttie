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

    // Clip serving
    router.get('/clips/:jobId/:filename', [() => import('#controllers/clips_controller'), 'show'])
  })
  .prefix('/api')
