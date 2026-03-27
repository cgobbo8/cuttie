/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  jobs: {
    store: typeof routes['jobs.store']
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    retry: typeof routes['jobs.retry']
    stream: typeof routes['jobs.stream']
    renameClip: typeof routes['jobs.rename_clip']
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
  renders: {
    store: typeof routes['renders.store']
    index: typeof routes['renders.index']
    show: typeof routes['renders.show']
    download: typeof routes['renders.download']
  }
}
