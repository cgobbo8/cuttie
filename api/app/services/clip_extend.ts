/**
 * "+30 s" on one side of a clip's cut (the trim strip in Choisir).
 *
 * The cut grows by 30 s on that side. When it would go past the clip's file,
 * the file grows too (by 30 s, within the live): the worker extracts it again
 * from the live (clip_tools.extend_clip), and everything timed on the clip's
 * clock moves with its new start.
 */

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { CLIPS_DIR } from '#services/data_paths'

export const EXTEND_SECONDS = 30

export type Side = 'start' | 'end'

export interface ExtendPlan {
  /** The clip's new bounds in the live, when its file has to grow */
  file: { start: number; end: number } | null
  /** The cut once done, in clip seconds (on the new clock when the file grew before) */
  trim: [number, number]
}

const tenth = (s: number) => Math.round(s * 10) / 10

/** The cut the AI suggested (clip seconds), as the app applies it (moments.ts) */
export function suggestedCut(hp: any): [number, number] | null {
  const llm = hp?.llm
  if (llm?.cut_start == null || llm?.cut_end == null || llm.cut_end - llm.cut_start < 5) return null
  return [llm.cut_start, llm.cut_end]
}

/**
 * The cut 30 s longer on `side`. `fileStart` / `fileEnd`: where the clip's file
 * sits in the live; `trim`: the cut now (clip seconds). Null when the live
 * itself starts or ends there.
 */
export function planExtend(
  side: Side,
  fileStart: number,
  fileEnd: number,
  trim: [number, number],
  liveDuration: number
): ExtendPlan | null {
  const duration = fileEnd - fileStart
  if (side === 'start') {
    const want = trim[0] - EXTEND_SECONDS
    if (want >= 0) return { file: null, trim: [tenth(want), tenth(trim[1])] }
    const start = Math.max(0, fileStart - EXTEND_SECONDS)
    const added = fileStart - start
    if (added < 0.5) return trim[0] > 0.05 ? { file: null, trim: [0, tenth(trim[1])] } : null
    return { file: { start: tenth(start), end: fileEnd }, trim: [tenth(Math.max(0, want + added)), tenth(trim[1] + added)] }
  }
  const want = trim[1] + EXTEND_SECONDS
  if (want <= duration) return { file: null, trim: [tenth(trim[0]), tenth(want)] }
  const end = liveDuration > 0 ? Math.min(liveDuration, fileEnd + EXTEND_SECONDS) : fileEnd + EXTEND_SECONDS
  if (end - fileEnd < 0.5) return trim[1] < duration - 0.05 ? { file: null, trim: [tenth(trim[0]), tenth(duration)] } : null
  return { file: { start: fileStart, end: tenth(end) }, trim: [tenth(trim[0]), tenth(Math.min(want, end - fileStart))] }
}

/** The clip's file started `added` seconds earlier: what the AI timed on its clock follows */
export function shiftClipClock(hp: any, added: number): any {
  if (!added || !hp?.llm) return hp
  const llm = { ...hp.llm }
  if (llm.cut_start != null) llm.cut_start = tenth(llm.cut_start + added)
  if (llm.cut_end != null) llm.cut_end = tenth(llm.cut_end + added)
  if (Array.isArray(llm.key_moments)) {
    llm.key_moments = llm.key_moments.map((k: any) => ({ ...k, time: tenth((k.time ?? 0) + added) }))
  }
  return { ...hp, llm }
}

/** Where a clip's file sits in the live (its _meta.json), null when unknown */
export function readClipMeta(jobId: string, clipFilename: string): { vod_start: number; vod_end: number } | null {
  const base = path.basename(clipFilename, path.extname(clipFilename))
  const metaPath = path.join(CLIPS_DIR, jobId, `${base}_meta.json`)
  if (!existsSync(metaPath)) return null
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    return Number.isFinite(meta?.vod_start) && Number.isFinite(meta?.vod_end) ? meta : null
  } catch {
    return null
  }
}

/** Frames and backdrop cached for a clip: made again from the new file when asked */
export function dropClipCaches(jobId: string, clipFilename: string): void {
  const base = path.basename(clipFilename, path.extname(clipFilename))
  const thumbs = path.join(CLIPS_DIR, jobId, 'thumbs')
  // <clip>_<width>_<tenths of a second>.jpg (clips_controller.thumb)
  const ours = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+_\\d+\\.jpg$`)
  if (existsSync(thumbs)) {
    for (const name of readdirSync(thumbs)) {
      if (ours.test(name)) rmSync(path.join(thumbs, name), { force: true })
    }
  }
  rmSync(path.join(CLIPS_DIR, jobId, 'bg', `${base}_bg.mp4`), { force: true })
}
