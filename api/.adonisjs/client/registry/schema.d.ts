/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'event_stream': {
    methods: ["GET","HEAD"]
    pattern: '/__transmit/events'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'subscribe': {
    methods: ["POST"]
    pattern: '/__transmit/subscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
  'unsubscribe': {
    methods: ["POST"]
    pattern: '/__transmit/unsubscribe'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: unknown
      errorResponse: unknown
    }
  }
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
  'jobs.add_clip': {
    methods: ["POST"]
    pattern: '/api/jobs/:id/add-clip'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['addClip']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['addClip']>>>
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
  'jobs.destroy_clip': {
    methods: ["DELETE"]
    pattern: '/api/jobs/:id/clips/:clipFilename'
    types: {
      body: {}
      paramsTuple: [ParamValue, ParamValue]
      params: { id: ParamValue; clipFilename: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroyClip']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['destroyClip']>>>
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
  'renders.batch_store': {
    methods: ["POST"]
    pattern: '/api/jobs/:jobId/batch-render'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { jobId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['batchStore']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['batchStore']>>>
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
  'ai_editor.chat': {
    methods: ["POST"]
    pattern: '/api/ai/editor/chat'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/ai_editor_controller').default['chat']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/ai_editor_controller').default['chat']>>>
    }
  }
  'themes.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/themes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['index']>>>
    }
  }
  'themes.store': {
    methods: ["POST"]
    pattern: '/api/themes'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['store']>>>
    }
  }
  'themes.update': {
    methods: ["PATCH"]
    pattern: '/api/themes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['update']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['update']>>>
    }
  }
  'themes.destroy': {
    methods: ["DELETE"]
    pattern: '/api/themes/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['destroy']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['destroy']>>>
    }
  }
  'themes.set_default': {
    methods: ["POST"]
    pattern: '/api/themes/:id/default'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['setDefault']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/themes_controller').default['setDefault']>>>
    }
  }
  'workers.index': {
    methods: ["GET","HEAD"]
    pattern: '/api/workers'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['index']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['index']>>>
    }
  }
  'workers.flush': {
    methods: ["POST"]
    pattern: '/api/workers/flush'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['flush']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['flush']>>>
    }
  }
  'workers.cancel': {
    methods: ["POST"]
    pattern: '/api/workers/cancel/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['cancel']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['cancel']>>>
    }
  }
  'workers.cancel_render': {
    methods: ["POST"]
    pattern: '/api/workers/cancel-render/:id'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { id: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['cancelRender']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/workers_controller').default['cancelRender']>>>
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
  'renders.batch_download': {
    methods: ["GET","HEAD"]
    pattern: '/api/renders/batch/:batchGroupId/download'
    types: {
      body: {}
      paramsTuple: [ParamValue]
      params: { batchGroupId: ParamValue }
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['batchDownload']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/renders_controller').default['batchDownload']>>>
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
