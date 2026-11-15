/**
 * How loud a video's background music is from one moment to the next. A curve is
 * where the level starts, then each change: at `at` seconds of the video, taking
 * `over` seconds, to the level `to` (1: as loud as the video's own levelled sound).
 * Copied to api/remotion/music by scripts/sync-remotion.mjs: the preview plays the
 * very curve the export mixes.
 */
export interface MusicCurve {
  start: number;
  ramps: [at: number, over: number, to: number][];
}

/** The music's level at a time of the video (seconds) */
export function gainAt(curve: MusicCurve, time: number): number {
  let level = curve.start;
  for (const [at, over, to] of curve.ramps) {
    if (time <= at) break;
    const k = over > 0 ? (time - at) / over : 1;
    // On its way there: that far along, and nothing later has started
    if (k < 1) return level + (to - level) * k;
    level = to;
  }
  return level;
}
