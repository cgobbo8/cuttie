import { describe, expect, it } from "vitest";
import type { Compilation, CompilationSummary, LiveCompilations } from "./api";
import { isWaiting, viralityLevel, waitingIn, withProposedFirst } from "./suggestions";

const idea = { key: "aaaaaaaaaaaa", pitch: "« Calme » revient 25 fois.", tags: ["running gag"], kind: "funny", score: 84, moments: [2421, 4414] };
const video = (more: Partial<Compilation> = {}): Compilation => ({
  id: "comp", name: "La malédiction du calme", sections: [{ id: "one", title: "", query: "", items: [] }], template: null, titles: true, hook: "", target: 65,
  brief: "Fais une vidéo sur le calme.", suggestion: idea, created_at: "", updated_at: "", ...more,
});
const card = (id: string, more: Partial<CompilationSummary> = {}): CompilationSummary => ({
  id, name: id, length: 0, passages: 0, parts: 0, described: true, cover: null, cover_job: null, home: "live", lives: ["live"],
  created_at: "2026-11-10T10:00:00.000Z", updated_at: "2026-11-10T10:00:00.000Z", exported_at: null, render_id: null, ...more,
});
const live = (job_id: string, compilations: CompilationSummary[]): LiveCompilations => ({
  job_id, title: job_id, streamer: null, game: null, duration: 3600, stream_date: null, created_at: null, vod_id: null, cover_clip: null, clips_freed: false, compilations,
});

describe("the videos the AI proposes", () => {
  it("wait until they are built", () => {
    expect(isWaiting(video())).toBe(true);
    // Built: it has passages, or at least the AI's answer
    const item = { id: "a", start: 1, end: 2, text: "", why: "", sources: ["ai"] };
    expect(isWaiting(video({ sections: [{ id: "one", title: "", query: "", items: [item] }] }))).toBe(false);
    expect(isWaiting(video({ answer: "Deux parties." }))).toBe(false);
    // The streamer's own empty compilation is not an idea waiting
    expect(isWaiting(video({ suggestion: undefined }))).toBe(false);
  });

  it("say how promising they are", () => {
    expect([92, 80, 79, 65, 64, 50].map(viralityLevel)).toEqual(["high", "high", "good", "good", "fair", "fair"]);
  });

  it("come first in their live, the most promising first, and are counted once", () => {
    const calm = card("calm", { waiting: true, suggestion: { ...idea, moments: 2, score: 84 } });
    const tiger = card("tiger", { waiting: true, suggestion: { ...idea, moments: 7, score: 88 } });
    const built = card("built", { suggestion: { ...idea, moments: 2 }, passages: 9 });
    const own = card("own", { described: false });
    expect(withProposedFirst([own, calm, built, tiger]).map((c) => c.id)).toEqual(["tiger", "calm", "own", "built"]);

    // Listed with each live it takes from: one idea all the same
    const shared = card("shared", { waiting: true, home: "a", lives: ["a", "b"] });
    const lives = [live("a", [shared, calm]), live("b", [shared, card("x", { home: "b" })])];
    expect(waitingIn(lives)).toBe(2);
    expect(waitingIn(lives, "a")).toBe(1);
    expect(waitingIn(lives, "live")).toBe(1);
    expect(waitingIn(lives, "b")).toBe(0);
    expect(waitingIn([])).toBe(0);
  });
});
