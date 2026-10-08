/**
 * Local file storage (replaces the old S3/MinIO bucket, same keys:
 * "clips/<job>/<file>", "renders/<job>/<file>", "assets/<file>").
 *
 * Files are served by GET /api/storage/* through short-lived signed URLs, so
 * <video>/<img> tags and the Remotion renderer can load them without auth headers.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import env from '#start/env'
import { STORAGE_DIR, storagePath } from '#services/data_paths'

export { storagePath }

function signature(key: string, expires: number): string {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(`${key}:${expires}`)
    .digest('base64url')
}

/** Check a signed storage URL's signature and expiry. */
export function verifySignature(key: string, expires: number, sig: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false
  const expected = Buffer.from(signature(key, expires))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}

/** Absolute base URL of this API (used by the Remotion renderer too). */
export function apiBaseUrl(): string {
  return `http://127.0.0.1:${env.get('PORT')}`
}

/** Store a local file under `key` (moves it; the source path is gone afterwards). */
export async function uploadFile(key: string, filePath: string, _contentType?: string): Promise<void> {
  const dest = storagePath(key)
  if (path.resolve(filePath) === dest) return
  mkdirSync(path.dirname(dest), { recursive: true })
  try {
    renameSync(filePath, dest)
  } catch {
    // Cross-device move
    copyFileSync(filePath, dest)
    unlinkSync(filePath)
  }
}

/** Signed GET URL for a stored file */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + expiresIn
  return `${apiBaseUrl()}/api/storage/${encodeKey(key)}?exp=${expires}&sig=${signature(key, expires)}`
}

/** Signed GET URL that makes the browser download the file under `downloadName` */
export async function getPresignedDownloadUrl(key: string, downloadName: string, expiresIn = 3600): Promise<string> {
  const url = await getPresignedUrl(key, expiresIn)
  return `${url}&download=${encodeURIComponent(downloadName)}`
}

/** Delete a stored file */
export async function deleteObject(key: string): Promise<void> {
  rmSync(storagePath(key), { force: true })
}

/** List stored keys under a prefix ending with "/" (non-recursive) */
export async function listObjects(prefix: string): Promise<string[]> {
  const dir = storagePath(prefix)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${prefix}${entry.name}`)
}

/** Check if a stored file exists and get its size */
export async function headObject(key: string): Promise<{ contentLength: number } | null> {
  try {
    return { contentLength: statSync(storagePath(key)).size }
  } catch {
    return null
  }
}

export { STORAGE_DIR }
