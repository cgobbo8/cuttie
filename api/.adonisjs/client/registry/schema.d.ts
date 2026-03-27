/* eslint-disable prettier/prettier */
/// <reference path="../manifest.d.ts" />

import type { ExtractBody, ExtractErrorResponse, ExtractQuery, ExtractQueryForGet, ExtractResponse } from '@tuyau/core/types'
import type { InferInput, SimpleError } from '@vinejs/vine/types'

export type ParamValue = string | number | bigint | boolean

export interface Registry {
  'jobs.store': {
    methods: ["POST"]
    pattern: '/api/analyze'
    types: {
      body: {}
      paramsTuple: []
      params: {}
      query: {}
      response: ExtractResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>>
      errorResponse: ExtractErrorResponse<Awaited<ReturnType<import('#controllers/jobs_controller').default['store']>>>
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
}
