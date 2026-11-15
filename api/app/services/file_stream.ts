import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream } from 'node:fs'

/**
 * Sends a file, whole or the part a player asks for (Range): what lets a video or a
 * music be played from anywhere in it. The caller has set the headers that say what it is.
 */
export function streamFile({ request, response }: Pick<HttpContext, 'request' | 'response'>, filePath: string, size: number) {
  response.header('Accept-Ranges', 'bytes')
  const range = request.header('range')
  if (!range) {
    response.header('Content-Length', String(size))
    return response.stream(createReadStream(filePath))
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  let start = match?.[1] ? Number(match[1]) : NaN
  let end = match?.[2] ? Number(match[2]) : size - 1
  if (match && !match[1] && match[2]) {
    // Suffix range: last N bytes
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  }
  if (!match || Number.isNaN(start) || start > end || start >= size) {
    response.header('Content-Range', `bytes */${size}`)
    return response.status(416).send('')
  }
  end = Math.min(end, size - 1)

  response.status(206)
  response.header('Content-Range', `bytes ${start}-${end}/${size}`)
  response.header('Content-Length', String(end - start + 1))
  return response.stream(createReadStream(filePath, { start, end }))
}
