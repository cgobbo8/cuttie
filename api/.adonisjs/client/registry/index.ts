/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
  'access_token.store': {
    methods: ["POST"],
    pattern: '/api/auth/login',
    tokens: [{"old":"/api/auth/login","type":0,"val":"api","end":""},{"old":"/api/auth/login","type":0,"val":"auth","end":""},{"old":"/api/auth/login","type":0,"val":"login","end":""}],
    types: placeholder as Registry['access_token.store']['types'],
  },
  'google_auth.redirect': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/google/redirect',
    tokens: [{"old":"/api/auth/google/redirect","type":0,"val":"api","end":""},{"old":"/api/auth/google/redirect","type":0,"val":"auth","end":""},{"old":"/api/auth/google/redirect","type":0,"val":"google","end":""},{"old":"/api/auth/google/redirect","type":0,"val":"redirect","end":""}],
    types: placeholder as Registry['google_auth.redirect']['types'],
  },
  'google_auth.callback': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/google/callback',
    tokens: [{"old":"/api/auth/google/callback","type":0,"val":"api","end":""},{"old":"/api/auth/google/callback","type":0,"val":"auth","end":""},{"old":"/api/auth/google/callback","type":0,"val":"google","end":""},{"old":"/api/auth/google/callback","type":0,"val":"callback","end":""}],
    types: placeholder as Registry['google_auth.callback']['types'],
  },
  'access_token.destroy': {
    methods: ["DELETE"],
    pattern: '/api/auth/logout',
    tokens: [{"old":"/api/auth/logout","type":0,"val":"api","end":""},{"old":"/api/auth/logout","type":0,"val":"auth","end":""},{"old":"/api/auth/logout","type":0,"val":"logout","end":""}],
    types: placeholder as Registry['access_token.destroy']['types'],
  },
  'auth_me.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/auth/me',
    tokens: [{"old":"/api/auth/me","type":0,"val":"api","end":""},{"old":"/api/auth/me","type":0,"val":"auth","end":""},{"old":"/api/auth/me","type":0,"val":"me","end":""}],
    types: placeholder as Registry['auth_me.show']['types'],
  },
  'dashboard.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/dashboard',
    tokens: [{"old":"/api/dashboard","type":0,"val":"api","end":""},{"old":"/api/dashboard","type":0,"val":"dashboard","end":""}],
    types: placeholder as Registry['dashboard.index']['types'],
  },
  'games.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/games',
    tokens: [{"old":"/api/games","type":0,"val":"api","end":""},{"old":"/api/games","type":0,"val":"games","end":""}],
    types: placeholder as Registry['games.index']['types'],
  },
  'creators.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/creators',
    tokens: [{"old":"/api/creators","type":0,"val":"api","end":""},{"old":"/api/creators","type":0,"val":"creators","end":""}],
    types: placeholder as Registry['creators.index']['types'],
  },
  'jobs.store': {
    methods: ["POST"],
    pattern: '/api/analyze',
    tokens: [{"old":"/api/analyze","type":0,"val":"api","end":""},{"old":"/api/analyze","type":0,"val":"analyze","end":""}],
    types: placeholder as Registry['jobs.store']['types'],
  },
  'jobs.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/jobs',
    tokens: [{"old":"/api/jobs","type":0,"val":"api","end":""},{"old":"/api/jobs","type":0,"val":"jobs","end":""}],
    types: placeholder as Registry['jobs.index']['types'],
  },
  'jobs.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/jobs/:id',
    tokens: [{"old":"/api/jobs/:id","type":0,"val":"api","end":""},{"old":"/api/jobs/:id","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['jobs.show']['types'],
  },
  'jobs.retry': {
    methods: ["POST"],
    pattern: '/api/jobs/:id/retry',
    tokens: [{"old":"/api/jobs/:id/retry","type":0,"val":"api","end":""},{"old":"/api/jobs/:id/retry","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id/retry","type":1,"val":"id","end":""},{"old":"/api/jobs/:id/retry","type":0,"val":"retry","end":""}],
    types: placeholder as Registry['jobs.retry']['types'],
  },
  'jobs.destroy': {
    methods: ["DELETE"],
    pattern: '/api/jobs/:id',
    tokens: [{"old":"/api/jobs/:id","type":0,"val":"api","end":""},{"old":"/api/jobs/:id","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id","type":1,"val":"id","end":""}],
    types: placeholder as Registry['jobs.destroy']['types'],
  },
  'jobs.stream': {
    methods: ["GET","HEAD"],
    pattern: '/api/jobs/:id/sse',
    tokens: [{"old":"/api/jobs/:id/sse","type":0,"val":"api","end":""},{"old":"/api/jobs/:id/sse","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id/sse","type":1,"val":"id","end":""},{"old":"/api/jobs/:id/sse","type":0,"val":"sse","end":""}],
    types: placeholder as Registry['jobs.stream']['types'],
  },
  'jobs.rename_clip': {
    methods: ["PATCH"],
    pattern: '/api/jobs/:id/clips/:clipFilename/name',
    tokens: [{"old":"/api/jobs/:id/clips/:clipFilename/name","type":0,"val":"api","end":""},{"old":"/api/jobs/:id/clips/:clipFilename/name","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id/clips/:clipFilename/name","type":1,"val":"id","end":""},{"old":"/api/jobs/:id/clips/:clipFilename/name","type":0,"val":"clips","end":""},{"old":"/api/jobs/:id/clips/:clipFilename/name","type":1,"val":"clipFilename","end":""},{"old":"/api/jobs/:id/clips/:clipFilename/name","type":0,"val":"name","end":""}],
    types: placeholder as Registry['jobs.rename_clip']['types'],
  },
  'clips.edit_env': {
    methods: ["GET","HEAD"],
    pattern: '/api/clips/:jobId/:filename/edit-env',
    tokens: [{"old":"/api/clips/:jobId/:filename/edit-env","type":0,"val":"api","end":""},{"old":"/api/clips/:jobId/:filename/edit-env","type":0,"val":"clips","end":""},{"old":"/api/clips/:jobId/:filename/edit-env","type":1,"val":"jobId","end":""},{"old":"/api/clips/:jobId/:filename/edit-env","type":1,"val":"filename","end":""},{"old":"/api/clips/:jobId/:filename/edit-env","type":0,"val":"edit-env","end":""}],
    types: placeholder as Registry['clips.edit_env']['types'],
  },
  'clips.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/clips/:jobId/:filename',
    tokens: [{"old":"/api/clips/:jobId/:filename","type":0,"val":"api","end":""},{"old":"/api/clips/:jobId/:filename","type":0,"val":"clips","end":""},{"old":"/api/clips/:jobId/:filename","type":1,"val":"jobId","end":""},{"old":"/api/clips/:jobId/:filename","type":1,"val":"filename","end":""}],
    types: placeholder as Registry['clips.show']['types'],
  },
  'assets.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/assets',
    tokens: [{"old":"/api/assets","type":0,"val":"api","end":""},{"old":"/api/assets","type":0,"val":"assets","end":""}],
    types: placeholder as Registry['assets.index']['types'],
  },
  'assets.store': {
    methods: ["POST"],
    pattern: '/api/assets/upload',
    tokens: [{"old":"/api/assets/upload","type":0,"val":"api","end":""},{"old":"/api/assets/upload","type":0,"val":"assets","end":""},{"old":"/api/assets/upload","type":0,"val":"upload","end":""}],
    types: placeholder as Registry['assets.store']['types'],
  },
  'assets.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/assets/:filename',
    tokens: [{"old":"/api/assets/:filename","type":0,"val":"api","end":""},{"old":"/api/assets/:filename","type":0,"val":"assets","end":""},{"old":"/api/assets/:filename","type":1,"val":"filename","end":""}],
    types: placeholder as Registry['assets.show']['types'],
  },
  'renders.store': {
    methods: ["POST"],
    pattern: '/api/clips/:jobId/:filename/render',
    tokens: [{"old":"/api/clips/:jobId/:filename/render","type":0,"val":"api","end":""},{"old":"/api/clips/:jobId/:filename/render","type":0,"val":"clips","end":""},{"old":"/api/clips/:jobId/:filename/render","type":1,"val":"jobId","end":""},{"old":"/api/clips/:jobId/:filename/render","type":1,"val":"filename","end":""},{"old":"/api/clips/:jobId/:filename/render","type":0,"val":"render","end":""}],
    types: placeholder as Registry['renders.store']['types'],
  },
  'renders.index': {
    methods: ["GET","HEAD"],
    pattern: '/api/renders',
    tokens: [{"old":"/api/renders","type":0,"val":"api","end":""},{"old":"/api/renders","type":0,"val":"renders","end":""}],
    types: placeholder as Registry['renders.index']['types'],
  },
  'renders.show': {
    methods: ["GET","HEAD"],
    pattern: '/api/renders/:renderId',
    tokens: [{"old":"/api/renders/:renderId","type":0,"val":"api","end":""},{"old":"/api/renders/:renderId","type":0,"val":"renders","end":""},{"old":"/api/renders/:renderId","type":1,"val":"renderId","end":""}],
    types: placeholder as Registry['renders.show']['types'],
  },
  'renders.download': {
    methods: ["GET","HEAD"],
    pattern: '/api/renders/:renderId/download',
    tokens: [{"old":"/api/renders/:renderId/download","type":0,"val":"api","end":""},{"old":"/api/renders/:renderId/download","type":0,"val":"renders","end":""},{"old":"/api/renders/:renderId/download","type":1,"val":"renderId","end":""},{"old":"/api/renders/:renderId/download","type":0,"val":"download","end":""}],
    types: placeholder as Registry['renders.download']['types'],
  },
  'renders.destroy': {
    methods: ["DELETE"],
    pattern: '/api/renders/:renderId',
    tokens: [{"old":"/api/renders/:renderId","type":0,"val":"api","end":""},{"old":"/api/renders/:renderId","type":0,"val":"renders","end":""},{"old":"/api/renders/:renderId","type":1,"val":"renderId","end":""}],
    types: placeholder as Registry['renders.destroy']['types'],
  },
} as const satisfies Record<string, AdonisEndpoint>

export { routes }

export const registry = {
  routes,
  $tree: {} as ApiDefinition,
}

declare module '@tuyau/core/types' {
  export interface UserRegistry {
    routes: typeof routes
    $tree: ApiDefinition
  }
}
