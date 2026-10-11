/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  eventStream: typeof routes['event_stream']
  subscribe: typeof routes['subscribe']
  unsubscribe: typeof routes['unsubscribe']
  app: {
    info: typeof routes['app.info']
    showSettings: typeof routes['app.show_settings']
    updateSettings: typeof routes['app.update_settings']
    verifyKey: typeof routes['app.verify_key']
    diagnostics: typeof routes['app.diagnostics']
    machine: typeof routes['app.machine']
    localTest: typeof routes['app.local_test']
  }
  storage: {
    show: typeof routes['storage.show']
  }
  internal: {
    workerEvents: typeof routes['internal.worker_events']
  }
  accessToken: {
    store: typeof routes['access_token.store']
    destroy: typeof routes['access_token.destroy']
  }
  googleAuth: {
    redirect: typeof routes['google_auth.redirect']
    callback: typeof routes['google_auth.callback']
  }
  authMe: {
    show: typeof routes['auth_me.show']
  }
  dashboard: {
    index: typeof routes['dashboard.index']
  }
  brand: {
    show: typeof routes['brand.show']
    update: typeof routes['brand.update']
    detectColors: typeof routes['brand.detect_colors']
    detectFacecam: typeof routes['brand.detect_facecam']
    frame: typeof routes['brand.frame']
    channel: typeof routes['brand.channel']
    lookup: typeof routes['brand.lookup']
    lookupColors: typeof routes['brand.lookup_colors']
    storyboard: typeof routes['brand.storyboard']
  }
  games: {
    index: typeof routes['games.index']
  }
  creators: {
    index: typeof routes['creators.index']
  }
  jobs: {
    store: typeof routes['jobs.store']
    addClip: typeof routes['jobs.add_clip']
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    update: typeof routes['jobs.update']
    chat: typeof routes['jobs.chat']
    updateSelection: typeof routes['jobs.update_selection']
    updateFacecam: typeof routes['jobs.update_facecam']
    retry: typeof routes['jobs.retry']
    destroy: typeof routes['jobs.destroy']
    destroyClip: typeof routes['jobs.destroy_clip']
    renameClip: typeof routes['jobs.rename_clip']
  }
  renders: {
    batchStore: typeof routes['renders.batch_store']
    store: typeof routes['renders.store']
    index: typeof routes['renders.index']
    batchDownload: typeof routes['renders.batch_download']
    show: typeof routes['renders.show']
    download: typeof routes['renders.download']
    destroy: typeof routes['renders.destroy']
  }
  clips: {
    extend: typeof routes['clips.extend']
    editEnv: typeof routes['clips.edit_env']
    thumb: typeof routes['clips.thumb']
    background: typeof routes['clips.background']
    show: typeof routes['clips.show']
  }
  assets: {
    index: typeof routes['assets.index']
    store: typeof routes['assets.store']
    show: typeof routes['assets.show']
  }
  aiEditor: {
    chat: typeof routes['ai_editor.chat']
  }
  themes: {
    index: typeof routes['themes.index']
    store: typeof routes['themes.store']
    update: typeof routes['themes.update']
    destroy: typeof routes['themes.destroy']
    setDefault: typeof routes['themes.set_default']
  }
  workers: {
    index: typeof routes['workers.index']
    flush: typeof routes['workers.flush']
    cancel: typeof routes['workers.cancel']
    cancelRender: typeof routes['workers.cancel_render']
  }
  spa: {
    root: typeof routes['spa.root']
    fallback: typeof routes['spa.fallback']
  }
}
