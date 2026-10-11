import { useEffect, useState } from "react";
import { getJobStatus, listJobs, type HotPoint, type JobResponse } from "./api";

export interface LatestMoments {
  job: JobResponse;
  /** Moments with a clip, best first */
  hotPoints: HotPoint[];
}

/**
 * The most recent finished analysis and its moments: used to pick up where the
 * streamer left off, and as real footage for template previews.
 * `refreshKey` reloads it (e.g. when an analysis just finished).
 */
export function useLatestMoments(refreshKey?: unknown): LatestMoments | null | undefined {
  const [latest, setLatest] = useState<LatestMoments | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await listJobs({ per_page: 12 });
        // Clips freed to make room can't play: the latest project that still has them
        const done = page.data.find((j) => j.status === "DONE" && !j.clips_freed_at);
        if (!done) {
          if (!cancelled) setLatest(null);
          return;
        }
        const job = await getJobStatus(done.job_id);
        const hotPoints = (job.hot_points ?? [])
          .filter((hp) => hp.clip_filename)
          .sort((a, b) => (b.final_score ?? b.score) - (a.final_score ?? a.score));
        if (!cancelled) setLatest({ job, hotPoints });
      } catch {
        if (!cancelled) setLatest(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return latest;
}
