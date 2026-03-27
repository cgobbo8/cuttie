/**
 * Preload: start the Redis pub/sub subscriber for job status updates.
 * This file is registered in adonisrc.ts > preloads.
 */

import jobStatusBus from '#services/job_status_bus'

jobStatusBus.start()
