/**
 * A clip cut in several pieces (Choisir): "keep the setup, drop the middle,
 * keep the punchline". The pieces are stored with the streamer's choice
 * (`selection[clip].segments`, clip seconds) next to `trim`, which stays the
 * whole span they cover: what only knows one cut (the webcam check, the
 * advanced editor) keeps working.
 */

export type Range = [number, number]

/** Shortest piece kept, seconds (same as the app's montage.ts) */
export const MIN_PIECE = 0.4
const TOUCH = 0.05

const hundredth = (s: number) => Math.round(s * 100) / 100
const tenth = (s: number) => Math.round(s * 10) / 10

/** Pieces as sent by the app: [[start, end], ...] in seconds, null when it isn't that */
export function parseRanges(raw: unknown): Range[] | null {
  if (!Array.isArray(raw) || raw.length > 200) return null
  const ranges: Range[] = []
  for (const item of raw) {
    const [start, end] = Array.isArray(item) ? item.map(Number) : []
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null
    ranges.push([start, end])
  }
  return ranges
}

/**
 * Pieces in order, the tiny ones dropped. Pieces that overlap become one;
 * pieces that only touch stay two (a cut the streamer made at the playhead, a
 * part kept right before another), as in the app's montage.ts.
 */
export function normalizeRanges(ranges: Range[], minLength = MIN_PIECE): Range[] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0])
  const pieces: Range[] = []
  for (const [a, b] of sorted) {
    const last = pieces[pieces.length - 1]
    if (last && a < last[1] - TOUCH) last[1] = Math.max(last[1], b)
    else pieces.push([last && a <= last[1] + TOUCH ? last[1] : a, b])
  }
  return pieces.filter(([a, b]) => b - a >= minLength).map(([a, b]): Range => [hundredth(a), hundredth(b)])
}

/** From the first piece's start to the last one's end, as `trim` stores it */
export function envelope(ranges: Range[]): Range {
  return [tenth(ranges[0][0]), tenth(ranges[ranges.length - 1][1])]
}

/**
 * The pieces after "+30 s" on one side: they move with the clip's clock when
 * its file grew before (`addedBefore` seconds), then the first piece starts
 * (or the last one ends) where the new cut does.
 */
export function extendPieces(pieces: Range[], side: 'start' | 'end', trim: Range, addedBefore: number): Range[] {
  const moved = pieces.map(([a, b]): Range => [a + addedBefore, b + addedBefore])
  if (side === 'start') moved[0] = [trim[0], moved[0][1]]
  else moved[moved.length - 1] = [moved[moved.length - 1][0], trim[1]]
  return normalizeRanges(moved)
}
