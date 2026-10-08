import type { JobSummary } from "./api";

/** Where a project stands, from the streamer's point of view */
export type ProjectStage = "analyzing" | "error" | "choose" | "edit" | "exported";

export function projectStage(job: Pick<JobSummary, "status" | "kept_count" | "export_count">): ProjectStage {
  if (job.status === "ERROR") return "error";
  if (job.status !== "DONE") return "analyzing";
  if (job.kept_count === 0) return "choose";
  return job.export_count >= job.kept_count ? "exported" : "edit";
}

/** The screen to open for a project: the step it is at */
export function projectPath(jobId: string, stage: ProjectStage): string {
  if (stage === "edit") return `/${jobId}/montage`;
  if (stage === "exported") return `/${jobId}/export`;
  return `/${jobId}`;
}
