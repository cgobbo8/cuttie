/**
 * Remotion render service.
 * Bundles the composition once (cached), then calls renderMedia() per request.
 */

import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer'
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { Layer } from '../../remotion/editorTypes.js'
import { getPresignedUrl, uploadFile } from '#services/s3'

// Cached bundle — auto-invalidates when remotion/ source files change
let bundleUrl: string | null = null
let bundleTimestamp = 0
const REMOTION_DIR = path.resolve('./remotion')
const CLIPS_BASE = path.resolve('../backend/clips')

// Shared browser instance — reused across renders, auto-closes after idle
let browserInstance: Awaited<ReturnType<typeof openBrowser>> | null = null
let browserCloseTimer: ReturnType<typeof setTimeout> | null = null
const BROWSER_IDLE_TIMEOUT = 30_000 // 30s after last render

async function ensureBrowser() {
  if (browserCloseTimer) {
    clearTimeout(browserCloseTimer)
    browserCloseTimer = null
  }
  if (!browserInstance) {
    console.log('[Remotion] Opening shared browser...')
    browserInstance = await openBrowser('chrome')
    console.log('[Remotion] Browser ready')
  }
  return browserInstance
}

function scheduleBrowserClose() {
  if (browserCloseTimer) clearTimeout(browserCloseTimer)
  browserCloseTimer = setTimeout(async () => {
    if (browserInstance) {
      console.log('[Remotion] Closing idle browser...')
      try { await browserInstance.close({ silent: true }) } catch {}
      browserInstance = null
    }
    browserCloseTimer = null
  }, BROWSER_IDLE_TIMEOUT)
}

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
 * Convert a GIF to WebM (VP9 + alpha) using ffmpeg.
 * For looping: extends the video to fill clipDuration by repeating.
 * For one-shot: plays once then freezes on the last frame for the remaining duration.
 */
