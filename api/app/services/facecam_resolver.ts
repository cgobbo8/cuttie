/**
 * Which webcam rectangle to use for a live, and whether the cam shows in a
 * given clip.
 *
 * The streamer confirms where their cam usually sits (brand kit). Every
 * analysis locates the cam again on its clips (worker facecam.json): when it
 * sits where it usually does, the confirmed rectangle wins (it may have been
 * adjusted by hand); when it moved, this live's detection wins. A rectangle
 * set by hand for one live beats both.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type FacecamSource = 'live' | 'brand' | 'detected'

export interface ResolvedFacecam {
  rect: Rect | null
  source: FacecamSource | null
  /** The cam is not where it usually is on this live */
  moved: boolean
}

/** Overlap ratio of two rectangles (intersection over union) */
export function iou(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.w * a.h + b.w * b.h - inter)
}

/** Below this overlap the cam is considered moved */
export const SAME_PLACE_IOU = 0.5

export function resolveFacecam(input: {
  /** Set by hand for this live (false = no cam on this live) */
  live: Rect | false | null
  /** The streamer's usual position (false = they have no webcam) */
  brand: Rect | false | null
  /** Located on this live's clips */
  detected: Rect | null
}): ResolvedFacecam {
  const { live, brand, detected } = input
  if (live === false) return { rect: null, source: 'live', moved: false }
  if (live) return { rect: live, source: 'live', moved: false }
  if (brand === false) return { rect: null, source: 'brand', moved: false }
  if (brand && detected) {
    return iou(brand, detected) >= SAME_PLACE_IOU
      ? { rect: brand, source: 'brand', moved: false }
      : { rect: detected, source: 'detected', moved: true }
  }
  if (brand) return { rect: brand, source: 'brand', moved: false }
  if (detected) return { rect: detected, source: 'detected', moved: false }
  return { rect: null, source: null, moved: false }
}

/**
 * Whether the cam shows in a clip, from the centers of the people the worker
 * saw on its frames. Unknown (clip not checked) counts as visible.
 */
export function camVisible(rect: Rect | null, people: [number, number][] | undefined): boolean {
  if (!rect) return false
  if (!people) return true
  const mx = rect.w * 0.1
  const my = rect.h * 0.1
  return people.some(
    ([x, y]) => x >= rect.x - mx && x <= rect.x + rect.w + mx && y >= rect.y - my && y <= rect.y + rect.h + my
  )
}

/** Scale a rectangle measured on a `fromW`x`fromH` frame to another size */
export function scaleRect(rect: Rect, fromW: number, fromH: number, toW: number, toH: number): Rect {
  const sx = fromW ? toW / fromW : 1
  const sy = fromH ? toH / fromH : 1
  return { x: Math.round(rect.x * sx), y: Math.round(rect.y * sy), w: Math.round(rect.w * sx), h: Math.round(rect.h * sy) }
}
