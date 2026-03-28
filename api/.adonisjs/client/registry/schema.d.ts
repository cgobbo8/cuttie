/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'access_token.store': {
    methods: ["POST"]
    pattern: '/api/auth/login'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').loginValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').loginValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'google_auth.redirect': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/google/redirect'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['redirect']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['redirect']>>>
    }
  }
  'google_auth.callback': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/google/callback'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['callback']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/google_auth_controller').default['callback']>>>
    }
  }
  'access_token.destroy': {
    methods: ["DELETE"]
    pattern: '/api/auth/logout'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/access_token_controller').default['destroy']>>>
    }
  }
  'auth_me.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/auth/me'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/auth_me_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/auth_me_controller').default['show']>>>
    }
  }
  'dashboard.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/dashboard'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/dashboard_controller').default['index']>>>
    }
  }
  'games.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/games'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/games_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/games_controller').default['index']>>>
    }
  }
  'creators.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/creators'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/creators_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/creators_controller').default['index']>>>
    }
  }
  'jobs.store': {
    methods: ["POST"]
    pattern: '/api/analyze'
    types: {
      body: ExtractBody<InferInput<(typeof import('#validators/user').createJobValidator)>>
      paramsTuple: []
      params: {}
      query: ExtractQuery<InferInput<(typeof import('#validators/user').createJobValidator)>>
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>> | { status: 422; response: { errors: SimpleError[] } }
    }
  }
  'jobs.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/jobs'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['index']>>>
    }
  }
  'jobs.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/jobs/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['show']>>>
    }
  }
  'jobs.retry': {
    methods: ["POST"]
    pattern: '/api/jobs/:id/retry'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['retry']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['retry']>>>
    }
  }
  'jobs.destroy': {
    methods: ["DELETE"]
    pattern: '/api/jobs/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroy']>>>
    }
  }
  'jobs.stream': {
    methods: ["GET","HEAD"]
    pattern: '/api/jobs/:id/sse'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['stream']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['stream']>>>
    }
  }
  'jobs.rename_clip': {
    methods: ["PATCH"]
    pattern: '/api/jobs/:id/clips/:clipFilename/name'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; clipFilename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['renameClip']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['renameClip']>>>
    }
  }
  'clips.edit_env': {
    methods: ["GET","HEAD"]
    pattern: '/api/clips/:jobId/:filename/edit-env'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { jobId: ParamValue; filename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clips_controller').default['editEnv']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clips_controller').default['editEnv']>>>
    }
  }
  'clips.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/clips/:jobId/:filename'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { jobId: ParamValue; filename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/clips_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/clips_controller').default['show']>>>
    }
  }
  'assets.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/assets'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['index']>>>
    }
  }
  'assets.store': {
    methods: ["POST"]
    pattern: '/api/assets/upload'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['store']>>>
    }
  }
  'assets.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/assets/:filename'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { filename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/assets_controller').default['show']>>>
    }
  }
  'renders.store': {
    methods: ["POST"]
    pattern: '/api/clips/:jobId/:filename/render'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { jobId: ParamValue; filename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['store']>>>
    }
  }
  'renders.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/renders'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['index']>>>
    }
  }
  'renders.show': {
    methods: ["GET","HEAD"]
    pattern: '/api/renders/:renderId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { renderId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['show']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['show']>>>
    }
  }
  'renders.download': {
    methods: ["GET","HEAD"]
    pattern: '/api/renders/:renderId/download'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { renderId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['download']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['download']>>>
    }
  }
  'renders.destroy': {
    methods: ["DELETE"]
    pattern: '/api/renders/:renderId'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { renderId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['destroy']>>>
    }
  }
}
