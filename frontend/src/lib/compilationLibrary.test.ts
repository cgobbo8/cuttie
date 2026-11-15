import { describe, expect, it } from "vitest";
import type { CompilationSummary, LiveCompilations, TwitchVod } from "./api";
import { compilationStatus, copyName, libraryCount, libraryGroups, namesKeptWith, vodsToAnalyse } from "./compilationLibrary";
import { aboutCost } from "./format";

const card = (id: string, more: Partial<CompilationSummary> = {}): CompilationSummary => ({
  id, name: id, length: 60, passages: 8, parts: 2, described: false, cover: null, cover_job: null, home: "live", lives: ["live"],
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

  it("has a compilation made from several lives with each of them, and counts it once", () => {
    // Kept with the newer live, made from both: the API lists the same card with each
    const both = card("both", { home: "new", lives: ["new", "old"], updated_at: "2026-11-12T10:00:00.000Z" });
    const lives = [
      live("old", "2026-10-11T20:00:00Z", [card("x", { home: "old", lives: ["old"] }), both]),
      live("new", "2026-11-09T20:00:00Z", [both, card("a", { home: "new", lives: ["new"] })]),
    ];
    expect(libraryGroups(lives).map((l) => [l.job_id, l.compilations.map((c) => c.id)])).toEqual([["new", ["both", "a"]], ["old", ["both", "x"]]]);
    // The older live alone: it is still there, and still says where it opens
    expect(libraryGroups(lives, "old")[0].compilations.map((c) => [c.id, c.home])).toEqual([["both", "new"], ["x", "old"]]);
    expect(libraryCount(lives)).toBe(3);
    // A copy is kept where its original is: its name is checked against that live's own
    expect(namesKeptWith(lives, "new")).toEqual(["both", "a"]);
    expect(namesKeptWith(lives, "old")).toEqual(["x"]);
  });

  it("lists the lives of the channel that are still to analyse, and says what it costs", () => {
    const vod = (id: string, published_at: string, job: Partial<NonNullable<TwitchVod["job"]>> | null = null, more: Partial<TwitchVod> = {}): TwitchVod => ({
      id, title: id, duration_seconds: 3600, published_at, view_count: 0, thumbnail_url: null, thumbnail_large_url: null, game: null, url: `https://twitch.tv/videos/${id}`,
      job: job ? { id: `job-${id}`, status: "DONE", progress: null, clip_count: 0, ...job } : null, ...more,
    });
    const vods = [
      vod("done", "2026-11-09T20:00:00Z", {}),
      vod("old", "2026-10-01T20:00:00Z"),
      vod("running", "2026-11-05T20:00:00Z", { status: "ANALYZING_CLIPS" }),
      vod("failed", "2026-11-07T20:00:00Z", { status: "ERROR" }),
      // Being streamed right now: nothing to analyse yet
      vod("live", "2026-11-14T20:00:00Z", null, { recording: true }),
    ];
    expect(vodsToAnalyse(vods).map(({ vod: v, state }) => [v.id, state])).toEqual([["failed", "failed"], ["running", "running"], ["old", "new"]]);
    expect(aboutCost(0.3, "fr")).toBe("≈ 0,30 $");
    expect(aboutCost(0.3, "en")).toBe("≈ 0.30 $");
  });

  it("names a copy with a name the live doesn't have yet", () => {
    expect(copyName("Calme", ["Calme"], "copie")).toBe("Calme (copie)");
    expect(copyName("Calme", ["Calme", "Calme (copie)"], "copie")).toBe("Calme (copie 2)");
    // A copy of a copy doesn't pile the word up
    expect(copyName("Calme (copie 2)", ["Calme", "Calme (copie)", "Calme (copie 2)"], "copie")).toBe("Calme (copie 3)");
  });
});
