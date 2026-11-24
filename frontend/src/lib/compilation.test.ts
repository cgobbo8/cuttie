import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { CompilationItem, CompilationSection, LiveHit, VideoPlan } from "./api";
import {
  PLAIN_CUT,
  itemsBetween,
  moveItems,
  ownTransitions,
  placeItems,
  removeItems,
  setTransition,
  setVideoTransition,
  transitionsOf,
  addItems,
  insertItems,
  itemFromMedia,
  pieceAsk,
  saidAlready,
  addSection,
  allItems,
  applyLooks,
  applySound,
  bestHook,
  hookMoment,
  hookSpan,
  hookStart,
  openingSeconds,
  withHook,
  soundBrief,
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
  showTitle,
  sectionsFromPlan,
  sameStep,
  stepText,
  tightened,
  updateItem,
  cutItem,
  cutItems,
  extendItem,
  recutVideo,
  splitItem,
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

  it("knows a sentence the video already says, even timed a few seconds away", () => {
    const tiger = { ...item("a", 13412.3, 13414.6), text: "Oh what the fuck, y'a un tigre et un singe !" };
    const c = { sections: [{ id: "s1", title: "", query: "", items: [tiger, { ...item("b", 500, 503), text: "Ok" }] }] };
    // The transcript's line for it starts five seconds earlier and overlaps nothing
    expect(saidAlready(c, { start: 13407, text: "Oh what the fuck, y'a un tigre et un singe, à la Very Bad Trip" })?.id).toBe("a");
    expect(saidAlready(c, { start: 13407, text: "oh what the fuck y a un tigre" })?.id).toBe("a");
    // Other words, the same words far away, another live, or too few words to tell
    expect(saidAlready(c, { start: 13407, text: "Regarde le singe là-bas" })).toBeUndefined();
    expect(saidAlready(c, { start: 4730, text: "Oh what the fuck, y'a un tigre et un singe !" })).toBeUndefined();
    expect(saidAlready(c, { start: 13407, text: "Oh what the fuck, y'a un tigre et un singe !", job: "other" })).toBeUndefined();
    expect(saidAlready(c, { start: 501, text: "Ok" })).toBeUndefined();
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
    // (and no longer says its title is hidden: it has none)
    expect(removeSection({ sections: [{ ...c.sections[0], hidden: true }] }, "s1").sections).toEqual([{ id: "s1", title: "", query: "", items: [] }]);
  });

  it("keeps a part's title out of the video when it is hidden", () => {
    const c = { sections: [section("s1", [item("a", 0, 2)], "Calme"), section("s2", [item("b", 20, 24)], "Ça pète")] };
    const hidden = showTitle(c, "s2", false);
    // The part keeps its name, its place and its length: only the video is told not to write it
    expect(hidden.sections[1]).toEqual({ ...c.sections[1], hidden: true });
    expect(hidden.sections[0]).toBe(c.sections[0]);
    expect(sectionStarts(hidden)).toEqual([
      { id: "s1", title: "Calme", at: 0, length: 2 },
      { id: "s2", title: "Ça pète", at: 2, length: 4, hidden: true },
    ]);
    // Shown again: the field is gone, not set to false
    expect(showTitle(hidden, "s2", true)).toEqual(c);
    expect(showTitle(c, "nope", false)).toEqual(c);
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
    // What is new and what left, to show it in the video
    expect(revised.fresh).toEqual([revised.sections[0].items[1].id]);
    expect(revised.gone.map((g) => [g.item.id, g.section, g.index])).toEqual([["b", "s1", 1]]);
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
    // Asked for tighter cuts, the AI gives a passage back with fewer lines: the same passage (clip, template), to be cut again on them
    const wide = { sections: [section("s1", [{ ...item("w", 100.2, 109.6), template: "reaction" }, item("k", 200, 203)])] };
    const cut = revisedSections(wide, { title: "", sections: [{ title: "", hits: [hit(103, 105, { recut: true, spoken: true, text: "plus court" }), hit(107, 109, { recut: true, spoken: true }), hit(200, 203)] }] }, 5000);
    expect([cut.added, cut.removed, cut.recut]).toEqual([1, 0, ["w"]]);
    expect(cut.sections[0].items[0]).toMatchObject({ id: "w", template: "reaction", start: 102.65, end: 105.5, fit: [103, 105], text: "plus court" });
    // Given back in two (a dead line out of its middle): the second half is a new passage
    expect(cut.sections[0].items[1]).toMatchObject({ fit: [107, 109] });
    expect(cut.sections[0].items[2]).toBe(wide.sections[0].items[1]);
  });

  it("keeps the passages of several lives apart", () => {
    // The same times in two lives are two moments
    const here = itemFromHit(hit(100, 103), 5000);
    const there = itemFromHit(hit(100, 103, { job: "other" }), 5000);
    expect([here.job, there.job]).toEqual([undefined, "other"]);
    const c = { sections: [section("s1", [here])] };
    expect(itemFor(c, hit(100, 103))?.id).toBe(here.id);
    expect(itemFor(c, hit(100, 103, { job: "other" }))).toBeUndefined();
    expect(addItems(c, "s1", [there]).added).toBe(1);

    // A plan over two lives: each passage keeps its live, and ends where its own live ends
    const lengths = (job?: string) => (job === "other" ? 200 : 5000);
    const plan = { title: "", sections: [{ title: "Calme", hits: [hit(100, 103), hit(100, 103, { job: "other" }), hit(198, 199.9, { job: "other" }), hit(198, 199.9)] }] };
    const [part] = sectionsFromPlan(plan, lengths);
    expect(part.items.map((i) => [i.job ?? null, i.end])).toEqual([[null, 103.5], ["other", 103.5], ["other", 200], [null, 200.4]]);
    // The AI is told which live each passage is from
    expect(planCurrent({ sections: [part] })[0].items.slice(0, 2)).toEqual([{ start: 99.65, end: 103.5 }, { start: 99.65, end: 103.5, job: "other" }]);

    // Changing the video: a passage given back is the one of the same live, not its twin in the other
    const video = { sections: [section("s1", [item("a", 100, 103), { ...item("b", 100, 103), job: "other" }])] };
    const kept = revisedSections(video, { title: "", sections: [{ title: "", hits: [hit(100, 103, { job: "other" }), hit(300, 303, { job: "other" })] }] }, lengths);
    expect([kept.added, kept.removed]).toEqual([1, 1]);
    expect(kept.sections[0].items.map((i) => [i.id === "b" ? "b" : "new", i.job])).toEqual([["b", "other"], ["new", "other"]]);
    expect(kept.gone.map((g) => g.item.id)).toEqual(["a"]);
  });

  it("writes a time of the live", () => {
    expect(liveClock(5025.7)).toBe("1:23:45");
    expect(liveClock(59)).toBe("0:00:59");
  });
});

