/* eslint-disable prettier/prettier */
import type { AdonisEndpoint } from '@tuyau/core/types'
import type { Registry } from './schema.d.ts'
import type { ApiDefinition } from './tree.d.ts'

const placeholder: any = {}

const routes = {
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
  'jobs.stream': {
    methods: ["GET","HEAD"],
    pattern: '/api/jobs/:id/sse',
    tokens: [{"old":"/api/jobs/:id/sse","type":0,"val":"api","end":""},{"old":"/api/jobs/:id/sse","type":0,"val":"jobs","end":""},{"old":"/api/jobs/:id/sse","type":1,"val":"id","end":""},{"old":"/api/jobs/:id/sse","type":0,"val":"sse","end":""}],
    types: placeholder as Registry['jobs.stream']['types'],
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
