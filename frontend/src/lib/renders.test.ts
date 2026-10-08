import { describe, expect, it } from "vitest";
import type { RenderStatus } from "./api";
import { activeRenderId, groupByProject, latestPerClip, libraryRenders } from "./renders";

const r = (id: string, job: string, clip: string, status: RenderStatus["status"], at: string, progress = 0): RenderStatus => ({
  render_id: id,
  job_id: job,
  clip_filename: clip,
  status,
  progress,
  created_at: at,
  vod_title: `Live ${job}`,
});

const renders = [
  r("1", "a", "x.mp4", "error", "2026-10-08T15:46:00Z"),
  r("2", "a", "x.mp4", "done", "2026-10-08T15:51:00Z"),
  r("3", "a", "y.mp4", "error", "2026-10-08T15:47:00Z"),
  r("4", "b", "z.mp4", "done", "2026-10-08T16:00:00Z"),
  r("5", "a", "x.mp4", "done", "2026-10-08T16:10:00Z"),
];

describe("renders", () => {
  it("keeps the latest render of each clip", () => {
    expect(latestPerClip(renders, "a").map((x) => x.render_id)).toEqual(["3", "5"]);
  });

  it("hides failures that were redone, keeps every finished version", () => {
    expect(libraryRenders(renders).map((x) => x.render_id)).toEqual(["2", "3", "4", "5"]);
  });

  it("groups by project, most recent export first", () => {
    const groups = groupByProject(libraryRenders(renders));
    expect(groups.map((g) => g.jobId)).toEqual(["a", "b"]);
    expect(groups[0].renders.map((x) => x.render_id)).toEqual(["3", "2", "5"]);
    expect(groups[0].vodTitle).toBe("Live a");
  });

  it("finds the render really going", () => {
    expect(activeRenderId([r("1", "a", "x", "rendering", "t"), r("2", "a", "y", "rendering", "t", 40)])).toBe("2");
    expect(activeRenderId([r("1", "a", "x", "done", "t")])).toBeNull();
  });
});
