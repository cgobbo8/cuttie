import { describe, expect, it } from "vitest";
import type { CompilationSummary, LiveCompilations } from "./api";
import { compilationStatus, copyName, libraryGroups } from "./compilationLibrary";

const card = (id: string, more: Partial<CompilationSummary> = {}): CompilationSummary => ({
  id, name: id, length: 60, passages: 8, parts: 2, described: false, cover: null,
  created_at: "2026-11-10T10:00:00.000Z", updated_at: "2026-11-10T10:00:00.000Z", exported_at: null, render_id: null, ...more,
});
const live = (job_id: string, stream_date: string | null, compilations: CompilationSummary[]): LiveCompilations => ({
  job_id, title: job_id, streamer: null, game: null, duration: 3600, stream_date, created_at: "2026-11-01T00:00:00.000Z", vod_id: null, cover_clip: null, clips_freed: false, compilations,
});

describe("the library of compilations", () => {
  it("says where a compilation stands", () => {
    expect(compilationStatus(card("a", { passages: 0 }))).toBe("empty");
    expect(compilationStatus(card("a"))).toBe("draft");
    expect(compilationStatus(card("a", { exported_at: "2026-11-10T10:00:20.000Z" }))).toBe("exported");
    // Saved well after its export: what was exported is no longer what it is
    expect(compilationStatus(card("a", { exported_at: "2026-11-10T09:00:00.000Z" }))).toBe("changed");
  });

  it("groups by live, newest first, lives without a compilation left out", () => {
    const lives = [
      live("old", "2026-11-02T20:00:00Z", [card("x")]),
      live("none", "2026-11-12T20:00:00Z", []),
      live("new", "2026-11-09T20:00:00Z", [card("a"), card("b", { updated_at: "2026-11-11T10:00:00.000Z" })]),
      // Never dated by Twitch: the day it was analysed
      live("undated", null, [card("u")]),
    ];
    expect(libraryGroups(lives).map((l) => [l.job_id, l.compilations.map((c) => c.id)])).toEqual([["new", ["b", "a"]], ["old", ["x"]], ["undated", ["u"]]]);
    expect(libraryGroups(lives, "old").map((l) => l.job_id)).toEqual(["old"]);
    expect(libraryGroups(lives, "none")).toEqual([]);
  });

  it("names a copy with a name the live doesn't have yet", () => {
    expect(copyName("Calme", ["Calme"], "copie")).toBe("Calme (copie)");
    expect(copyName("Calme", ["Calme", "Calme (copie)"], "copie")).toBe("Calme (copie 2)");
    // A copy of a copy doesn't pile the word up
    expect(copyName("Calme (copie 2)", ["Calme", "Calme (copie)", "Calme (copie 2)"], "copie")).toBe("Calme (copie 3)");
  });
});
