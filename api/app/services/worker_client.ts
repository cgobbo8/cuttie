/**
 * HTTP client for the local Python worker (backend/app/main.py).
 * Replaces the old Redis queue: jobs, cancellations and editor helpers all go
 * through the worker's loopback HTTP server, authenticated by a shared secret.
 */

import http from 'node:http'
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

/** The worker answered with an error (status kept: 410 = the live is gone from Twitch) */
export class WorkerHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

function baseUrl(): string {
  return (env.get('WORKER_URL') ?? 'http://127.0.0.1:3334').replace(/\/$/, '')
}

/**
 * One request to the worker, answered as text. Through node:http, not fetch: Node's fetch gives
 * up after 5 minutes without an answer whatever it is told it may wait (undici's own limit on
 * the answer's first byte), and the worker's longest work takes more: a live transcribed again
 * before the AI reads it is 12 minutes for 7 hours. `timeoutMs` is the only limit here.
 */
export function workerRequest(method: string, url: string, body: string | undefined, timeoutMs: number): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Cuttie-Secret': env.get('CUTTIE_INTERNAL_SECRET') ?? '',
        },
        signal: AbortSignal.timeout(timeoutMs),
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf-8') }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

async function call<T>(
  method: string,
  path: string,
  { body, timeoutMs = 10_000 }: { body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  let res: { status: number; text: string }
  try {
    res = await workerRequest(method, `${baseUrl()}${path}`, body === undefined ? undefined : JSON.stringify(body), timeoutMs)
  } catch (err) {
    throw new WorkerUnavailableError(err)
  }
  if (res.status < 200 || res.status >= 300) {
    throw new WorkerHttpError(res.status, `Worker ${method} ${path} failed: HTTP ${res.status} ${res.text.slice(0, 200)}`)
  }
  return JSON.parse(res.text) as T
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

export interface MachineProfile {
  backend: 'mlx' | 'cuda' | 'cpu'
  gpu: { name: string | null; vram_gb: number | null; tflops: number; error?: string }
  cpu: string
  /** How many times faster than real time Whisper would run here, null when it can't run locally */
  whisper_realtime: number | null
  /** Seconds the voice model needs for one analysis */
  voices: { seconds: number | null; error?: string }
}

/** What this computer can do (first launch: is a Groq key worth it?), measured once per worker run */
export async function getMachineProfile(): Promise<MachineProfile> {
  return call<MachineProfile>('GET', '/machine', { timeoutMs: 120_000 })
}

/** The profile when the worker already measured it (null otherwise: never a new measure) */
export async function getCachedMachineProfile(): Promise<MachineProfile | null> {
  return call<MachineProfile | null>('GET', '/machine?cached=true', { timeoutMs: 5_000 })
}

export interface ExtendedClip {
  vod_start: number
  vod_end: number
  duration: number
  /** Seconds the clip gained before its old start: its clock moved by that much */
  added_before: number
}

/** Extract a clip again over a wider part of the live, its sidecars following (clip_tools.extend_clip) */
export async function extendClipFile(
  jobId: string,
  clipFilename: string,
  body: { url: string; start: number; end: number }
): Promise<ExtendedClip> {
  return call<ExtendedClip>('POST', `/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(clipFilename)}/extend`, {
    body,
    timeoutMs: 300_000,
  })
}

/** Cut a project's clips again from the live (freed to make room); 410 when the live is gone */
export async function restoreClipFiles(
  jobId: string,
  url: string,
  clips: { filename: string; start: number; end: number }[]
): Promise<{ restored: string[]; failed: string[] }> {
  return call('POST', `/clips/${encodeURIComponent(jobId)}/restore`, { body: { url, clips }, timeoutMs: 15 * 60_000 })
}

// ── Searching the live, compilations ─────────────────────────────────────────

/** A moment of the live that matches a search, live seconds (live_search.py) */
export interface LiveHit {
  start: number
  end: number
  /** "voice" (said), "chat" (written), "ai" (the AI read it) */
  sources: string[]
  text: string
  before: string
  after: string
  chat: string[]
  why: string
  score: number
}

export interface LiveSearchResult {
  hits: LiveHit[]
  total: number
  transcript: boolean
  /** AI searches: answered from the disk (free), dollars spent otherwise */
  cached?: boolean
  cost?: number
  /** AI searches: what it looked for and how sure it is, in its words */
  note?: string
}

/** What the AI works from besides the transcript: the live's length, its voice energy, who and what, the live on Twitch (to listen to it), and every candidate the analysis rated */
export interface LiveContext {
  duration: number
  energy?: number[] | null
  meta: { streamer?: string | null; game?: string | null; title?: string | null; date?: string | null }
  url?: string | null
  moments?: { t: number; state: string; score?: number; name?: string; category?: string; what?: string }[]
}

/** What can be searched in a live, and about what asking the AI costs (dollars) */
export interface LiveSearchInfo {
  transcript: boolean
  segments?: number
  chat: number
  /** About what a question costs, and a whole video planned */
  ai_cost: number | null
  plan_cost?: number | null
  /** The most a question can cost */
  max_cost?: number | null
  /** The live was listened to: its sounds can be searched (else the first question does it, a few minutes) */
  sounds?: boolean
  dev?: boolean
}

export async function liveSearchInfo(jobId: string, duration: number): Promise<LiveSearchInfo> {
  return call('GET', `/jobs/${encodeURIComponent(jobId)}/search/info?duration=${Math.round(duration)}`, { timeoutMs: 30_000 })
}

/** What the AI searching a live is doing right now: the tool it called and on what (null: nothing being searched) */
export interface LiveSearchStep {
  step: string
  detail: string
  count: number
}

export async function liveSearchProgress(jobId: string): Promise<{ doing: LiveSearchStep | null }> {
  return call('GET', `/jobs/${encodeURIComponent(jobId)}/search/progress`, { timeoutMs: 5_000 })
}

/** Moments that match a search: "words" is free and instant, "ai" searches the live with tools and checks what it finds (about a cent, up to a few minutes) */
export async function searchLive(
  jobId: string,
  query: string,
  mode: 'words' | 'ai',
  context: LiveContext,
  /** Asked again on purpose: the AI searches anew instead of giving the answer it kept */
  fresh = false
): Promise<LiveSearchResult> {
  return call('POST', `/jobs/${encodeURIComponent(jobId)}/search`, {
    body: { query, mode, ...context, ...(fresh ? { fresh: true } : {}) },
    timeoutMs: mode === 'ai' ? 20 * 60_000 : 60_000,
  })
}

export interface VideoPlan {
  title: string
  sections: { title: string; hits: LiveHit[] }[]
  cached?: boolean
  cost?: number
  /** What the AI found for each part and what is missing, in its words */
  note?: string
  /** What the description asks about the look, in the streamer's words (empty: nothing) */
  look?: string
  /** What is written on screen over the first seconds of the video, as the AI wrote it */
  hook?: string
  /** Lasting tastes the streamer stated while asking, that the AI just noted in its memory */
  remembered?: string[]
}

/** A change asked on a video the AI planned: what is asked now, the video as it is (live seconds), what was asked before */
export interface PlanChange {
  request: string
  /** The video as it is: an item of another live says so (`job`), the one the video can open on too (`opening`) */
  current: { title: string; items: { start: number; end: number; job?: string; opening?: boolean }[] }[]
  asks: string[]
}

/** One more live a video is made from: the AI works on it too, and each of its moments says which live it is from */
export interface OtherLive {
  job_id: string
  duration: number
  url?: string | null
  moments?: LiveContext['moments']
  date?: string | null
}

/** A whole video planned by the AI from a description; with `change`, the video it already planned, changed as asked */

export async function planLiveVideo(
  jobId: string,
  brief: string,
  target: number,
  context: LiveContext,
  change?: PlanChange,
  lives: OtherLive[] = [],
  /** The moments already spotted for this video (live seconds), when it is one the AI proposed */
  leads: number[] = [],
  /** Asked again on purpose: the AI plans anew instead of giving the plan it kept */
  fresh = false
): Promise<VideoPlan> {
  const body = { brief, target, ...context, ...(change ?? {}), ...(lives.length > 0 ? { lives } : {}), ...(leads.length > 0 ? { leads } : {}), ...(fresh ? { fresh: true } : {}) }
  return call('POST', `/jobs/${encodeURIComponent(jobId)}/plan`, { body, timeoutMs: 30 * 60_000 })
}

/** A video worth making from a live, as the AI proposes it (worker: live_ideas.py) */
export interface LiveIdea {
  /** Names the idea from one look through the live to the next */
  key: string
  title: string
  /** The request a streamer would type to get this video: what it is built from */
  brief: string
  /** How long the video should be */
  seconds: number
  /** One sentence: what the AI noticed in the live */
  pitch: string
  tags: string[]
  kind: string | null
  /** 0-100: how well it should do as a short */
  score: number
  /** The moments spotted for it, live seconds */
  moments: number[]
}

/** The compilations worth making from a live, found by the AI on its own (kept on the worker's disk: asked again, it costs nothing) */
export async function findLiveIdeas(jobId: string, context: LiveContext): Promise<{ ideas: LiveIdea[]; note: string; cost: number; cached: boolean }> {
  return call('POST', `/jobs/${encodeURIComponent(jobId)}/ideas`, { body: context, timeoutMs: 15 * 60_000 })
}

/** A live for the AI to read into its memory: who and what, its length, what the analysis kept of it */
export interface MemoryLive {
  duration: number
  meta: LiveContext['meta']
  moments: unknown[]
  /** The live as the analysis understood it (the job's vod_context) */
  context: Record<string, unknown> | null
}

/**
 * The AI reads a live into its memory (backend/app/services/memory.py): what it noted of the live, the memory as
 * it rewrote it, and corrections for the streamer's notes that the lives contradict. A live already read answers
 * from the worker's disk and costs nothing.
 */
export async function noteLive(jobId: string, live: MemoryLive): Promise<{ entry: any; sections: Record<string, string>; proposals: unknown[]; cost: number; cached: boolean }> {
  return call('POST', `/jobs/${encodeURIComponent(jobId)}/memory`, { body: live, timeoutMs: 15 * 60_000 })
}

/** A template as the AI is told about it: what it shows and what it is good for (written by the app from the template) */
export interface LookTemplate {
  key: string
  name: string
  description: string
  /** Built around the webcam: not for a passage where nobody is in it */
  needs_cam: boolean
}

export interface LooksChoice {
  /** The template most passages use */
  main: string
  /** Each passage's template, by passage id */
  looks: Record<string, string>
  reasons: Record<string, string>
  note: string
  cost: number
}

/** The template of each passage of a video, chosen by the AI looking at frames of it (worker: looks.py) */
export async function chooseLooks(
  jobId: string,
  body: {
    pieces: { id: string; file: string; start: number; end: number; text: string; cam: boolean; job?: string }[]
    templates: LookTemplate[]
    wish: string
    cam: { x: number; y: number; w: number; h: number; frame_w: number; frame_h: number } | null
    language: string
    /** The template the streamer uses when they ask for nothing */
    usual: string | null
  }
): Promise<LooksChoice> {
  return call('POST', `/clips/${encodeURIComponent(jobId)}/looks`, { body, timeoutMs: 10 * 60_000 })
}

/** A track the streamer adds, as the worker measured and heard it (`heard` false: nobody could listen, `why` says what went wrong) */
export interface MusicDescribed {
  seconds: number
  bpm: number
  start: number
  lufs: number
  genre: string
  kinds: string[]
  description: string
  about: string
  cost: number
  heard: boolean
  why?: string
}

/** Turns an added file into the track the app keeps (`target`, an MP3), measures it and has the AI listen to it (worker: music_library.py) */
export async function describeMusic(body: { source: string; target: string; language: string; hint: string }): Promise<MusicDescribed> {
  return call('POST', '/musics/describe', { body, timeoutMs: 5 * 60_000 })
}

/** What the AI chose for the sound of a video (worker: looks.choose_sound): any of them may be null */
export interface SoundChoice {
  kind: string | null
  music: string | null
  intro: string | null
  /** The passage the video could open on as a teaser: its place among the passages it was told (`said`), from 1 */
  teaser?: number | null
  /** How its passages follow each other: a ready-made transition, or "cut" */
  transition?: string | null
  /** When the intro is the hook: the look that frames it, by the name of a jingle */
  look?: string | null
  why: string
  cost: number
}

/** The background music and the intro of a video, chosen by the AI from what the video is and what the streamer likes */
export async function chooseSound(body: {
  /** (`game`: the game of the live, some graphics are made for one) */
  video: { title: string; game?: string; parts: string[]; seconds: number; passages: number; said: string[]; lengths?: number[] }
  musics: { key: string; name: string; kinds: string[]; about: string }[]
  /** The streamer's favourite track for a kind of video, and the intro they prefer */
  favourites: Record<string, string>
  intro: string | null
  /** When that intro is the hook: the graphics they like it framed with */
  intro_look?: string | null
  asked: string
  language: string
  /** The intros the AI gave the streamer's last videos, the newest first: the choice stays away from them */
  recent_intros: string[]
}): Promise<SoundChoice> {
  return call('POST', '/sound', { body, timeoutMs: 3 * 60_000 })
}

/** What a template of the streamer's own is good for, in a sentence or two, written by the AI from its description */
export async function writeTemplateUsage(body: { name: string; description: string; language: string }): Promise<{ usage: string; cost: number }> {
  return call('POST', '/templates/usage', { body, timeoutMs: 5 * 60_000 })
}

export interface CutPiece {
  id: string
  file: string
  vod_start: number
  vod_end: number
  duration: number
  /** Asked with `fit`: where those words are really said (live seconds), null when they are not found in the clip */
  tight?: [number, number] | null
}

/**
 * Cut pieces of the live into small clips (clip_tools.extract_pieces); 410 when the live is gone.
 * `fit`: the lines of the live's transcript a piece is made of, to get back where they are really said.
 */
export async function extractLivePieces(
  jobId: string,
  url: string,
  pieces: { id: string; start: number; end: number; fit?: [number, number] }[]
): Promise<{ pieces: CutPiece[]; failed: string[] }> {
  return call('POST', `/clips/${encodeURIComponent(jobId)}/pieces`, { body: { url, pieces }, timeoutMs: 10 * 60_000 })
}

/** The parts of a clip worth keeping, chosen by the AI (clip seconds) */
export async function suggestClipCut(
  jobId: string,
  clipFilename: string,
  body: { summary: string; current: [number, number][]; wish: string; target?: number }
): Promise<{ parts: [number, number][]; note: string; cost: number }> {
  return call('POST', `/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(clipFilename)}/suggest-cut`, { body, timeoutMs: 10 * 60_000 })
}

export interface DetectedPalette {
  palette: string[]
  roles: { accent: string; highlight: string; dark: string; light: string }
}

/** Brand colors of a logo (first url) and banner (second url) */
export async function detectPalette(urls: string[]): Promise<DetectedPalette> {
  return call<DetectedPalette>('POST', '/palette', { body: { urls }, timeoutMs: 30_000 })
}

/** Run the GPU and local Whisper once (the first run downloads ~1.6 GB) */
export async function runLocalTest(): Promise<Record<string, unknown>> {
  return call('POST', '/diagnostics/local-test', { timeoutMs: 20 * 60_000 })
}

export async function getDiagnostics(): Promise<Record<string, unknown>> {
  return call('GET', '/diagnostics', { timeoutMs: 30_000 })
}
