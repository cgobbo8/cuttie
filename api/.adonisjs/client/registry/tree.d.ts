/* eslint-disable prettier/prettier */
import type { routes } from './index.ts'

export interface ApiDefinition {
  jobs: {
    store: typeof routes['jobs.store']
    index: typeof routes['jobs.index']
    show: typeof routes['jobs.show']
    retry: typeof routes['jobs.retry']
    stream: typeof routes['jobs.stream']
  }
  clips: {
    show: typeof routes['clips.show']
  }
}
