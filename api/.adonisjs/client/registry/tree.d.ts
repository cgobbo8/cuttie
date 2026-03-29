/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
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
  games: {
    index: typeof routes['games.index']
  }
  creators: {
    index: typeof routes['creators.index']
  }
  jobs: {
    store: typeof routes['jobs.store']
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    retry: typeof routes['jobs.retry']
    destroy: typeof routes['jobs.destroy']
    stream: typeof routes['jobs.stream']
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
    editEnv: typeof routes['clips.edit_env']
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
}
