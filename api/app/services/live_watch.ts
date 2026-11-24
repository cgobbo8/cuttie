/**
 * A live watched from any time, to go through it and pick a passage by hand.
 *
 * Twitch serves a VOD as an HLS playlist, which the app's player does not read. ffmpeg reads it
 * from the time asked and hands its pictures and its sound on as they are (nothing is encoded
 * again), as an MP4 written in fragments. The page feeds them to its player as they come (Media
 * Source: a stream handed to a player as a plain file cannot be moved in at all), so it can go
 * back and forth in what it holds; going further in the live is asking for another stream from there.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'
import { watchLive } from '#services/worker_client'

/** A stream runs this long at most, seconds: the player asks again from there when it gets to its end */
export const WATCH_SECONDS = 900

/** How ffmpeg turns a live's playlist, from a time on, into a stream a player takes as it comes */
export function watchArgs(url: string, from: number): string[] {
  return [
    '-v', 'error',
    // (asked before the playlist is opened: ffmpeg goes straight to the segment that holds that time)
    '-ss', String(Math.max(0, from)),
    '-i', url,
    '-t', String(WATCH_SECONDS),
    '-map', '0:v:0', '-map', '0:a:0?',
    '-c', 'copy',
    '-bsf:a', 'aac_adtstoasc',
    // No index at the end of the file (it never ends for the player): each fragment says what it holds.
    // The header waits for the first fragment (delay_moov): written before any sound has come, it
    // would not say how the sound is coded, and a player fed piece by piece refuses such a header
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof+delay_moov',
    '-f', 'mp4',
    'pipe:1',
  ]
}

/** Where a live is watched from at a time: its playlist, and the time playing really starts at (the head of the segment that holds it) */
export async function watchPlace(vodUrl: string, at: number): Promise<{ url: string; from: number }> {
  const place = await watchLive(vodUrl, Math.max(0, at))
  return { url: place.url, from: Number.isFinite(place.from) ? Math.max(0, place.from) : Math.max(0, at) }
}

// One stream at a time for each streamer: going elsewhere in the live stops the one before
const running = new Map<number, ChildProcess>()

/** A live's video from a time on, as a stream; `stop` ends it (the player went away, or asked for another time) */
export function watchStream(userId: number, url: string, from: number): { stream: Readable; stop: () => void } {
  running.get(userId)?.kill('SIGKILL')
  const child = spawn('ffmpeg', watchArgs(url, from), { stdio: ['ignore', 'pipe', 'ignore'] })
  running.set(userId, child)
  const stop = () => {
    child.kill('SIGKILL')
    if (running.get(userId) === child) running.delete(userId)
  }
  child.on('exit', () => running.get(userId) === child && running.delete(userId))
  return { stream: child.stdout!, stop }
}
