import { describe, expect, it } from "vitest";
import { fromOldPrefs } from "./clipVideo";

describe("what the montage screen of before had set for a clip", () => {
  it("goes on its video: one template for all the clips, or each its own", () => {
    expect(fromOldPrefs({ template: "action", perClip: { "a.mp4": "reaction" }, applyAll: true }, "a.mp4")).toEqual({ template: "action" });
    expect(fromOldPrefs({ template: "action", perClip: { "a.mp4": "reaction" }, applyAll: false }, "a.mp4")).toEqual({ template: "reaction" });
    // (a clip that had none of its own: the one of all)
    expect(fromOldPrefs({ template: "action", perClip: {}, applyAll: false }, "b.mp4")).toEqual({ template: "action" });
  });

  it("keeps the line written on it, its music and its intro", () => {
    expect(
      fromOldPrefs({ template: null, hooks: { "a.mp4": "  Il sort du mauvais côté  " }, music: { track: "phonk", volume: 1.4 }, musicPerClip: { "a.mp4": "none" }, intro: { style: "slam" }, applyAll: true }, "a.mp4"),
    ).toEqual({ hook: "Il sort du mauvais côté", music: { track: "phonk", volume: 1.4 }, intro: { style: "slam" } });
    // Each clip its own music: this one had none
    expect(fromOldPrefs({ music: { track: "phonk" }, musicPerClip: { "a.mp4": "none" }, applyAll: false }, "a.mp4")).toEqual({});
  });

  it("is nothing when nothing was set", () => {
    expect(fromOldPrefs(null, "a.mp4")).toEqual({});
    expect(fromOldPrefs({ template: null, perClip: {}, hooks: {}, applyAll: true }, "a.mp4")).toEqual({});
  });
});