describe("several passages at once", () => {
  const video = (...parts: string[][]): { sections: CompilationSection[] } => ({
    sections: parts.map((ids, i) => ({ id: `s${i + 1}`, title: "", query: "", items: ids.map((id, k) => item(id, k * 10, k * 10 + 5)) })),
  });
  const order = (c: { sections: CompilationSection[] }) => c.sections.map((s) => s.items.map((i) => i.id).join(""));

  it("moves them up together, keeping their order", () => {
    expect(order(moveItems(video(["x", "a", "b", "y"]), ["a", "b"], -1))).toEqual(["abxy"]);
    // Not next to each other: each goes up one place
    expect(order(moveItems(video(["x", "a", "y", "b"]), ["b", "a"], -1))).toEqual(["axby"]);
  });

  it("moves them down together, keeping their order", () => {
    expect(order(moveItems(video(["x", "a", "b", "y"]), ["a", "b"], 1))).toEqual(["xyab"]);
  });

  it("stops at the top of the video without shuffling them", () => {
    const c = video(["a", "b", "x"]);
    expect(order(moveItems(c, ["a", "b"], -1))).toEqual(["abx"]);
    expect(order(moveItems(video(["x", "a", "b"]), ["a", "b"], 1))).toEqual(["xab"]);
  });

  it("goes on into the part next to theirs", () => {
    expect(order(moveItems(video(["x"], ["a", "b", "y"]), ["a", "b"], -1))).toEqual(["xab", "y"]);
    expect(order(moveItems(video(["x", "a", "b"], ["y"]), ["a", "b"], 1))).toEqual(["x", "aby"]);
  });

  it("puts them together in another part, in the order they play", () => {
    const c = video(["a", "x", "b"], ["y", "z"], []);
    expect(order(placeItems(c, ["b", "a"], "s2"))).toEqual(["x", "yzab", ""]);
    expect(order(placeItems(c, ["a", "b"], "s2", "z"))).toEqual(["x", "yabz", ""]);
    expect(order(placeItems(c, ["a", "z"], "s3"))).toEqual(["xb", "y", "az"]);
  });

  it("gathers them inside their own part", () => {
    const c = video(["a", "x", "b", "y"]);
    expect(order(placeItems(c, ["a", "b"], "s1", "y"))).toEqual(["xaby"]);
    expect(order(placeItems(c, ["a", "b"], "s1"))).toEqual(["xyab"]);
    // Dropped on one of themselves: before the next passage that stays
    expect(order(placeItems(c, ["a", "b"], "s1", "b"))).toEqual(["xaby"]);
  });

  it("changes nothing when dropped where they are", () => {
    const c = video(["a", "b", "x"]);
    expect(placeItems(c, ["a", "b"], "s1", "x")).toBe(c);
    expect(placeItems(c, ["a"], "s1", "a")).toBe(c);
    expect(placeItems(c, ["nope"], "s1")).toBe(c);
    expect(placeItems(c, ["a"], "nope")).toBe(c);
  });

  it("takes them out together", () => {
    expect(order(removeItems(video(["a", "x"], ["b", "y"]), ["a", "b"]))).toEqual(["x", "y"]);
  });

  it("picks a range across parts", () => {
    const c = video(["a", "b"], ["c", "d"]);
    expect(itemsBetween(c, "b", "d")).toEqual(["b", "c", "d"]);
    expect(itemsBetween(c, "d", "a")).toEqual(["a", "b", "c", "d"]);
    expect(itemsBetween(c, "gone", "c")).toEqual(["c"]);
  });
});

