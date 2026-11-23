import { describe, expect, it } from "vitest";
import type { AssistantMessage, AssistantPlace } from "./api";
import { COSTS, MAX_SUGGESTIONS, suggestionsFor } from "./assistantSuggestions";

const ids = (place: AssistantPlace | null, last?: AssistantMessage) => suggestionsFor(place, last).map((one) => one.id);
const answer = (reply: AssistantMessage["reply"], more: Partial<AssistantMessage> = {}): AssistantMessage => ({ id: "m", role: "assistant", at: "", reply, action: null, ...more });
const video = (state: "idea" | "draft" | "exported", name: string) => ({ id: name, job: "live", name, source: "compilation" as const, seconds: 60, passages: 8, state });

describe("what the assistant offers to do", () => {
  it("on a live: the clip on screen, the ideas that wait, what is left to sort", () => {
    const live: AssistantPlace = { page: "live", job: "live", title: "Le yacht", clip: { filename: "tigre.mp4", name: "Le Tigre" }, facts: { ideas: 2, to_sort: 12 } };
    expect(ids(live)).toEqual(["cutClip", "buildBest", "bestClips", "findMoment"]);
    expect(suggestionsFor(live)[1].cost).toBe(COSTS.build);
    expect(suggestionsFor(live)[2].params).toEqual({ count: 12 });
    // Something to finish goes into the box rather than being sent
    expect(suggestionsFor(live)[3].fill).toBe(true);
    // No idea yet: the live is looked through; a video on screen instead of a clip: nothing to cut; all sorted: nothing to sort
    expect(ids({ page: "live", job: "live", video: { id: "v", name: "Calme", source: "compilation" }, facts: { ideas: 0, to_sort: 0 } })).toEqual(["findIdeas", "findMoment"]);
  });

  it("on a video: what it lacks, never what it already has", () => {
    const edit = (facts: AssistantPlace["facts"], source = "compilation"): AssistantPlace => ({ page: "edit", job: "live", video: { id: "v", name: "Calme", source }, facts });
    // Long, silent, opening on nothing
    expect(ids(edit({ passages: 14, seconds: 132, music: false, opening: "none", exported: false }))).toEqual(["shorten", "music", "hook", "findAdd"]);
    // It has its music and its opening: its look can still be changed, and it can be exported
    expect(ids(edit({ passages: 9, seconds: 58, music: true, opening: "hook", exported: false }))).toEqual(["findAdd", "restyle", "exportThis"]);
    expect(ids(edit({ passages: 9, seconds: 58, music: true, opening: "hook", exported: true }))).toEqual(["findAdd", "restyle"]);
    // A clip is cut, not searched for more passages; one passage has no hook to open on
    expect(ids(edit({ passages: 1, seconds: 41, music: false, opening: "none", exported: false }, "clip"))).toEqual(["cutClip", "music", "exportThis"]);
    // An idea of the AI not built yet: built; a video with nothing in it: described, or searched for
    expect(ids(edit({ waiting: true, passages: 0 }))).toEqual(["buildThis"]);
    expect(suggestionsFor(edit({ passages: 0 })).map((one) => [one.id, one.fill])).toEqual([["describe", true], ["findAdd", true]]);
  });

  it("at home: the latest live when it was never analysed", () => {
    const home = suggestionsFor({ page: "home", facts: { last_live: "Maurice de retour à Miami pour une très longue soirée de garde", last_live_analysed: false } });
    expect(home.map((one) => one.id)).toEqual(["analyseNamed", "leftToExport", "ideasWaiting"]);
    expect(home[0].cost).toBe(COSTS.analyse);
    // (a long title is cut short)
    expect(String(home[0].params?.name).length).toBeLessThanOrEqual(42);
    expect(ids({ page: "home", facts: { last_live: "Le yacht", last_live_analysed: true } })).toEqual(["whatsNew", "leftToExport", "ideasWaiting"]);
    expect(ids(null)).toEqual(["whatsNew", "leftToExport", "ideasWaiting"]);
  });

  it("on the exports: everything that waits, in one go", () => {
    expect(suggestionsFor({ page: "export", job: "live", facts: { to_export: 3 } })[0]).toEqual({ id: "exportAll", icon: "export", params: { count: 3 } });
    expect(ids({ page: "export", job: "live", facts: { to_export: 0 } })).toEqual(["leftToExport", "ideasWaiting"]);
  });

  it("first, what follows from its last answer", () => {
    const home: AssistantPlace = { page: "home", facts: {} };
    // It showed ideas and videos: the first idea is built, the videos exported
    const shown = answer([{ type: "text", text: "Voilà." }, { type: "widget", kind: "videos", items: [video("draft", "Le yacht"), video("idea", "La malédiction du calme"), video("draft", "Les tigres")] }]);
    expect(suggestionsFor(home, shown).slice(0, 2)).toEqual([
      { id: "buildNamed", icon: "build", params: { name: "La malédiction du calme" }, cost: COSTS.build },
      { id: "exportThose", icon: "export", params: { count: 2 } },
    ]);
    expect(suggestionsFor(home, shown)).toHaveLength(MAX_SUGGESTIONS);
    // A live it found that was never analysed
    const lives = answer([{ type: "widget", kind: "lives", items: [{ job: "a", analysed: true, title: "Analysé", date: null }, { analysed: false, title: "Maurice en cérémonie", date: null, vod: "1" }] }]);
    expect(suggestionsFor(home, lives)[0]).toMatchObject({ id: "analyseNamed", params: { name: "Maurice en cérémonie" } });
    // Clips to keep; passages found away from a video make one
    const clip = { job: "live", filename: "a.mp4", name: "A", score: 80, at: 10, length: 30, seen: "", tags: [], state: null };
    expect(ids(home, answer([{ type: "widget", kind: "clips", items: [clip] }]))[0]).toBe("keepThose");
    const passages = answer([{ type: "widget", kind: "passages", items: [{ job: "live", start: 1, end: 4, text: "À l'aide" }, { job: "live", start: 9, end: 12, text: "À l'aide !" }] }]);
    expect(ids(home, passages)[0]).toBe("videoOfThose");
    expect(ids({ page: "edit", job: "live", video: { id: "v", name: "Calme", source: "compilation" }, facts: { passages: 4, music: true, opening: "hook", exported: true } }, passages)).not.toContain("videoOfThose");
    // Nothing follows from an answer that waits for something, or that failed
    expect(ids(home, { ...shown, action: { call: "c", name: "ask_approval", args: {}, needs: "approval" } })).toEqual(ids(home));
    expect(ids(home, { ...shown, failed: "credits" })).toEqual(ids(home));
  });
});
