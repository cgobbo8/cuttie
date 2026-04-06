/**
 * In-process concurrent render queue.
 * Limits parallelism to MAX_CONCURRENT to avoid CPU/memory exhaustion.
 */

type RenderTask = () => Promise<void>

const MAX_CONCURRENT = 1
const queue: RenderTask[] = []
let running = 0

async function processQueue() {
  while (queue.length > 0 && running < MAX_CONCURRENT) {
    const task = queue.shift()!
    running++
    console.log(`[RenderQueue] Starting task (running=${running}, queued=${queue.length})`)
    task()
      .catch((err) => { console.error('[RenderQueue] Task error:', err.message) })
      .finally(() => {
        running--
        console.log(`[RenderQueue] Task finished (running=${running}, queued=${queue.length})`)
        processQueue()
      })
  }
}

/** Enqueue a render task. Up to MAX_CONCURRENT tasks run in parallel. */
export function enqueueRender(task: RenderTask) {
  queue.push(task)
  console.log(`[RenderQueue] Enqueued (running=${running}, queued=${queue.length})`)
  processQueue()
}

/** Number of tasks waiting (not including currently running ones). */
export function queueLength(): number {
  return queue.length
}
