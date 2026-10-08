/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Local app: data directory shared with the worker (defaults to <repo>/.data)
  CUTTIE_DATA_DIR: Env.schema.string.optional(),

  // Python worker (loopback HTTP) + shared secret for worker <-> API calls
  WORKER_URL: Env.schema.string.optional(),
  CUTTIE_INTERNAL_SECRET: Env.schema.string.optional(),

  // Sign in automatically as the local user (desktop app, single user). Default: true
  CUTTIE_AUTO_LOGIN: Env.schema.boolean.optional(),

  // Built frontend (frontend/dist) to serve from the API — set in the packaged app
  FRONTEND_DIST: Env.schema.string.optional(),

  // Frontend URL (for OAuth redirects)
  FRONTEND_URL: Env.schema.string.optional(),

  // Google OAuth
  GOOGLE_CLIENT_ID: Env.schema.string.optional(),
  GOOGLE_CLIENT_SECRET: Env.schema.string.optional(),

  // OpenAI (for AI editor assistant)
  OPENAI_API_KEY: Env.schema.string.optional(),
})
