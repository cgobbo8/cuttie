import type { RenderStatus } from "./api";

/** The latest render of each clip of a project, oldest first */
export function latestPerClip(renders: RenderStatus[], jobId: string): RenderStatus[] {
  const byClip = new Map<string, RenderStatus>();
  for (const r of renders) {
    if (r.job_id !== jobId) continue;
    const prev = byClip.get(r.clip_filename);
    if (!prev || r.created_at > prev.created_at) byClip.set(r.clip_filename, r);
  }
  return [...byClip.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Renders run one at a time: among those marked rendering, the one really going */
export function activeRenderId(renders: RenderStatus[]): string | null {
  const running = renders.filter((r) => r.status === "rendering");
  return (running.find((r) => r.progress > 0) ?? running[0])?.render_id ?? null;
}

/**
 * What the exports library shows: every finished export (several versions of
 * a clip are kept), plus the unfinished ones that weren't redone since.
 */
export function libraryRenders(renders: RenderStatus[]): RenderStatus[] {
  return renders.filter(
    (r) =>
      r.status !== "error" ||
      !renders.some((o) => o.job_id === r.job_id && o.clip_filename === r.clip_filename && o.status === "done" && o.created_at > r.created_at),
  );
}

export interface ProjectRenders {
  jobId: string;
  vodTitle: string | null;
  vodGame: string | null;
  renders: RenderStatus[];
}

/** Renders grouped by project: the project exported most recently first, its clips in export order */
export function groupByProject(renders: RenderStatus[]): ProjectRenders[] {
  const groups = new Map<string, ProjectRenders>();
  for (const r of [...renders].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const group = groups.get(r.job_id) ?? { jobId: r.job_id, vodTitle: r.vod_title ?? null, vodGame: r.vod_game ?? null, renders: [] };
    group.renders.push(r);
    groups.set(r.job_id, group);
  }
  return [...groups.values()].map((g) => ({ ...g, renders: g.renders.reverse() }));
}
