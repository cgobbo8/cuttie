import { beforeEach, describe, expect, it } from "vitest";
import { CUT_TARGETS, GROW_ORDER, readCutTarget, saveCutTarget, tooShortFor } from "./cutTarget";

describe("the length aimed for when the AI cuts a clip", () => {
  beforeEach(() => localStorage.clear());

  it("offers what a short lasts on the networks", () => {
    expect([...CUT_TARGETS]).toEqual([30, 45, 60, 90]);
  });

  it("is left free until the streamer chooses, and kept for the project", () => {
    expect(readCutTarget("job-a")).toBeNull();
    saveCutTarget("job-a", 60);
    expect(readCutTarget("job-a")).toBe(60);
    // Another project has its own
    expect(readCutTarget("job-b")).toBeNull();
    // Back to free
    saveCutTarget("job-a", null);
    expect(readCutTarget("job-a")).toBeNull();
    // Something else written there is not a length
    localStorage.setItem("cuttie_cut_target_job-a", "75");
    expect(readCutTarget("job-a")).toBeNull();
    localStorage.setItem("cuttie_cut_target_job-a", "libre");
    expect(readCutTarget("job-a")).toBeNull();
  });

  it("says when a clip holds less than the length aimed for", () => {
    expect(tooShortFor(60, 90)).toBe(true);
    expect(tooShortFor(90, 90)).toBe(false);
    expect(tooShortFor(120, 90)).toBe(false);
    // Left free: the clip is what it is
    expect(tooShortFor(20, null)).toBe(false);
  });

  it("grows a clip after it first, then before", () => {
    expect([...GROW_ORDER]).toEqual(["end", "start", "end", "start"]);
  });
});
