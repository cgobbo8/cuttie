/**
 * The length the streamer aims for when the AI cuts a clip (Choisir, « Montage IA »).
 *
 * Left free, the AI keeps what a short posted on the networks lasts (45 s to 1 min 30). With a
 * length, it aims for about that, and a clip that holds less of the live than what is asked
 * grows first, 30 seconds at a time (the « + 30 s » of the clip's strip).
 */

/** The lengths offered, seconds */
export const CUT_TARGETS = [30, 45, 60, 90] as const;

/** null: left to the AI */
export type CutTarget = (typeof CUT_TARGETS)[number] | null;

const key = (jobId: string) => `cuttie_cut_target_${jobId}`;

/** The length chosen for this project the last time, null when it was left free (or never chosen) */
export function readCutTarget(jobId: string): CutTarget {
  try {
    const kept = Number(localStorage.getItem(key(jobId)));
    return (CUT_TARGETS as readonly number[]).includes(kept) ? (kept as CutTarget) : null;
  } catch {
    return null;
  }
}

export function saveCutTarget(jobId: string, target: CutTarget): void {
  try {
    if (target === null) localStorage.removeItem(key(jobId));
    else localStorage.setItem(key(jobId), String(target));
  } catch {
    // Storage refused: the choice lasts as long as the page
  }
}

/** The clip holds less of the live than the length aimed for: nothing could be cut out of it */
export function tooShortFor(clipSeconds: number, target: CutTarget): boolean {
  return target !== null && clipSeconds < target;
}

/**
 * The sides a clip grows on, one « + 30 s » at a time, until it holds the length aimed for:
 * after it first (the reaction), then before (the context). Four are enough to take a clip
 * of 45 seconds past 1 min 30 even when its cut sits in the middle.
 */
export const GROW_ORDER: readonly ("end" | "start")[] = ["end", "start", "end", "start"];
