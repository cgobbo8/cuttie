import { describe, expect, it } from "vitest";
import { projectPath, projectStage } from "./projects";

describe("projectStage", () => {
  it("follows the four steps", () => {
    expect(projectStage({ status: "ANALYZING_CLIPS", kept_count: 0, export_count: 0 })).toBe("analyzing");
    expect(projectStage({ status: "ERROR", kept_count: 2, export_count: 0 })).toBe("error");
    expect(projectStage({ status: "DONE", kept_count: 0, export_count: 3 })).toBe("choose");
    expect(projectStage({ status: "DONE", kept_count: 4, export_count: 1 })).toBe("edit");
    expect(projectStage({ status: "DONE", kept_count: 4, export_count: 4 })).toBe("exported");
  });

  it("opens the screen of the current step", () => {
    expect(projectPath("j", "choose")).toBe("/j");
    expect(projectPath("j", "analyzing")).toBe("/j");
    expect(projectPath("j", "edit")).toBe("/j/montage");
    expect(projectPath("j", "exported")).toBe("/j/export");
  });
});