async function convertGifToWebm(
  gifUrl: string,
  clipDuration: number,
  loop: boolean,
  s3Key: string,
): Promise<string> {
  const tmp = mkdtempSync(path.join(tmpdir(), 'cuttie-gif-'))
  const gifPath = path.join(tmp, 'input.gif')
  const webmPath = path.join(tmp, 'output.webm')

  try {
    // Download GIF
    const resp = await fetch(gifUrl)
    if (!resp.ok) throw new Error(`Failed to download GIF: ${resp.status}`)
    const buf = Buffer.from(await resp.arrayBuffer())
    writeFileSync(gifPath, buf)

    if (loop) {
      // Loop enough times to fill the clip duration
      execSync(
        `ffmpeg -y -ignore_loop 0 -i "${gifPath}" -t ${clipDuration} -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 1M -cpu-used 4 -deadline realtime -an "${webmPath}"`,
        { timeout: 30000, stdio: 'pipe' },
      )
    } else {
      // Play once, then freeze last frame for the rest of the clip
      execSync(
        `ffmpeg -y -i "${gifPath}" -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 1M -cpu-used 4 -deadline realtime -an -vf "tpad=stop_mode=clone:stop_duration=${Math.ceil(clipDuration)}" "${webmPath}"`,
        { timeout: 30000, stdio: 'pipe' },
      )
    }

    // Upload to S3
    await uploadFile(s3Key, webmPath, 'video/webm')
    const presignedUrl = await getPresignedUrl(s3Key, 3600)

    return presignedUrl
  } finally {
    try { unlinkSync(gifPath) } catch {}
    try { unlinkSync(webmPath) } catch {}
    try { unlinkSync(tmp) } catch {} // rmdir
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
  /** Output width (default 1080) */
  width?: number
  /** Output height (default 1920) */
  height?: number
  /** Output FPS (default 30) */
  fps?: number
  onProgress: (pct: number) => void
}

export async function renderClip(opts: RenderOptions): Promise<{ sizeMb: number }> {
  const { layers, jobId, clipFilename, outputPath, trim, onProgress } = opts

  // Read dimensions from probe JSON (no ffprobe, no local clip needed)
  const { durationSeconds, width: nativeW, height: nativeH } = readProbe(jobId, clipFilename)
  const fps = opts.fps ?? 30
  const outputWidth = opts.width ?? 1080
  const outputHeight = opts.height ?? 1920
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
          const assetFilename = assetMatch[1]
          const assetPresignedUrl = await getPresignedUrl(`assets/${assetFilename}`, 3600)
          const isGif = assetFilename.toLowerCase().endsWith('.gif')

          if (isGif) {
            try {
              const gifLoop = layer.asset.gifLoop !== false
              const webmS3Key = `renders/${jobId}/gif_${assetFilename.replace(/\.gif$/i, '')}_${Date.now()}.webm`
              const webmUrl = await convertGifToWebm(assetPresignedUrl, durationSeconds, gifLoop, webmS3Key)
              console.log(`[Remotion] Converted GIF → WebM: ${assetFilename} (loop=${gifLoop})`)
              return {
                ...layer,
                asset: { ...layer.asset, src: assetPresignedUrl, gifVideoSrc: webmUrl },
              }
            } catch (err: any) {
              console.error(`[Remotion] GIF→WebM conversion failed: ${err.message}`)
              // Fall back to static image
            }
          }

          return {
            ...layer,
            asset: { ...layer.asset, src: assetPresignedUrl },
          }
        }
      }

      return layer
    })
  )

  // Scale layers if output resolution differs from the 1080×1920 canvas
  const CANVAS_W = 1080
  const CANVAS_H = 1920
  const scaleX = outputWidth / CANVAS_W
  const scaleY = outputHeight / CANVAS_H
  const needsScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001

  const finalLayers = needsScale
    ? enrichedLayers.map((layer) => {
        const scaled = {
          ...layer,
          transform: {
            ...layer.transform,
            x: Math.round(layer.transform.x * scaleX),
            y: Math.round(layer.transform.y * scaleY),
            width: Math.round(layer.transform.width * scaleX),
            height: Math.round(layer.transform.height * scaleY),
          },
          style: {
            ...layer.style,
            blur: layer.style.blur * scaleX,
            borderRadius: Math.round(layer.style.borderRadius * scaleX),
          },
        }
        // Scale subtitle font size
        if (scaled.subtitle) {
          scaled.subtitle = { ...scaled.subtitle, fontSize: Math.round(scaled.subtitle.fontSize * scaleX) }
        }
        // Scale text font size
        if (scaled.text) {
          scaled.text = { ...scaled.text, fontSize: Math.round(scaled.text.fontSize * scaleX) }
        }
        // Scale chat font size
        if (scaled.chat) {
          scaled.chat = { ...scaled.chat, fontSize: Math.round(scaled.chat.fontSize * scaleX) }
        }
        // Scale keyframes
        if (scaled.keyframes) {
          scaled.keyframes = scaled.keyframes.map((kf) => ({
            ...kf,
            x: Math.round(kf.x * scaleX),
            y: Math.round(kf.y * scaleY),
            width: Math.round(kf.width * scaleX),
            height: Math.round(kf.height * scaleY),
            borderRadius: Math.round(kf.borderRadius * scaleX),
            blur: kf.blur * scaleX,
          }))
        }
        return scaled
      })
    : enrichedLayers

  const [serveUrl, browser] = await Promise.all([getBundle(), ensureBrowser()])

  const composition = await selectComposition({
    serveUrl,
    id: 'CuttieVideo',
    inputProps: { layers: finalLayers },
    puppeteerInstance: browser,
  })

  await renderMedia({
    composition: { ...composition, durationInFrames: fullDurationInFrames, fps, width: outputWidth, height: outputHeight },
    serveUrl,
    codec: 'h264',
    videoBitrate: '5M',
    x264Preset: 'veryfast',
    hardwareAcceleration: 'if-possible',
    audioCodec: 'aac',
    jpegQuality: 80,
    offthreadVideoCacheSizeInBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    outputLocation: outputPath,
    inputProps: { layers: finalLayers },
    puppeteerInstance: browser,
    frameRange: (startFrame > 0 || endFrame < fullDurationInFrames)
      ? [startFrame, endFrame - 1] as [number, number]
      : null,
    onProgress: ({ progress }) => onProgress(Math.round(progress * 100)),
    timeoutInMilliseconds: 10 * 60 * 1000, // 10 min max
  })

  // Schedule browser close — will be cancelled if another render starts
  scheduleBrowserClose()

  const sizeMb = statSync(outputPath).size / 1024 / 1024
  return { sizeMb }
}
