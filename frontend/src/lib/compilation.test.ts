import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { CompilationItem, CompilationSection, LiveHit } from "./api";
import {
  addItems,
  addSection,
  applyLooks,
  applyTight,
  clearLooks,
  compilationLength,
  fitToTarget,
  isNear,
  itemFor,
  itemFromHit,
  liveClock,
  looksCount,
  moveItem,
  moveSection,
  newId,
  planCurrent,
  removeItem,
  removeSection,
  revisedSections,
  sectionStarts,
  sectionsFromPlan,
  stepText,
  tightened,
  updateItem,
} from "./compilation";

const hit = (start: number, end: number, more: Partial<LiveHit> = {}): LiveHit => ({ start, end, sources: ["voice"], text: "c'est calme", before: "", after: "", chat: [], why: "", score: 0, ...more });
const item = (id: string, start: number, end: number): CompilationItem => ({ id, start, end, text: id, why: "", sources: ["voice"] });
const section = (id: string, items: CompilationItem[], title = ""): CompilationSection => ({ id, title, query: "", items });
const ids = (c: { sections: CompilationSection[] }) => c.sections.map((s) => s.items.map((i) => i.id));

describe("compilations", () => {
  it("names things with 10 letters and digits", () => {
    expect(newId()).toMatch(/^[a-z0-9]{10}$/);
    expect(newId()).not.toBe(newId());
  });

  it("turns a search result into an item with a little air around", () => {
    expect(itemFromHit(hit(100, 103), 5000)).toMatchObject({ start: 99.65, end: 103.5, text: "c'est calme", sources: ["voice"] });
    // A single word: never under a second and a half
    const short = itemFromHit(hit(100, 100.3), 5000);
    expect(short.end - short.start).toBeCloseTo(1.5, 2);
    // The live starts and ends somewhere
    expect(itemFromHit(hit(0.1, 3), 5000).start).toBe(0);
    expect(itemFromHit(hit(4998, 5000), 5000).end).toBe(5000);
    // Found in the chat only: its first message stands for it
    expect(itemFromHit(hit(50, 61, { text: "", chat: ["bob: trop calme", "lea: calme"], sources: ["chat"] }), 5000).text).toBe("bob: trop calme");
  });

  it("keeps apart what matches and what the AI gave as only close", () => {
    const sure = hit(100, 110, { sources: ["ai"], score: 0.85, why: "La bagarre démarre" });
    const near = hit(200, 210, { sources: ["ai"], score: 0.43, why: "Une chute, pas une bagarre" });
    expect([isNear(sure), isNear(near)]).toEqual([false, true]);
    // Words that were said are what was looked for, whatever their score
    expect(isNear(hit(100, 103))).toBe(false);
    // Added to a compilation, a near-miss still says it is one
    expect(itemFromHit(sure, 5000).why).toBe("La bagarre démarre");
    expect(itemFromHit(near, 5000).why).toBe("≈ Une chute, pas une bagarre");
    expect(itemFromHit(hit(200, 210, { sources: ["ai"], score: 0.2 }), 5000).why).toBe("");
  });

  it("adds moments once", () => {
    const c = { sections: [section("s1", [item("a", 100, 104)]), section("s2", [])] };
    const { compilation, added } = addItems(c, "s2", [item("b", 101, 103.5), item("c", 200, 203), item("d", 200.5, 203)]);
    // b is the moment a already shows, d the one c just brought
    expect(added).toBe(1);
    expect(ids(compilation)).toEqual([["a"], ["c"]]);
    expect(itemFor(compilation, { start: 201, end: 202 })?.id).toBe("c");
    expect(itemFor(compilation, { start: 300, end: 302 })).toBeUndefined();
  });

  it("moves, changes and removes items", () => {
    const c = { sections: [section("s1", [item("a", 0, 2), item("b", 10, 12)]), section("s2", [item("c", 20, 22)])] };
    expect(ids(moveItem(c, "a", 1))).toEqual([["b", "a"], ["c"]]);
    // Past the end of its section: first of the next one; before the start: last of the one before
    expect(ids(moveItem(c, "b", 1))).toEqual([["a"], ["b", "c"]]);
    expect(ids(moveItem(c, "c", -1))).toEqual([["a", "b", "c"], []]);
    expect(moveItem(c, "a", -1)).toBe(c);
    expect(ids(removeItem(c, "b"))).toEqual([["a"], ["c"]]);
    expect(updateItem(c, "c", { start: 19, end: 23 }).sections[1].items[0]).toMatchObject({ start: 19, end: 23, text: "c" });
  });

  it("adds, moves and removes sections", () => {
    const c = { sections: [section("s1", [item("a", 0, 2)], "Calme"), section("s2", [item("c", 20, 22)], "Ça pète")] };
    const { compilation, id } = addSection(c, "Les plombs", "pète les plombs");
    expect(compilation.sections[2]).toEqual({ id, title: "Les plombs", query: "pète les plombs", items: [] });
    expect(moveSection(c, "s2", -1).sections.map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(moveSection(c, "s2", 1)).toBe(c);
    expect(removeSection(c, "s1").sections.map((s) => s.id)).toEqual(["s2"]);
    // The last one stays, emptied
    expect(removeSection({ sections: [c.sections[0]] }, "s1").sections).toEqual([{ id: "s1", title: "", query: "", items: [] }]);
  });

  it("knows when each section starts in the video", () => {
    const c = { sections: [section("s1", [item("a", 0, 2), item("b", 10, 13)], "Calme"), section("empty", []), section("s2", [item("c", 20, 24)], "Ça pète")] };
    expect(compilationLength(c)).toBe(9);
    expect(sectionStarts(c)).toEqual([
      { id: "s1", title: "Calme", at: 0, length: 5 },
      { id: "s2", title: "Ça pète", at: 5, length: 4 },
    ]);
  });

  it("fits a length: long passages get shorter, sentences stay whole", () => {
    const c = { sections: [section("s1", [item("a", 100, 110), item("b", 200, 210)]), section("s2", [item("c", 300, 320)])] };
    // 40 s down to 30: what each passage has over 6 s shrinks by the same share, around its middle
    const shorter = fitToTarget(c, 30);
    expect(compilationLength(shorter)).toBeCloseTo(30, 1);
    expect(shorter.sections[0].items[0]).toMatchObject({ start: 100.91, end: 109.09 });
    expect(shorter.sections[1].items[0]).toMatchObject({ start: 303.18, end: 316.82 });
    // Already short enough
    expect(fitToTarget(c, 60)).toBe(c);
    // Sentences (2 s each) are not cut into: the last ones of the longest part go, never a part's only one
    const many = { sections: [section("s1", Array.from({ length: 10 }, (_, i) => item(`i${i}`, i * 10, i * 10 + 2))), section("s2", [item("z", 500, 502)])] };
    const fewer = fitToTarget(many, 6);
    expect(compilationLength(fewer)).toBe(6);
    expect(ids(fewer)).toEqual([["i0", "i1"], ["z"]]);
    expect(fewer.sections[0].items[0]).toEqual(many.sections[0].items[0]);
  });

  it("fits a length: the passages the AI scored the lowest go first", () => {
    const scored = (id: string, start: number, score: number): CompilationItem => ({ ...item(id, start, start + 3), score });
    const c = {
      sections: [
        section("s1", [scored("a", 100, 0.9), scored("b", 200, 0.4), scored("c", 300, 0.8)]),
        section("s2", [scored("d", 400, 0.3), scored("e", 500, 0.95), scored("f", 600, 0.4)]),
      ],
    };
    // 18 s down to 12: d (0.3) goes, then b rather than f (both 0.4): the longest part gives it
    expect(ids(fitToTarget(c, 12))).toEqual([["a", "c"], ["e", "f"]]);
    // Down to 6: the best of each part stays
    expect(ids(fitToTarget(c, 6))).toEqual([["a"], ["e"]]);
    // Asked to leave every passage whole (they are cut on their words): passages go, none is shortened
    const scenes = { sections: [section("s1", [{ ...item("a", 100, 110), score: 0.9 }, { ...item("b", 200, 208), score: 0.6 }]), section("s2", [item("c", 300, 312)])] };
    expect(compilationLength(fitToTarget(scenes, 26))).toBeCloseTo(26, 1);
    const whole = fitToTarget(scenes, 26, true);
    expect(ids(whole)).toEqual([["a"], ["c"]]);
    expect(whole.sections[0].items[0]).toEqual(scenes.sections[0].items[0]);
    // ...even when that leaves the video too long: a part keeps its only passage
    expect(fitToTarget(scenes, 15, true)).toEqual(whole);
    // Passages can't all go: when the few that are left are still too long, they are shortened
    const two = { sections: [section("s1", [item("a", 100, 104)]), section("s2", [item("b", 200, 204)])] };
    const squeezed = fitToTarget(two, 4);
    expect(ids(squeezed)).toEqual([["a"], ["b"]]);
    expect(compilationLength(squeezed)).toBeCloseTo(4, 1);
    expect(squeezed.sections[0].items[0]).toMatchObject({ start: 101, end: 103 });
  });

  it("sets a passage on where its words are really said, once its clip is cut", () => {
    // What is said: the transcript's times for it are kept aside (with the air around, the passage is wider)
    const spoken = itemFromHit(hit(100, 106, { spoken: true }), 5000);
    expect(spoken).toMatchObject({ start: 99.65, end: 106.5, fit: [100, 106] });
    // Found in the chat, or a sound the AI heard: nothing to set it on
    expect(itemFromHit(hit(50, 61, { sources: ["chat"] }), 5000).fit).toBeUndefined();
    expect(itemFromHit(hit(50, 61, { sources: ["ai"], score: 0.9 }), 5000)).toMatchObject({ score: 0.9 });
    expect(itemFromHit(hit(50, 61), 5000).score).toBeUndefined();

    const other = { ...item("other", 300, 303), fit: [300.2, 302.8] as [number, number] };
    const lost = { ...item("lost", 400, 403), fit: [400.2, 402.8] as [number, number] };
    const c = { sections: [section("s1", [{ ...spoken, id: "spoken" }, other, lost, item("plain", 500, 503)])] };
    // The sentence is said from 103.6 to 105.42 s; the words of "lost" were not found; "other" has no clip yet
    const set = applyTight(c, { spoken: [103.6, 105.417], lost: null, plain: [1, 2] });
    expect(set.sections[0].items.map((i) => [i.id, i.start, i.end, i.fit])).toEqual([
      ["spoken", 103.6, 105.42, undefined],
      ["other", 300, 303, [300.2, 302.8]],
      ["lost", 400, 403, undefined],
      ["plain", 500, 503, undefined],
    ]);
    // Nothing to set: the same compilation
    expect(applyTight(set, { spoken: [1, 2] })).toBe(set);
    expect(applyTight(c, {})).toBe(c);
    // Bounds that make no sense leave the passage as it was
    expect(tightened(other, [300.5, 300.6])).toMatchObject({ start: 300, end: 303 });
    expect(tightened(other, [300.5, 300.6]).fit).toBeUndefined();
  });

  it("turns the AI's plan into sections", () => {
    const sections = sectionsFromPlan(
      { title: "Maurice", sections: [{ title: "C'est calme", hits: [hit(100, 103), hit(101, 103)] }, { title: "Vide", hits: [] }, { title: "Ça pète", hits: [hit(900, 906)] }] },
      5000,
    );
    expect(sections.map((s) => [s.title, s.items.length])).toEqual([
      ["C'est calme", 1],
      ["Ça pète", 1],
    ]);
  });

  it("takes the AI's change of a video: what it kept stays as it was, the rest is new", () => {
    const tight = { ...item("a", 103.6, 105.4), template: "plein" };
    const c = { sections: [section("s1", [tight, item("b", 200, 203)], "Calme"), section("s2", [item("c", 300, 306)], "Ça pète")] };
    expect(planCurrent(c)).toEqual([
      { title: "Calme", items: [{ start: 103.6, end: 105.4 }, { start: 200, end: 203 }] },
      { title: "Ça pète", items: [{ start: 300, end: 306 }] },
    ]);
    // It gives the whole video again, by the transcript's lines: "a" (cut on its words since) is the same passage,
    // one is new after it, "b" is gone, the second part has a new name
    const plan = { title: "", sections: [{ title: "Calme", hits: [hit(100, 106), hit(150, 152, { spoken: true })] }, { title: "Vide", hits: [] }, { title: "Les conséquences", hits: [hit(300, 306), hit(301, 305)] }] };
    const revised = revisedSections(c, plan, 5000);
    expect([revised.added, revised.removed]).toEqual([1, 1]);
    expect(revised.sections.map((s) => [s.id, s.title, s.items.length])).toEqual([
      ["s1", "Calme", 2],
      ["s2", "Les conséquences", 1],
    ]);
    expect(revised.sections[0].items[0]).toBe(tight);
    expect(revised.sections[0].items[1]).toMatchObject({ start: 149.65, end: 152.5, fit: [150, 152] });
    expect(revised.sections[1].items[0]).toBe(c.sections[1].items[0]);
    // A passage cut on its words sits at the end of its line ("from 100 to 103 s", said from 102.5): the line is that passage, not a new one
    const late = { sections: [section("s1", [item("z", 102.5, 104.2)])] };
    const again = revisedSections(late, { title: "", sections: [{ title: "", hits: [hit(100, 103), hit(103, 105)] }] }, 5000);
    expect([again.added, again.removed, again.sections[0].items.length]).toEqual([0, 0, 1]);
  });

  it("writes a time of the live", () => {
    expect(liveClock(5025.7)).toBe("1:23:45");
    expect(liveClock(59)).toBe("0:00:59");
  });
});

describe("a template per passage", () => {
  const video = { template: "signature" as string | null, sections: [section("s1", [item("a", 0, 3), item("b", 10, 13)]), section("s2", [{ ...item("c", 20, 23), template: "reaction" }])] };

  it("takes what the AI chose: the video's template, and its own for a passage shown otherwise", () => {
    const chosen = applyLooks(video, "empile", { a: "empile", b: "plein", c: "empile" });
    expect(chosen.template).toBe("empile");
    expect(chosen.sections[0].items.map((i) => i.template)).toEqual([undefined, "plein"]);
    // A passage back to the video's template loses its own
    expect(chosen.sections[1].items[0]).not.toHaveProperty("template");
    // A passage the AI didn't look at follows the video
    expect(applyLooks(video, "plein", { a: "empile" }).sections[0].items.map((i) => i.template)).toEqual(["empile", undefined]);
    // Nothing else moved
    expect(ids(chosen)).toEqual([["a", "b"], ["c"]]);
    expect(video.template).toBe("signature");
  });

  it("counts the passages of each template, and puts them all back to the video's", () => {
    const chosen = applyLooks(video, "empile", { a: "empile", b: "plein", c: "empile" });
    expect(looksCount(chosen, "signature")).toEqual([["empile", 2], ["plein", 1]]);
    // No template chosen for the video: the channel's default
    expect(looksCount({ ...clearLooks(video), template: null }, "signature")).toEqual([["signature", 3]]);
    expect(clearLooks(chosen).sections.flatMap((s) => s.items).some((i) => "template" in i)).toBe(false);
  });
});

describe("what the AI is doing", () => {
  // The key and what it is filled with, as the translations would get them
  const t = ((key: string, options?: Record<string, unknown>) => {
    if (key.startsWith("compilation.sound.")) return key === "compilation.sound.gunfire" ? "coups de feu" : String(options?.defaultValue);
    const filled = Object.entries(options ?? {}).map(([name, value]) => `${name}=${value}`);
    return [key.replace("compilation.step.", ""), ...filled].join(" ");
  }) as unknown as TFunction;

  it("says each step in plain words", () => {
    expect(stepText(t, null)).toBe("thinking");
    expect(stepText(t, { step: "thinking", detail: "", count: 1 })).toBe("thinking");
    expect(stepText(t, { step: "hearing", detail: "", count: 1 })).toBe("hearing");
    expect(stepText(t, { step: "overview", detail: "", count: 2 })).toBe("overview");
    expect(stepText(t, { step: "best_moments", detail: "", count: 2 })).toBe("best_moments");
    expect(stepText(t, { step: "chat_peaks", detail: "", count: 2 })).toBe("chat_peaks");
    expect(stepText(t, { step: "search_speech", detail: "trop calme", count: 3 })).toBe("search_speech words=trop calme");
    expect(stepText(t, { step: "search_chat", detail: "mdr", count: 4 })).toBe("search_chat words=mdr");
    expect(stepText(t, { step: "find_sounds", detail: "gunfire", count: 5 })).toBe("find_sounds sound=coups de feu");
    expect(stepText(t, { step: "loud_moments", detail: "raised_voices", count: 6 })).toBe("raised_voices");
    expect(stepText(t, { step: "read", detail: "3:04:30", count: 7 })).toBe("read at=3:04:30");
  });

  it("copes with what a model may send", () => {
    // Seconds instead of a clock, a sound it made up, a tool the app doesn't know, no words
    expect(stepText(t, { step: "listen", detail: "11070", count: 8 })).toBe("listen at=3:04:30");
    expect(stepText(t, { step: "find_sounds", detail: "thunder", count: 9 })).toBe("find_sounds sound=thunder");
    expect(stepText(t, { step: "loud_moments", detail: "whatever", count: 10 })).toBe("loudest");
    expect(stepText(t, { step: "answer", detail: "", count: 11 })).toBe("thinking");
    expect(stepText(t, { step: "search_speech", detail: "", count: 12 })).toBe("thinking");
  });
});
