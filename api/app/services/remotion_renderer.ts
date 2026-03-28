/**
 * Remotion render service.
 * Bundles the composition once (cached), then calls renderMedia() per request.
 */

import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Layer } from '../../remotion/editorTypes.js'
import { getPresignedUrl } from '#services/s3'

// Cached bundle — auto-invalidates when remotion/ source files change
let bundleUrl: string | null = null
let bundleTimestamp = 0
const REMOTION_DIR = path.resolve('./remotion')
const CLIPS_BASE = path.resolve('../backend/clips')

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

/** Read clip probe data from local JSON (written by Python worker) */
function readProbe(jobId: string, clipFilename: string): {
  durationSeconds: number
  width: number
  height: number
} {
  const base = path.basename(clipFilename, path.extname(clipFilename))
  const probePath = path.join(CLIPS_BASE, jobId, `${base}_probe.json`)

  if (existsSync(probePath)) {
    try {
      const probe = JSON.parse(readFileSync(probePath, 'utf-8'))
      return {
        durationSeconds: probe.duration ?? 0,
        width: probe.width ?? 1920,
        height: probe.height ?? 1080,
      }
    } catch {}
  }

  throw new Error(`Probe file not found: ${probePath}. Run the pipeline again to generate it.`)
}

/**
 * Extract frame delays from a GIF binary and compute a playbackRate that
 * matches browser behavior. Browsers clamp GIF frame delays < 20ms to ~100ms.
 * Returns a playbackRate to pass to @remotion/gif's <Gif> component.
 */
function computeGifPlaybackRate(buffer: Buffer): number {
  const delays: number[] = []

  // Parse GIF binary — look for Graphic Control Extension blocks (0x21 0xF9)
  for (let i = 0; i < buffer.length - 6; i++) {
    if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9 && buffer[i + 2] === 0x04) {
      // Delay time is at offset +3 (2 bytes, little-endian, in centiseconds)
      const delayCentiseconds = buffer[i + 4] | (buffer[i + 5] << 8)
      delays.push(delayCentiseconds * 10) // convert to ms
    }
  }

  if (delays.length === 0) return 1

  // Compute actual total duration (as declared in the GIF)
  const declaredTotal = delays.reduce((sum, d) => sum + d, 0)

  // Compute browser-equivalent duration (with clamping: delays < 20ms → 100ms)
  const browserTotal = delays.reduce((sum, d) => sum + (d < 20 ? 100 : d), 0)

  if (declaredTotal <= 0 || browserTotal <= 0) return 1

  return declaredTotal / browserTotal
}

async function analyzeGifAsset(s3Key: string): Promise<number> {
  try {
    const presignedUrl = await getPresignedUrl(s3Key, 60)
    const resp = await fetch(presignedUrl)
    if (!resp.ok) return 1
    const arrayBuffer = await resp.arrayBuffer()
    return computeGifPlaybackRate(Buffer.from(arrayBuffer))
  } catch {
    return 1
  }
}

export interface RenderOptions {
  renderId: string
  layers: Layer[]
  jobId: string
  clipFilename: string
  /** Absolute path where the output MP4 should be written (local temp) */
  outputPath: string
  /** Optional trim range in seconds */
  trim?: { start: number; end: number }
  onProgress: (pct: number) => void
}

export async function renderClip(opts: RenderOptions): Promise<{ sizeMb: number }> {
  const { layers, jobId, clipFilename, outputPath, trim, onProgress } = opts

  // Read dimensions from probe JSON (no ffprobe, no local clip needed)
  const { durationSeconds, width: nativeW, height: nativeH } = readProbe(jobId, clipFilename)
  const fps = 30
  const fullDurationInFrames = Math.ceil(durationSeconds * fps)

  // Calculate frame range from trim
  const startFrame = trim ? Math.floor(trim.start * fps) : 0
  const endFrame = trim ? Math.ceil(trim.end * fps) : fullDurationInFrames

  // Generate presigned S3 URL for the source clip (1 hour, plenty for a render)
  const clipPresignedUrl = await getPresignedUrl(`clips/${jobId}/${clipFilename}`, 3600)

  // Enrich layers: replace video src with presigned S3 URL, resolve asset URLs
  const enrichedLayers: Layer[] = await Promise.all(
    layers.map(async (layer) => {
      // Video layers (gameplay, facecam) → presigned clip URL
      if ((layer.type === 'gameplay' || layer.type === 'facecam') && layer.video) {
        return {
          ...layer,
          video: {
            ...layer.video,
            src: clipPresignedUrl,
            nativeWidth: nativeW,
            nativeHeight: nativeH,
          },
        }
      }

      // Asset layers → presigned S3 URL if src is an API path
      if (layer.type === 'asset' && layer.asset?.src) {
        const assetMatch = layer.asset.src.match(/\/api\/assets\/(.+)$/)
        if (assetMatch) {
          const s3Key = `assets/${assetMatch[1]}`
          const assetPresignedUrl = await getPresignedUrl(s3Key, 3600)
          const isGif = assetMatch[1].toLowerCase().endsWith('.gif')
          const gifPlaybackRate = isGif ? await analyzeGifAsset(s3Key) : undefined
          return {
            ...layer,
            asset: { ...layer.asset, src: assetPresignedUrl, gifPlaybackRate },
          }
        }
      }

      return layer
    })
  )

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
    frameRange: (startFrame > 0 || endFrame < fullDurationInFrames)
      ? [startFrame, endFrame - 1] as [number, number]
      : null,
    onProgress: ({ progress }) => onProgress(Math.round(progress * 100)),
    timeoutInMilliseconds: 5 * 60 * 1000, // 5 min max
  })

  const sizeMb = statSync(outputPath).size / 1024 / 1024
  return { sizeMb }
}
