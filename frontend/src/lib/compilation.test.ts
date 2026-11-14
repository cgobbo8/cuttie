import { describe, expect, it } from "vitest";
import type { CompilationItem, CompilationSection, LiveHit } from "./api";
import {
  addItems,
  addSection,
  compilationLength,
  fitToTarget,
  itemFor,
  itemFromHit,
  liveClock,
  moveItem,
  moveSection,
  newId,
  removeItem,
  removeSection,
  sectionStarts,
  sectionsFromPlan,
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

  it("fits a length", () => {
    const c = { sections: [section("s1", [item("a", 100, 110), item("b", 200, 210)]), section("s2", [item("c", 300, 320)])] };
    // 40 s down to 20: every moment halved around its middle
    const half = fitToTarget(c, 20);
    expect(compilationLength(half)).toBeCloseTo(20, 1);
    expect(half.sections[0].items[0]).toMatchObject({ start: 102.5, end: 107.5 });
    expect(half.sections[1].items[0]).toMatchObject({ start: 305, end: 315 });
    // Already short enough
    expect(fitToTarget(c, 60)).toBe(c);
    // Moments can't shrink under 1.2 s: the last ones of the longest section go
    const many = { sections: [section("s1", Array.from({ length: 10 }, (_, i) => item(`i${i}`, i * 10, i * 10 + 2))), section("s2", [item("z", 500, 502)])] };
    const tight = fitToTarget(many, 6);
    expect(compilationLength(tight)).toBeLessThanOrEqual(6.2);
    expect(tight.sections[1].items).toHaveLength(1);
    expect(tight.sections[0].items.map((i) => i.id)).toEqual(["i0", "i1", "i2", "i3"]);
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

  it("writes a time of the live", () => {
    expect(liveClock(5025.7)).toBe("1:23:45");
    expect(liveClock(59)).toBe("0:00:59");
  });
});
