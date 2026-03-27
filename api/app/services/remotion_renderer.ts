/**
 * Remotion render service.
 * Bundles the composition once (cached), then calls renderMedia() per request.
 */

import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Layer } from '../../remotion/editorTypes.js'

const execFileAsync = promisify(execFile)

// Cached bundle — auto-invalidates when remotion/ source files change
let bundleUrl: string | null = null
let bundleTimestamp = 0
const REMOTION_DIR = path.resolve('./remotion')

function latestMtime(dir: string): number {
  let latest = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) latest = Math.max(latest, latestMtime(full))
    else latest = Math.max(latest, statSync(full).mtimeMs)
  }
  return latest
}

async function getBundle(): Promise<string> {
  const srcMtime = latestMtime(REMOTION_DIR)
  if (bundleUrl && srcMtime <= bundleTimestamp) return bundleUrl

  if (bundleUrl) console.log('[Remotion] Source changed, rebuilding bundle...')
  else console.log('[Remotion] Bundling composition...')

  bundleUrl = await bundle({
    entryPoint: path.resolve('./remotion/index.tsx'),
    publicDir: path.resolve('./public'),
    webpackOverride: (config) => config,
  })
  bundleTimestamp = Date.now()
  console.log('[Remotion] Bundle ready:', bundleUrl)
  return bundleUrl
}

/** Get video duration + dimensions via ffprobe */
export async function probeVideo(
  filePath: string
): Promise<{ durationSeconds: number; width: number; height: number }> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-select_streams', 'v:0',
    filePath,
  ])
  const data = JSON.parse(stdout)
  const stream = data.streams?.[0]
  if (!stream) throw new Error(`ffprobe: no video stream in ${filePath}`)

  const [_num, _den] = (stream.r_frame_rate ?? '30/1').split('/').map(Number)
  const duration = parseFloat(stream.duration ?? '0')
  return {
    durationSeconds: duration,
    width: stream.width ?? 1920,
    height: stream.height ?? 1080,
  }
}

export interface RenderOptions {
  renderId: string
  layers: Layer[]
  jobId: string
  clipFilename: string
  /** Absolute path where the output MP4 should be written */
  outputPath: string
  /** Optional trim range in seconds */
  trim?: { start: number; end: number }
  onProgress: (pct: number) => void
}

export async function renderClip(opts: RenderOptions): Promise<{ sizeMb: number }> {
  const { layers, jobId, clipFilename, outputPath, trim, onProgress } = opts

  const CLIPS_BASE = path.resolve('../backend/clips')
  const videoPath = path.join(CLIPS_BASE, jobId, clipFilename)

  if (!existsSync(videoPath)) {
    throw new Error(`Source clip not found: ${videoPath}`)
  }

  // Probe source video for duration + native dimensions
  const { durationSeconds, width: nativeW, height: nativeH } = await probeVideo(videoPath)
  const fps = 30
  const fullDurationInFrames = Math.ceil(durationSeconds * fps)

  // Calculate frame range from trim
  const startFrame = trim ? Math.floor(trim.start * fps) : 0
  const endFrame = trim ? Math.ceil(trim.end * fps) : fullDurationInFrames

  const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3333/api'

  // Enrich video layers: use HTTP src (Remotion doesn't support file://), inject native dimensions
  const enrichedLayers: Layer[] = layers.map((layer) => {
    if ((layer.type === 'gameplay' || layer.type === 'facecam') && layer.video) {
      return {
        ...layer,
        video: {
          ...layer.video,
          src: `${API_BASE}/clips/${jobId}/${clipFilename}`,
          nativeWidth: nativeW,
          nativeHeight: nativeH,
        },
      }
    }
    return layer
  })

  const serveUrl = await getBundle()

  const composition = await selectComposition({
    serveUrl,
    id: 'CuttieVideo',
    inputProps: { layers: enrichedLayers },
  })

  await renderMedia({
    composition: { ...composition, durationInFrames: fullDurationInFrames, fps, width: 1080, height: 1920 },
    serveUrl,
    codec: 'h264',
    outputLocation: outputPath,
    inputProps: { layers: enrichedLayers },
    ...(startFrame > 0 ? { startFrom: startFrame } : {}),
    ...(endFrame < fullDurationInFrames ? { endAt: endFrame } : {}),
    onProgress: ({ progress }) => onProgress(Math.round(progress * 100)),
    timeoutInMilliseconds: 5 * 60 * 1000, // 5 min max
  })

  const sizeMb = statSync(outputPath).size / 1024 / 1024
  return { sizeMb }
}
