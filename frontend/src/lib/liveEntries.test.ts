import { describe, expect, it } from "vitest";
import type { Compilation } from "./api";
import { ideasToSee, keptCount, liveEntries, proposedEntries, sectionEntries, shownEntries, videoFacts, videoMoments } from "./liveEntries";
import type { Moment } from "./moments";

const moment = (filename: string, score: number, state: Moment["state"] = "todo") => ({ filename, score, state, rank: 1, start: 0, end: 60, duration: 60, hp: { clip_name: filename } }) as unknown as Moment;
const item = (id: string, start: number, end: number) => ({ id, start, end, text: "", why: "", sources: ["ai"] });
const video = (id: string, more: Partial<Compilation> = {}): Compilation => ({ id, name: id, sections: [{ id: `${id}s`, title: "", query: "", items: [] }], template: null, titles: true, hook: "", target: 45, created_at: "2026-11-23T10:00:00Z", updated_at: "2026-11-23T10:00:00Z", ...more });
const idea = (id: string, score: number, more: Partial<Compilation> = {}) => video(id, { brief: "…", suggestion: { key: id, pitch: "", tags: [], score, moments: [10, 20, 30, 40, 50, 60, 70] }, ...more });
const built = (id: string, more: Partial<Compilation> = {}) => video(id, { sections: [{ id: `${id}s`, title: "", query: "", items: [item(`${id}a`, 100, 104), item(`${id}b`, 300, 306)] }], ...more });

describe("what a live gives, in one list", () => {
  const entries = liveEntries(
    [moment("a.mp4", 83, "kept"), moment("b.mp4", 79), moment("c.mp4", 71, "passed")],
    [
      idea("calme", 72),
      idea("romance", 81),
      idea("yacht", 96, { suggestion: { key: "yacht", pitch: "", tags: [], score: 96, moments: [11800, 12000], span: [11756, 14886] } }),
      idea("banque", 80, { passed: true, suggestion: { key: "banque", pitch: "", tags: [], score: 80, moments: [3400], span: [3383, 4172] } }),
      built("mine", { updated_at: "2026-11-23T12:00:00Z" }),
      built("helice", { source: "clip" }),
      // The video of a clip of the analysis: that clip's own line
      built("ofclip", { source: "clip", clip: "a.mp4" }),
      // A blank one left by « new »: no line
      video("blank"),
    ],
  );

  it("puts each thing under its source", () => {
    expect(entries.clip.map((e) => e.key)).toEqual(["v:helice", "m:a.mp4", "m:b.mp4", "m:c.mp4"]);
    expect(entries.sequence.map((e) => e.key)).toEqual(["v:yacht", "v:banque"]);
    // The streamer's own first, then the ideas, the best first
    expect(entries.compilation.map((e) => e.key)).toEqual(["v:mine", "v:romance", "v:calme"]);
  });

  it("says where each one stands", () => {
    const state = Object.fromEntries(Object.values(entries).flat().map((e) => [e.key, e.state]));
    expect(state).toMatchObject({ "m:a.mp4": "kept", "m:b.mp4": "todo", "m:c.mp4": "passed", "v:yacht": "todo", "v:banque": "passed", "v:mine": "kept", "v:helice": "kept" });
    // Kept: what there is to edit and export, whatever its source
    expect(keptCount(entries)).toBe(3);
    // An idea passed on no longer waits to be seen
    expect([ideasToSee(entries, "clip"), ideasToSee(entries, "sequence"), ideasToSee(entries, "compilation")]).toEqual([0, 1, 2]);
  });

  it("proposes the ideas still to see at the head of the list, the most promising first, and leaves the rest to each source", () => {
    // Sequences and compilations together; one passed on is no longer proposed
    expect(proposedEntries(entries).map((e) => e.key)).toEqual(["v:yacht", "v:romance", "v:calme"]);
    expect(sectionEntries(entries, "sequence").map((e) => e.key)).toEqual(["v:banque"]);
    expect(sectionEntries(entries, "compilation").map((e) => e.key)).toEqual(["v:mine"]);
    expect(sectionEntries(entries, "clip").map((e) => e.key)).toEqual(["v:helice", "m:a.mp4", "m:b.mp4", "m:c.mp4"]);
    // On screen: what the AI proposes, then the clips, the sequences, the compilations
    expect(shownEntries(entries, {}, null).map((e) => e.key)).toEqual(["v:yacht", "v:romance", "v:calme", "v:helice", "m:a.mp4", "m:b.mp4", "m:c.mp4", "v:banque", "v:mine"]);
  });

  it("shows the three best ideas, all of them once open or when the one selected is further down", () => {
    const five = liveEntries([moment("a.mp4", 83)], [idea("un", 90), idea("deux", 85), idea("trois", 80), idea("quatre", 75), idea("cinq", 70)]);
    expect(shownEntries(five, {}, null).map((e) => e.key)).toEqual(["v:un", "v:deux", "v:trois", "m:a.mp4"]);
    expect(shownEntries(five, { ideas: true }, null)).toHaveLength(6);
    expect(shownEntries(five, {}, "v:cinq")).toHaveLength(6);
    expect(shownEntries(five, {}, "v:deux")).toHaveLength(4);
  });

  it("shows the first ones of a long section, all of it once open or when what is selected is further down", () => {
    const many = liveEntries(Array.from({ length: 20 }, (_, i) => moment(`clip${i}.mp4`, 90 - i)), [idea("calme", 72)]);
    expect(shownEntries(many, {}, null).map((e) => e.key)).toHaveLength(7);
    expect(shownEntries(many, { clip: true }, null)).toHaveLength(21);
    expect(shownEntries(many, {}, "m:clip12.mp4")).toHaveLength(21);
    expect(shownEntries(many, {}, "m:clip2.mp4")).toHaveLength(7);
  });

  it("tells a video in numbers, and where to look for it in the live", () => {
    const yacht = entries.sequence[0].kind === "video" ? entries.sequence[0].video : null;
    expect(videoFacts(yacht!)).toEqual({ span: [11756, 14886], moments: 2, passages: 0, seconds: 45 });
    expect(videoFacts(built("mine"))).toMatchObject({ span: null, passages: 2, seconds: 10 });
    // A few moments, spread: the first and the last among them
    expect(videoMoments(idea("calme", 72))).toEqual([10, 30, 40, 60, 70]);
    expect(videoMoments(built("mine"))).toEqual([100, 300]);
    // (one only: the first)
    expect(videoMoments(idea("calme", 72), 1)).toEqual([10]);
  });
});
