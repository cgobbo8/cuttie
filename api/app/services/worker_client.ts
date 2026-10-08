/**
 * HTTP client for the local Python worker (backend/app/main.py).
 * Replaces the old Redis queue: jobs, cancellations and editor helpers all go
 * through the worker's loopback HTTP server, authenticated by a shared secret.
 */

import env from '#start/env'

export interface WorkerJob {
  job_id: string
  type?: 'analyze' | 'add_clip'
  url?: string
  clip_filename?: string
  clip_name?: string
  rank?: number
}

export interface WorkerQueue {
  current: WorkerJob | null
  items: WorkerJob[]
}

export class WorkerUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Le moteur d’analyse ne répond pas. Relance Cuttie.')
    this.cause = cause
  }
}

function baseUrl(): string {
  return (env.get('WORKER_URL') ?? 'http://127.0.0.1:3334').replace(/\/$/, '')
}

async function call<T>(
  method: string,
  path: string,
  { body, timeoutMs = 10_000 }: { body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Cuttie-Secret': env.get('CUTTIE_INTERNAL_SECRET') ?? '',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw new WorkerUnavailableError(err)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Worker ${method} ${path} failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** Queue a job. Retries for a while so a job submitted while the worker boots isn't lost. */
export async function enqueueJob(job: WorkerJob, { retryForMs = 60_000 } = {}): Promise<void> {
  const deadline = Date.now() + retryForMs
  for (;;) {
    try {
      await call('POST', '/jobs', { body: job })
      return
    } catch (err) {
      if (!(err instanceof WorkerUnavailableError) || Date.now() > deadline) throw err
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  await call('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`)
}

export async function getQueue(): Promise<WorkerQueue> {
  return call<WorkerQueue>('GET', '/queue')
}

export async function flushQueue(): Promise<{ flushed: number; cancelled_current: string | null }> {
  return call('POST', '/queue/flush')
}

/** Word-level transcription (+ speaker labels) of a stored clip. Slow: Whisper + diarization. */
export async function transcribeClipWords(
  jobId: string,
  clipFilename: string
): Promise<{ word: string; start: number; end: number; speaker?: string }[]> {
  return call('POST', `/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(clipFilename)}/words`, {
    timeoutMs: 180_000,
  })
}

export interface VodFacecam {
  facecam: { x: number; y: number; w: number; h: number } | null
  /** Storage key of the frame to show the streamer */
  frame_key: string
  frame_w: number
  frame_h: number
}

/** Webcam on a Twitch VOD, before any analysis (reads ~10 frames of the live) */
export async function detectVodFacecam(vodId: string, durationSeconds: number): Promise<VodFacecam> {
  return call<VodFacecam>('POST', '/facecam/vod', {
    body: { vod_id: vodId, duration: durationSeconds },
    timeoutMs: 120_000,
  })
}

/**
 * Locate the webcam on clips of a job (null when no webcam overlay). The worker
 * also stores where people stand in each clip (facecam.json).
 */
export async function detectFacecam(
  jobId: string,
  clipFilenames: string[]
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const res = await call<{ facecam: { x: number; y: number; w: number; h: number } | null }>(
    'POST',
    `/jobs/${encodeURIComponent(jobId)}/facecam`,
    { body: { clip_filenames: clipFilenames }, timeoutMs: 180_000 }
  )
  return res.facecam
}

export interface DetectedPalette {
  palette: string[]
  roles: { accent: string; highlight: string; dark: string; light: string }
}

/** Brand colors of a logo (first url) and banner (second url) */
export async function detectPalette(urls: string[]): Promise<DetectedPalette> {
  return call<DetectedPalette>('POST', '/palette', { body: { urls }, timeoutMs: 30_000 })
}

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  return call('GET', '/diagnostics', { timeoutMs: 30_000 })
}
