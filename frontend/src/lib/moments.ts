import type { ClipSelection, HotPoint } from "./api";

/** A detected moment as the streamer sorts it */
export type MomentState = "kept" | "passed" | "todo";

export interface Moment {
  hp: HotPoint;
  filename: string;
  /** 1 = best */
  rank: number;
  /** 0-100 */
  score: number;
  /** Bounds in the VOD, seconds */
  start: number;
  end: number;
  duration: number;
  state: MomentState;
  /** Trim bounds in clip seconds */
  trim: [number, number] | null;
  /** Better-ranked moment covering the same passage, if any */
  duplicateOf: Moment | null;
}

function overlapShare(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const inter = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return inter > 0 && shorter > 0 ? inter / shorter : 0;
}

/** Moments with a clip, best first, with the streamer's choices applied */
export function buildMoments(hotPoints: HotPoint[], selection: Record<string, ClipSelection>): Moment[] {
  const moments: Moment[] = hotPoints
    .filter((hp) => hp.clip_filename)
    .sort((a, b) => (b.final_score ?? b.score) - (a.final_score ?? a.score))
    .map((hp, i) => {
      const start = hp.clip_start ?? Math.max(0, hp.timestamp_seconds - 30);
      const end = hp.clip_end ?? hp.timestamp_seconds + 30;
      const choice = selection[hp.clip_filename!] ?? {};
      return {
        hp,
        filename: hp.clip_filename!,
        rank: i + 1,
        score: Math.round((hp.final_score ?? hp.score) * 100),
        start,
        end,
        duration: end - start,
        state: choice.state ?? "todo",
        trim: choice.trim ?? null,
        duplicateOf: null,
      };
    });

  // Two clips of the same passage: point the weaker one to the better one
  for (let i = 0; i < moments.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlapShare(moments[i], moments[j]) >= 0.5) {
        moments[i].duplicateOf = moments[j];
        break;
      }
    }
  }
  return moments;
}

/** Index of the next moment still to sort after `from` (wrapping), or -1 */
export function nextTodo(moments: Moment[], from: number): number {
  for (let k = 1; k <= moments.length; k++) {
    const i = (from + k) % moments.length;
    if (moments[i].state === "todo") return i;
  }
  return -1;
}

export function countStates(moments: Moment[]): Record<MomentState, number> {
  const counts: Record<MomentState, number> = { kept: 0, passed: 0, todo: 0 };
  for (const m of moments) counts[m.state]++;
  return counts;
}