describe("transitions between passages", () => {
  const video = (transition?: string) => ({
    ...(transition ? { transition } : {}),
    sections: [
      { id: "s1", title: "", query: "", items: [item("a", 0, 5), item("b", 10, 15)] },
      { id: "s2", title: "", query: "", items: [item("c", 20, 25)] },
    ] as CompilationSection[],
  });

  it("plays the video's transition at every cut, never before the first passage", () => {
    expect(transitionsOf(video("zoom"))).toEqual({ b: "zoom", c: "zoom" });
    expect(transitionsOf(video())).toEqual({});
  });

  it("lets a passage come in its own way", () => {
    const c = setTransition(video("zoom"), ["c"], "flash");
    expect(transitionsOf(c)).toEqual({ b: "zoom", c: "flash" });
    expect(ownTransitions(c)).toBe(1);
    // A plain cut where the rest of the video has a transition
    expect(transitionsOf(setTransition(c, ["b"], PLAIN_CUT))).toEqual({ c: "flash" });
    // Back to the video's
    expect(transitionsOf(setTransition(c, ["c"], null))).toEqual({ b: "zoom", c: "zoom" });
  });

  it("does not keep a choice that only repeats the video's", () => {
    const c = setTransition(video("zoom"), ["b"], "zoom");
    expect(allItems(c).some((i) => i.transition !== undefined)).toBe(false);
    expect(allItems(setTransition(video(), ["b"], PLAIN_CUT)).some((i) => i.transition !== undefined)).toBe(false);
  });

  it("changes the video's transition and keeps what passages chose for themselves", () => {
    const c = setVideoTransition(setTransition(video("zoom"), ["c"], "flash"), "slide");
    expect(transitionsOf(c)).toEqual({ b: "slide", c: "flash" });
    // The passage's choice is now the video's: nothing of its own left
    expect(ownTransitions(setVideoTransition(c, "flash"))).toBe(0);
    // The same everywhere
    expect(transitionsOf(setVideoTransition(c, "pop", true))).toEqual({ b: "pop", c: "pop" });
  });

  it("goes back to plain cuts", () => {
    const c = setVideoTransition(video("zoom"), null);
    expect("transition" in c).toBe(false);
    expect(transitionsOf(c)).toEqual({});
  });

  it("ignores a transition it does not know", () => {
    expect(transitionsOf(video("wobble"))).toEqual({});
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

  it("says that a live is listened to again, and how far it is", () => {
    // Before the first chunk is done, then chunk after chunk
    expect(stepText(t, { step: "relistening", detail: "", count: 1 })).toBe("relistening");
    expect(stepText(t, { step: "relistening", detail: "12/41", count: 13 })).toBe("relisteningAt done=12/41");
    // In the conversation the count moves on one line, it doesn't write 41 of them
    expect(sameStep("relisteningAt done=12/41", "relisteningAt done=13/41")).toBe(true);
    // As the streamer reads them: the line said before the first chunk is the same line, its count just arrived
    expect(sameStep("Cuttie réécoute tout le live pour couper au mot près", "Cuttie réécoute tout le live pour couper au mot près (1/41)")).toBe(true);
    expect(sameStep("Cuttie réécoute tout le live pour couper au mot près (40/41)", "Cuttie réécoute tout le live pour couper au mot près (41/41)")).toBe(true);
    expect(sameStep("Cuttie écoute tout le live", "Cuttie réécoute tout le live pour couper au mot près (1/41)")).toBe(false);
    expect(sameStep("read at=3:04:30", "read at=3:05:10")).toBe(false);
    expect(sameStep("overview", "overview")).toBe(true);
  });

  it("copes with what a model may send", () => {
    // Seconds instead of a clock, a sound it made up, a tool the app doesn't know, no words
    expect(stepText(t, { step: "listen", detail: "11070", count: 8 })).toBe("listen at=3:04:30");
    expect(stepText(t, { step: "find_sounds", detail: "thunder", count: 9 })).toBe("find_sounds sound=thunder");
    expect(stepText(t, { step: "loud_moments", detail: "whatever", count: 10 })).toBe("loudest");
    expect(stepText(t, { step: "answer", detail: "", count: 11 })).toBe("thinking");
    expect(stepText(t, { step: "search_speech", detail: "", count: 12 })).toBe("thinking");
  });

  it("tells the AI what a video is to choose its sound, and applies what it chose", () => {
    const piece = (id: string, text: string): CompilationItem => ({ id, start: 0, end: 4, text, why: "", sources: ["voice"] });
    const video = {
      name: " De calme à débordés ",
      sections: [
        { id: "one", title: "C'est bien calme", query: "", items: [piece("a", "Y'a personne"), piece("b", " ")] },
        { id: "two", title: " ", query: "", items: [piece("c", "On va être submergés")] },
        { id: "three", title: "Vide", query: "", items: [] },
      ],
    };
    // Its title, the parts that have a title and passages, its length, what is said (nothing for a passage without words)
    // (each line says which passage it is: the AI names the one the video could open on by its place among them)
    expect(soundBrief(video)).toEqual({ title: "De calme à débordés", parts: ["C'est bien calme"], seconds: 12, passages: 3, said: ["Y'a personne", "On va être submergés"], lengths: [4, 4], ids: ["a", "c"] });
    // A long video: a few passages from all over it, not only its beginning
    const long = { name: "Long", sections: [{ id: "one", title: "", query: "", items: Array.from({ length: 40 }, (_, n) => piece(`p${n}`, `phrase ${n}`)) }] };
    const told = soundBrief(long, 4);
    expect(told.said).toEqual(["phrase 0", "phrase 10", "phrase 20", "phrase 30"]);
    expect(told.ids).toEqual(["p0", "p10", "p20", "p30"]);
    expect(told.passages).toBe(40);
    // Unless asked otherwise, up to thirty passages
    expect(soundBrief(long).said).toHaveLength(30);

    // The music and the intro it chose; what the streamer had set on them stays when the track or the style is the same
    const set = { name: "x", sections: [], music: { track: "lofi", volume: 1.6 }, intro: { style: "slam", title: "Le calme", sound: "none" } };
    // ...and the intro says the AI chose it (its next choices stay away from the ones it gave, not from those picked by hand)
    expect(applySound(set, { music: "phonk", intro: "slam" })).toEqual({ name: "x", sections: [], music: { track: "phonk", volume: 1.6 }, intro: { style: "slam", title: "Le calme", sound: "none", by: "ai" } });
    // Another style: its own sound, the title stays
    expect(applySound(set, { music: "phonk", intro: "rush" }).intro).toEqual({ style: "rush", title: "Le calme", by: "ai" });
    // It chose none: they are gone
    expect(applySound(set, { music: null, intro: null })).toEqual({ name: "x", sections: [] });
    const bare: { name: string; sections: CompilationSection[]; music?: { track: string }; intro?: { style: string } } = { name: "x", sections: [] };
    expect(applySound(bare, { music: "phonk", intro: "neon" })).toEqual({ name: "x", sections: [], music: { track: "phonk" }, intro: { style: "neon", by: "ai" } });

    // A hook comes with the look that frames it; chosen again without one, it keeps the look it had
    expect(applySound(set, { music: null, intro: "hook", look: "neon" }).intro).toEqual({ style: "hook", title: "Le calme", look: "neon", by: "ai" });
    expect(applySound({ ...set, intro: { style: "hook", look: "glitch" } }, { music: null, intro: "hook" }).intro).toEqual({ style: "hook", look: "glitch", by: "ai" });
    expect(applySound({ ...set, intro: { style: "hook", look: "glitch" } }, { music: null, intro: "slam", look: "neon" }).intro).toEqual({ style: "slam", by: "ai" });

    // The passage it named as the one the video can open on says so, and only that one
    const named = applySound({ ...video, sections: [{ ...video.sections[0], items: [piece("a", "x"), { ...piece("b", "y"), opening: true }] }, video.sections[1]] }, { music: null, intro: "hook", opening: "c" });
    expect(allItems(named).map((item) => [item.id, !!item.opening])).toEqual([["a", false], ["b", false], ["c", true]]);
    // It named none, one that is gone, or the first passage (which would play twice in a row): what it had named stays
    const before = { ...video, sections: [{ ...video.sections[0], items: [piece("a", "x"), { ...piece("b", "y"), opening: true }] }] };
    for (const opening of [null, undefined, "zzz", "a"]) expect(allItems(applySound(before, { music: null, intro: null, opening })).map((item) => !!item.opening)).toEqual([false, true]);
  });
});

describe("the moment a hook intro plays", () => {
  const piece = (id: string, start: number, end: number, more: Partial<CompilationItem> = {}): CompilationItem => ({ id, start, end, text: id, why: "", sources: ["ai"], ...more });
  const video = (items: CompilationItem[], intro: { style: string; hook?: { item: string; start: number; end: number; auto?: boolean } } = { style: "hook" }) => ({
    sections: [
      { id: "one", title: "", query: "", items: items.slice(0, 2) },
      { id: "two", title: "", query: "", items: items.slice(2) },
    ],
    intro,
  });

  it("takes all of a passage that is a hook's length, and the end of a longer one", () => {
    expect(hookSpan({ start: 100, end: 104 })).toEqual([100, 104]);
    // (cutting the start off a passage of 6.7 s took the punchline out of the first video it was tried on)
    expect(hookSpan({ start: 100, end: 108 })).toEqual([100, 108]);
    // Longer than a hook: its last five seconds
    expect(hookSpan({ start: 100, end: 112 })).toEqual([107, 112]);
  });

  it("chooses the passage the AI named, else the best one, else the last, never the first", () => {
    const a = piece("a", 0, 4, { score: 0.99 });
    const b = piece("b", 10, 14, { score: 0.7 });
    const c = piece("c", 20, 24, { score: 0.9 });
    const d = piece("d", 30, 34, { score: 0.9 });
    // The best scored but the first; of equals, the last (a payoff comes late)
    expect(bestHook([a, b, c, d])?.id).toBe("d");
    // The one the AI named as the video's hook wins over the scores
    expect(bestHook([a, { ...b, opening: true }, c, d])?.id).toBe("b");
    // ...unless it is the first passage: it would play twice in a row
    expect(bestHook([{ ...a, opening: true }, b, c])?.id).toBe("c");
    // Nobody scored them (picked by hand): the last one
    expect(bestHook([piece("x", 0, 3), piece("y", 5, 8), piece("z", 9, 12)])?.id).toBe("z");
    // One that can be played whole comes before a longer one, however well scored; all long: the best of them
    expect(bestHook([a, piece("long", 10, 22, { score: 0.95 }), c])?.id).toBe("c");
    expect(bestHook([piece("x", 0, 3), piece("y", 5, 8), piece("long", 9, 30)])?.id).toBe("y");
    expect(bestHook([a, piece("l1", 10, 22, { score: 0.6 }), piece("l2", 30, 45, { score: 0.8 })])?.id).toBe("l2");
    // One passage, or none: nothing to open on
    expect(bestHook([a])).toBeNull();
    expect(bestHook([])).toBeNull();
  });

  it("opens the video on the app's choice until the streamer chooses, inside the passage as it is cut today", () => {
    const items = [piece("a", 0, 4), piece("b", 10, 22, { score: 0.9 }), piece("c", 30, 34, { score: 0.5 })];
    // Nobody chose: the best passage that can be played whole; when all are long, the last five seconds of the best
    expect(hookMoment(video(items))).toEqual({ item: items[2], start: 30, end: 34, auto: true });
    expect(hookMoment(video(items.slice(0, 2)))).toEqual({ item: items[1], start: 17, end: 22, auto: true });
    // Another intro, or a video of one passage: no moment
    expect(hookMoment(video(items, { style: "slam" }))).toBeNull();
    expect(hookMoment(video([items[0]]))).toBeNull();
    expect(hookMoment({ sections: [] })).toBeNull();
    // The streamer chose a passage and what is kept of it
    expect(hookMoment(video(items, { style: "hook", hook: { item: "c", start: 31, end: 33.5 } }))).toEqual({ item: items[2], start: 31, end: 33.5, auto: false });
    // The passage was cut since: the moment stays inside it, as long as it was when it can
    expect(hookMoment(video([items[0], items[1], piece("c", 32, 34)], { style: "hook", hook: { item: "c", start: 31, end: 33.5 } }))).toMatchObject({ start: 32, end: 34, auto: false });
    // Never longer than a hook, never shorter than one (a passage shorter still is taken whole)
    expect(hookMoment(video(items, { style: "hook", hook: { item: "b", start: 10, end: 22 } }))).toMatchObject({ start: 10, end: 18 });
    expect(hookMoment(video(items, { style: "hook", hook: { item: "b", start: 12, end: 12.2 } }))).toMatchObject({ start: 12, end: 13.5 });
    expect(hookMoment(video([items[0], piece("s", 50, 51)], { style: "hook", hook: { item: "s", start: 50.2, end: 50.4 } }))).toMatchObject({ start: 50, end: 51 });
    // The passage is gone, or became the first one: the app chooses again
    expect(hookMoment(video(items, { style: "hook", hook: { item: "zzz", start: 1, end: 3 } }))).toMatchObject({ item: items[2], auto: true });
    expect(hookMoment(video(items, { style: "hook", hook: { item: "a", start: 1, end: 3 } }))).toMatchObject({ item: items[2], auto: true });
    // What the app wrote the last time is not a choice: it chooses again
    expect(hookMoment(video(items, { style: "hook", hook: { item: "b", start: 17, end: 22, auto: true } }))).toMatchObject({ item: items[2], auto: true });
  });

  it("writes on the video what its hook plays, and counts it in its length", () => {
    const items = [piece("a", 0, 4), piece("b", 10, 22, { score: 0.9 }), piece("c", 30, 34, { score: 0.5 })];
    const written = withHook(video(items));
    expect(written.intro).toEqual({ style: "hook", hook: { item: "c", start: 30, end: 34, auto: true } });
    // Nothing to change: the very same video
    expect(withHook(written)).toBe(written);
    const chosen = video(items, { style: "hook", hook: { item: "c", start: 31, end: 33.5 } });
    expect(withHook(chosen)).toBe(chosen);
    // Another intro keeps no moment; a video without an intro is left alone
    expect(withHook(video(items, { style: "slam", hook: { item: "c", start: 31, end: 33.5 } })).intro).toEqual({ style: "slam" });
    const plain = { sections: [] };
    expect(withHook(plain)).toBe(plain);
    // A hook with nothing to play (one passage): no moment written
    expect(withHook(video([items[0]], { style: "hook", hook: { item: "b", start: 17, end: 22, auto: true } })).intro).toEqual({ style: "hook" });

    // Its length in the video: the moment's, a jingle's, nothing
    expect(openingSeconds(video(items))).toBe(4);
    expect(openingSeconds(chosen)).toBe(2.5);
    expect(openingSeconds(video(items, { style: "slam" }))).toBe(1.6);
    expect(openingSeconds(video([items[0]]))).toBe(0);
    expect(openingSeconds({ sections: [] })).toBe(0);
  });

  it("starts on a word when it is cut out of a longer passage", () => {
    const words = [
      { start: 10, end: 10.4 },
      { start: 12.1, end: 12.6 },
      { start: 12.7, end: 13 },
    ];
    // It would start at 12.3, inside a word: just before that word instead
    expect(hookStart(words, 12.3, 9)).toBeCloseTo(12);
    // In a silence: before the next word
    expect(hookStart(words, 11, 9)).toBeCloseTo(12);
    // Never before the passage itself
    expect(hookStart(words, 10.1, 9.95)).toBeCloseTo(9.95);
    // No word after it (a sound, a clip never transcribed): where it was
    expect(hookStart(words, 20, 9)).toBe(20);
    expect(hookStart([], 12.3, 9)).toBe(12.3);
  });

  it("keeps what the AI named as the video's hook when a plan becomes passages, and follows it when the video is changed", () => {
    const hit = (start: number, end: number, more: Partial<LiveHit> = {}): LiveHit => ({ start, end, sources: ["ai"], text: `t${start}`, before: "", after: "", chat: [], why: "", score: 0.8, ...more });
    expect(itemFromHit(hit(100, 104, { opening: true }), 0).opening).toBe(true);
    expect("opening" in itemFromHit(hit(100, 104), 0)).toBe(false);

    // The video as it is, told to the AI with a change: the passage it can open on says so
    const now = { sections: [{ id: "one", title: "A", query: "", items: [piece("a", 100, 104), piece("b", 200, 204, { opening: true }), piece("c", 300, 304)] }] };
    expect(planCurrent(now)[0].items).toEqual([{ start: 100, end: 104 }, { start: 200, end: 204, opening: true }, { start: 300, end: 304 }]);

    // The AI gives the video back and names another moment: the mark moves
    const moved = revisedSections(now, { title: "", sections: [{ title: "A", hits: [hit(100, 104), hit(200, 204), hit(300, 304, { opening: true })] }], note: "" } as VideoPlan, 0);
    expect(moved.sections[0].items.map((item) => !!item.opening)).toEqual([false, false, true]);
    expect(moved.sections[0].items.map((item) => item.id)).toEqual(["a", "b", "c"]);
    // It names none: the one it had named stays
    const kept = revisedSections(now, { title: "", sections: [{ title: "A", hits: [hit(100, 104), hit(200, 204), hit(300, 304)] }], note: "" } as VideoPlan, 0);
    expect(kept.sections[0].items.map((item) => !!item.opening)).toEqual([false, true, false]);
    // A passage it adds and names
    const added = revisedSections(now, { title: "", sections: [{ title: "A", hits: [hit(100, 104), hit(200, 204), hit(300, 304), hit(400, 404, { opening: true })] }], note: "" } as VideoPlan, 0);
    expect(added.sections[0].items.map((item) => !!item.opening)).toEqual([false, false, false, true]);
  });
});

describe("cutting a passage in the montage", () => {
  const piece = (id: string, start: number, end: number, more: Partial<CompilationItem> = {}): CompilationItem => ({ id, start, end, text: "", why: "", sources: ["ai"], ...more });
  const video = (items: CompilationItem[], second: CompilationItem[] = []) => ({ sections: [{ id: "s1", title: "A", query: "", items }, ...(second.length ? [{ id: "s2", title: "B", query: "", items: second }] : [])] });

  it("cuts a passage in two where the video is: the first half keeps its id, the second is made out of it", () => {
    const before = video([piece("aaaaaaaaaa", 100, 110, { text: "avant après", fit: [100, 110], opening: true }), piece("bbbbbbbbbb", 200, 204)]);
    const { compilation, ids } = splitItem(before, "aaaaaaaaaa", 104.126, ["avant", "après"]);
    const items = compilation.sections[0].items;
    expect(items.map((i) => [i.start, i.end, i.text])).toEqual([[100, 104.13, "avant"], [104.13, 110, "après"], [200, 204, ""]]);
    expect(ids).toEqual([items[0].id, items[1].id]);
    expect(items[0].id).toBe("aaaaaaaaaa");
    // The second half plays the first one's clip until it has its own, and follows it with a plain cut
    expect(items[1]).toMatchObject({ like: "aaaaaaaaaa", transition: "cut" });
    expect(items[1].id).not.toBe("aaaaaaaaaa");
    // Cut by hand: no longer waiting to be set on its words; one moment only opens the video
    expect(items[0]).not.toHaveProperty("fit");
    expect([items[0].opening, items[1].opening]).toEqual([true, undefined]);
    // Too close to an end: nothing to cut
    expect(splitItem(before, "aaaaaaaaaa", 100.1).compilation).toBe(before);
    expect(splitItem(before, "aaaaaaaaaa", 109.9).ids).toEqual([]);
    expect(splitItem(before, "nope", 104).compilation).toBe(before);
  });

  it("cuts a passage into several pieces (its silences taken out), in its place among the others", () => {
    const before = video([piece("aaaaaaaaaa", 100, 130, { text: "tout" })], [piece("cccccccccc", 300, 305)]);
    const { compilation, ids } = cutItem(before, "aaaaaaaaaa", [[100, 108], [112.5, 112.6], [115, 130]]);
    // (a piece too short to be one is left out)
    expect(compilation.sections[0].items.map((i) => [i.start, i.end])).toEqual([[100, 108], [115, 130]]);
    expect(ids).toHaveLength(2);
    expect(compilation.sections[1]).toBe(before.sections[1]);
    expect(cutItem(before, "aaaaaaaaaa", [[100, 100.1]]).compilation).toBe(before);
  });

  it("gives a passage 30 s more of the live on one side, within the live", () => {
    const before = video([piece("aaaaaaaaaa", 20, 40, { fit: [20, 40] }), piece("bbbbbbbbbb", 3580, 3595)]);
    expect(allItems(extendItem(before, "aaaaaaaaaa", "start", 30, 3600))[0]).toMatchObject({ start: 0, end: 40 });
    expect(allItems(extendItem(before, "aaaaaaaaaa", "end", 30, 3600))[0]).toMatchObject({ start: 20, end: 70 });
    // (moved by hand: no longer waiting to be set on its words)
    expect(allItems(extendItem(before, "aaaaaaaaaa", "end", 30, 3600))[0].fit).toBeUndefined();
    expect(allItems(extendItem(before, "bbbbbbbbbb", "end", 30, 3600))[1]).toMatchObject({ end: 3600 });
    // At the live's end already: nothing changes
    const atEnd = video([piece("aaaaaaaaaa", 3590, 3600)]);
    expect(extendItem(atEnd, "aaaaaaaaaa", "end", 30, 3600)).toBe(atEnd);
  });

  it("cuts a clip's video again as a whole: its passages become the pieces given", () => {
    const before = video([piece("aaaaaaaaaa", 1000, 1020, { text: "début" }), piece("bbbbbbbbbb", 1030, 1050)]);
    const after = recutVideo(before, [[1004, 1012], [1040, 1046.5], [1060, 1071]]);
    const items = allItems(after);
    expect(items.map((i) => [i.start, i.end])).toEqual([[1004, 1012], [1040, 1046.5], [1060, 1071]]);
    expect(items[0].id).toBe("aaaaaaaaaa");
    expect(items.slice(1).every((i) => i.like === "aaaaaaaaaa")).toBe(true);
    expect(recutVideo(before, [])).toBe(before);
  });
});

describe("a video of the media library as a passage", () => {
  const media = { id: "m0000000a", name: "Outro de fin", seconds: 12.34 };
  const live = (id: string, start: number, end: number, more: Partial<CompilationItem> = {}): CompilationItem => ({ id, start, end, text: "", why: "", sources: ["voice"], ...more });
  const imported = (id: string, more: Partial<CompilationItem> = {}): CompilationItem => ({ ...itemFromMedia(media), id, ...more });
  const part = (id: string, title: string, items: CompilationItem[]): CompilationSection => ({ id, title, query: "", items });
  const hit = (start: number, end: number): LiveHit => ({ start, end, sources: ["ai"], text: "", before: "", after: "", chat: [], why: "", score: 0.8, spoken: false });

  it("is all of it, on its own clock, named by its name; its clip is asked from the library", () => {
    const item = itemFromMedia(media);
    expect(item).toMatchObject({ start: 0, end: 12.34, text: "", why: "Outro de fin", media: "m0000000a" });
    expect(itemFromMedia({ ...media, seconds: 400 }).end).toBe(180);
    // Filmed upright: it fills the frame; a wide one is shown as the rest of the video
    expect(itemFromMedia({ ...media, width: 1080, height: 1920 }).template).toBe("plein");
    expect(itemFromMedia({ ...media, width: 1920, height: 1080 }).template).toBeUndefined();
    expect(pieceAsk(item)).toEqual({ id: item.id, start: 0, end: 12.34, media: "m0000000a" });
    // A passage cut out of it plays the same file; a passage of the live still waiting for its words asks for them whole
    expect(pieceAsk({ ...item, start: 2, end: 5, like: "aaaaaaaaaa" })).toEqual({ id: item.id, start: 2, end: 5, like: "aaaaaaaaaa", media: "m0000000a" });
    expect(pieceAsk(live("bbbbbbbbbb", 100.4, 102, { fit: [100, 103] }))).toEqual({ id: "bbbbbbbbbb", start: 100, end: 103, fit: [100, 103] });
  });

  it("is never taken for a moment of the live at the same seconds, and can be in a video twice", () => {
    const c = { sections: [part("s1", "", [live("aaaaaaaaaa", 0, 12)])] };
    // (the first twelve seconds of the live and of the video are not the same thing)
    expect(itemFor(c, { start: 0, end: 12, media: "m0000000a" })).toBeUndefined();
    const once = insertItems(c, "s1", [imported("mmmmmmmmm1")]);
    const twice = insertItems(once, "s1", [imported("mmmmmmmmm2")], "aaaaaaaaaa");
    expect(allItems(twice).map((item) => item.id)).toEqual(["aaaaaaaaaa", "mmmmmmmmm2", "mmmmmmmmm1"]);
    expect(insertItems(c, "nowhere", [imported("mmmmmmmmm1")])).toEqual(c);
    expect(insertItems(c, "s1", [])).toBe(c);
  });

  it("is neither shortened nor taken out when the video is brought to a length", () => {
    const c = { sections: [part("s1", "", [live("aaaaaaaaaa", 100, 110, { score: 0.9 }), imported("mmmmmmmmm1"), live("bbbbbbbbbb", 200, 210, { score: 0.2 }), live("cccccccccc", 300, 310, { score: 0.6 })])] };
    const whole = fitToTarget(c, 25, true);
    expect(allItems(whole).map((item) => item.id)).toEqual(["aaaaaaaaaa", "mmmmmmmmm1"]);
    const squeezed = fitToTarget(c, 30);
    const kept = allItems(squeezed).find((item) => item.id === "mmmmmmmmm1")!;
    expect([kept.start, kept.end]).toEqual([0, 12.34]);
    // Nothing but the imported video left to take from: it stops there
    const alone = { sections: [part("s1", "", [imported("mmmmmmmmm1"), imported("mmmmmmmmm2")])] };
    expect(allItems(fitToTarget(alone, 5, true))).toHaveLength(2);
  });

  it("is not told to the AI, and stays where it was when the AI gives the video back", () => {
    const c = {
      sections: [
        part("s1", "Le plan", [imported("mmmmmmmmm0"), live("aaaaaaaaaa", 100, 104), imported("mmmmmmmmm1"), live("bbbbbbbbbb", 200, 204)]),
        part("s2", "La fuite", [live("cccccccccc", 300, 304), imported("mmmmmmmmm2")]),
        part("s3", "", [imported("mmmmmmmmm3")]),
      ],
    };
    expect(planCurrent(c)).toEqual([
      { title: "Le plan", items: [{ start: 100, end: 104 }, { start: 200, end: 204 }] },
      { title: "La fuite", items: [{ start: 300, end: 304 }] },
    ]);
    // The AI takes the first passage out, adds one, and drops the second part
    const plan: VideoPlan = { title: "", sections: [{ title: "Le plan", hits: [hit(200, 204), hit(500, 503)] }] };
    const revised = revisedSections(c, plan, 3600);
    expect(revised.sections).toHaveLength(1);
    const ids = revised.sections[0].items.map((item) => (item.media || item.id.length === 10 && /^[a-c]+$/.test(item.id) ? item.id : "new"));
    // At the head of its part; after the passage it followed, or the one before that when it is gone; those of parts that are gone follow the last passage before them
    expect(ids).toEqual(["mmmmmmmmm0", "mmmmmmmmm1", "bbbbbbbbbb", "mmmmmmmmm2", "mmmmmmmmm3", "new"]);
    // Only what the AI took out is counted as gone
    expect(revised.gone.map(({ item }) => item.id)).toEqual(["aaaaaaaaaa", "cccccccccc"]);
    expect(revised).toMatchObject({ added: 1, removed: 2 });
    // The AI gives nothing back: the imported videos are still a video
    const emptied = revisedSections(c, { title: "", sections: [] }, 3600);
    expect(emptied.sections.flatMap((s) => s.items.map((item) => item.id))).toEqual(["mmmmmmmmm0", "mmmmmmmmm1", "mmmmmmmmm2", "mmmmmmmmm3"]);
  });
});

describe("the tools on several passages at once", () => {
  it("cuts each of them into its pieces in one change, and says what came of it", () => {
    const c = { sections: [section("s1", [item("aaaaaaaaaa", 100, 120), item("bbbbbbbbbb", 200, 210), item("cccccccccc", 300, 330)])] };
    const { compilation: next, ids: made, cut } = cutItems(c, [
      { id: "aaaaaaaaaa", pieces: [[101, 104], [110, 118]], texts: ["un", "deux"] },
      // (pieces too short to be passages: this one stays as it is)
      { id: "bbbbbbbbbb", pieces: [[200, 200.1]] },
      { id: "cccccccccc", pieces: [[300, 310], [315, 320], [322, 329]] },
      { id: "nobodyhere", pieces: [[1, 5]] },
    ]);
    expect(cut).toBe(2);
    const all = allItems(next);
    expect(all.map((i) => [i.start, i.end])).toEqual([[101, 104], [110, 118], [200, 210], [300, 310], [315, 320], [322, 329]]);
    // Each keeps its place and its id; what was made of it follows, made out of it
    expect(all[0].id).toBe("aaaaaaaaaa");
    expect(all[1].like).toBe("aaaaaaaaaa");
    expect(all[2].id).toBe("bbbbbbbbbb");
    expect(all.slice(4).every((i) => i.like === "cccccccccc")).toBe(true);
    expect(made).toEqual([all[0].id, all[1].id, all[3].id, all[4].id, all[5].id]);
    expect(all.slice(0, 2).map((i) => i.text)).toEqual(["un", "deux"]);
    // Nothing to cut: the same video
    expect(cutItems(c, []).compilation).toBe(c);
  });
});
