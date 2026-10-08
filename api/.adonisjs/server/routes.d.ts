import '@adonisjs/core/types/http'

type ParamValue = string | number | bigint | boolean

export type ScannedRoutes = {
  ALL: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
    'spa.root': { paramsTuple?: []; params?: {} }
    'spa.fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  GET: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'spa.root': { paramsTuple?: []; params?: {} }
    'spa.fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  HEAD: {
    'event_stream': { paramsTuple?: []; params?: {} }
    'spa.root': { paramsTuple?: []; params?: {} }
    'spa.fallback': { paramsTuple: [...ParamValue[]]; params: {'*': ParamValue[]} }
  }
  POST: {
    'subscribe': { paramsTuple?: []; params?: {} }
    'unsubscribe': { paramsTuple?: []; params?: {} }
  }
  DELETE: {
  }
  PUT: {
  }
  PATCH: {
  }
}
declare module '@adonisjs/core/types/http' {
  export interface RoutesList extends ScannedRoutes {}
}