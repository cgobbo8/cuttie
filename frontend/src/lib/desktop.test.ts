import { describe, expect, it } from "vitest";
import { afterCheck, afterEvent, desktop, updatePending, type UpdateState } from "./desktop";

describe("update state", () => {
  it("reads the shell's answer to a check", () => {
    expect(afterCheck({ state: "dev", current: "0.1.0" })).toEqual({ phase: "dev" });
    expect(afterCheck({ state: "latest", current: "0.1.0", version: "0.1.0", notes: null })).toEqual({ phase: "latest" });
    expect(afterCheck({ state: "available", current: "0.1.0", version: "0.2.0", notes: "Plus rapide" })).toEqual({
      phase: "available",
      version: "0.2.0",
      notes: "Plus rapide",
    });
    // Available without a version: nothing to offer
    expect(afterCheck({ state: "available", current: "0.1.0", version: null, notes: null })).toEqual({ phase: "latest" });
  });

  it("follows the download, then waits for the restart", () => {
    let state: UpdateState = { phase: "available", version: "0.2.0", notes: null };
    state = afterEvent(state, { state: "downloading", percent: 12 });
    expect(state).toEqual({ phase: "downloading", version: "0.2.0", percent: 12 });
    state = afterEvent(state, { state: "downloading", percent: 80 });
    expect(state).toEqual({ phase: "downloading", version: "0.2.0", percent: 80 });
    state = afterEvent(state, { state: "ready", version: "0.2.0" });
    expect(state).toEqual({ phase: "ready", version: "0.2.0" });
    // A late progress event doesn't take the button away
    expect(afterEvent(state, { state: "downloading", percent: 100 })).toEqual(state);
  });

  it("keeps installing once the restart is asked", () => {
    const installing: UpdateState = { phase: "installing", version: "0.2.0" };
    expect(afterEvent(installing, { state: "ready", version: "0.2.0" })).toEqual(installing);
  });

  it("shows errors", () => {
    expect(afterEvent({ phase: "downloading", version: "0.2.0", percent: 40 }, { state: "error", message: "net::ERR_CONNECTION_RESET" })).toEqual({
      phase: "error",
      message: "net::ERR_CONNECTION_RESET",
    });
  });

  it("asks for a click in the top bar only while an update waits", () => {
    expect(updatePending({ phase: "available", version: "0.2.0", notes: null })).toBe(true);
    expect(updatePending({ phase: "downloading", version: "0.2.0", percent: 3 })).toBe(true);
    expect(updatePending({ phase: "ready", version: "0.2.0" })).toBe(true);
    for (const phase of ["idle", "checking", "latest", "dev"] as const) expect(updatePending({ phase })).toBe(false);
    expect(updatePending({ phase: "error", message: "x" })).toBe(false);
  });

  it("is absent in a browser", () => {
    expect(desktop).toBeNull();
  });
});
