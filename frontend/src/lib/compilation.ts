/**
 * Compilations: videos made of pieces of the live found by searching it.
 * Pure logic of the builder: turning search results into items, ordering
 * them in sections, fitting a length. Items are moments in live seconds;
 * each gets its own small clip (see api/app/services/compilations.ts).
 */

import type { TFunction } from "i18next";
import type { Compilation, CompilationItem, CompilationSection, LiveHit, LiveSearchStep, VideoPlan } from "./api";

/** Air kept around what is said when a result becomes an item, seconds */
const PAD_BEFORE = 0.35;
const PAD_AFTER = 0.5;
/** Shortest item a result makes, and shortest one fitting a length leaves */
const MIN_ITEM = 1.5;
const MIN_FITTED = 1.2;
/** Shortest passage cut on its words (a word alone), and the length under which fitting leaves a passage whole */
const MIN_TIGHT = 0.4;
const WHOLE_UNDER = 6;
/** A passage nobody scored counts as this when the weakest go first */
const NO_SCORE = 0.5;
/** Two moments sharing this much of the shorter one are the same moment */
const SAME_MOMENT = 0.5;
/** A passage and a line of the transcript that share this many seconds are the same passage */
const SAME_LINE = 0.4;

/** Under this score (0-1), a moment the AI gave is only close to what was asked: it says what is missing */
const NEAR_SCORE = 0.5;

const hundredth = (s: number) => Math.round(s * 100) / 100;

/** A moment the AI gave as only close to the request, not as a match */
export const isNear = (hit: Pick<LiveHit, "sources" | "score">): boolean => hit.sources.includes("ai") && hit.score < NEAR_SCORE;

/** 10 letters and digits: names a section, an item and its clip */
export function newId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => alphabet[b % alphabet.length]).join("");
}

/** A search result as an item: the moment with a little air around, never too short */
export function itemFromHit(hit: LiveHit, liveDuration: number): CompilationItem {
  let start = hit.start - PAD_BEFORE;
  let end = hit.end + PAD_AFTER;
  if (end - start < MIN_ITEM) {
    const more = (MIN_ITEM - (end - start)) / 2;
    start -= more;
    end += more;
  }
  start = Math.max(0, start);
  if (liveDuration > 0) end = Math.min(liveDuration, end);
  // A near-miss stays marked as one in the compilation ("≈ what is missing")
  const why = isNear(hit) && hit.why ? `≈ ${hit.why}` : hit.why;
  return {
    id: newId(),
    start: hundredth(start),
    end: hundredth(end),
    text: hit.text || hit.chat[0] || "",
    why,
    sources: hit.sources,
    // Words said: these are the transcript's times for them, the real ones come with the clip
    ...(hit.spoken && hit.end > hit.start ? { fit: [hundredth(hit.start), hundredth(hit.end)] as [number, number] } : {}),
    ...(hit.sources.includes("ai") ? { score: hit.score } : {}),
  };
}

/**
 * Passages set on where their words are really said, once their clips are cut.
 * `tight`: by passage, where that is (live seconds), null when its words were
 * not found in the clip: it then stays as it was. Either way the passage is no
 * longer waiting for it.
 */
export function applyTight<T extends Pick<Compilation, "sections">>(c: T, tight: Record<string, [number, number] | null | undefined>): T {
  let changed = false;
  const next = mapSections(c, (s) => ({ ...s, items: s.items.map((item) => (item.fit && tight[item.id] !== undefined ? ((changed = true), tightened(item, tight[item.id]!)) : item)) }));
  return changed ? next : c;
}

/** One passage set on where its words are really said (null: not found, it keeps its bounds) */
export function tightened(item: CompilationItem, bounds: [number, number] | null): CompilationItem {
  const { fit: _waiting, ...rest } = item;
  return bounds && bounds[1] - bounds[0] >= MIN_TIGHT ? { ...rest, start: hundredth(bounds[0]), end: hundredth(bounds[1]) } : rest;
}

export const allItems = (c: Pick<Compilation, "sections">): CompilationItem[] => c.sections.flatMap((s) => s.items);
export const sectionLength = (s: CompilationSection): number => s.items.reduce((sum, item) => sum + (item.end - item.start), 0);
export const compilationLength = (c: Pick<Compilation, "sections">): number => c.sections.reduce((sum, s) => sum + sectionLength(s), 0);

function sameMoment(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shared > 0 && shorter > 0 && shared / shorter >= SAME_MOMENT;
}

/** The item of the compilation that shows this moment, if any (search results already added) */
export function itemFor(c: Pick<Compilation, "sections">, moment: { start: number; end: number }): CompilationItem | undefined {
  return allItems(c).find((item) => sameMoment(item, moment));
}

const mapSections = <T extends Pick<Compilation, "sections">>(c: T, map: (s: CompilationSection) => CompilationSection): T => ({ ...c, sections: c.sections.map(map) });

/** Items added at the end of a section; moments the compilation already has are left out */
export function addItems<T extends Pick<Compilation, "sections">>(c: T, sectionId: string, items: CompilationItem[]): { compilation: T; added: number } {
  const fresh: CompilationItem[] = [];
  for (const item of items) {
    if (!itemFor(c, item) && !fresh.some((f) => sameMoment(f, item))) fresh.push(item);
  }
  return { compilation: mapSections(c, (s) => (s.id === sectionId ? { ...s, items: [...s.items, ...fresh] } : s)), added: fresh.length };
}

export function removeItem<T extends Pick<Compilation, "sections">>(c: T, itemId: string): T {
  return mapSections(c, (s) => ({ ...s, items: s.items.filter((item) => item.id !== itemId) }));
}

export function updateItem<T extends Pick<Compilation, "sections">>(c: T, itemId: string, patch: Partial<CompilationItem>): T {
  return mapSections(c, (s) => ({ ...s, items: s.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)) }));
}

/** An item one place earlier (-1) or later (+1): inside its section, then into the one next to it */
export function moveItem<T extends Pick<Compilation, "sections">>(c: T, itemId: string, by: -1 | 1): T {
  const si = c.sections.findIndex((s) => s.items.some((item) => item.id === itemId));
  if (si === -1) return c;
  const sections = c.sections.map((s) => ({ ...s, items: [...s.items] }));
  const items = sections[si].items;
  const i = items.findIndex((item) => item.id === itemId);
  const to = i + by;
  if (to >= 0 && to < items.length) {
    [items[i], items[to]] = [items[to], items[i]];
  } else {
    const neighbor = sections[si + by];
    if (!neighbor) return c;
    const [item] = items.splice(i, 1);
    if (by === -1) neighbor.items.push(item);
    else neighbor.items.unshift(item);
  }
  return { ...c, sections };
}

export function addSection<T extends Pick<Compilation, "sections">>(c: T, title = "", query = ""): { compilation: T; id: string } {
  const id = newId();
  return { compilation: { ...c, sections: [...c.sections, { id, title, query, items: [] }] }, id };
}

/** Without a section and its items (the last section standing stays, emptied) */
export function removeSection<T extends Pick<Compilation, "sections">>(c: T, sectionId: string): T {
  if (c.sections.length <= 1) return mapSections(c, (s) => (s.id === sectionId ? { ...s, title: "", query: "", items: [] } : s));
  return { ...c, sections: c.sections.filter((s) => s.id !== sectionId) };
}

export function moveSection<T extends Pick<Compilation, "sections">>(c: T, sectionId: string, by: -1 | 1): T {
  const i = c.sections.findIndex((s) => s.id === sectionId);
  const to = i + by;
  if (i === -1 || to < 0 || to >= c.sections.length) return c;
  const sections = [...c.sections];
  [sections[i], sections[to]] = [sections[to], sections[i]];
  return { ...c, sections };
}

/** When each section with items starts in the video, and how long it runs (seconds) */
export function sectionStarts(c: Pick<Compilation, "sections">): { id: string; title: string; at: number; length: number }[] {
  const starts: { id: string; title: string; at: number; length: number }[] = [];
  let at = 0;
  for (const s of c.sections) {
    const length = sectionLength(s);
    if (s.items.length > 0) starts.push({ id: s.id, title: s.title, at, length });
    at += length;
  }
  return starts;
}

/**
 * The compilation brought down to `target` seconds. A sentence can't be
 * shortened without cutting into it, so short passages stay whole:
 * 1. the long ones (over 6 s) are shortened by the same share around their
 *    middle, never under 6 s;
 * 2. then passages go, the weakest first (the AI's score; with nothing to tell
 *    them apart, the last of the longest part), never a part's only one;
 * 3. and when a few passages still run too long, all are shortened around
 *    their middle (never under 1.2 s).
 * `whole`: passages are never shortened, only step 2 (they are cut on their
 * words: shortening one, even by a tenth of a second, clips a word).
 */
export function fitToTarget<T extends Pick<Compilation, "sections">>(c: T, target: number, whole = false): T {
  const total = compilationLength(c);
  if (total <= target || total <= 0) return c;
  const around = (item: CompilationItem, length: number): CompilationItem => {
    const middle = (item.start + item.end) / 2;
    return { ...item, start: hundredth(middle - length / 2), end: hundredth(middle + length / 2) };
  };

  const spare = whole ? 0 : allItems(c).reduce((sum, item) => sum + Math.max(0, item.end - item.start - WHOLE_UNDER), 0);
  const share = spare > 0 ? Math.min(1, (total - target) / spare) : 0;
  let fitted = mapSections(c, (s) => ({
    ...s,
    items: s.items.map((item) => {
      const length = item.end - item.start;
      return length > WHOLE_UNDER && share > 0 ? around(item, length - (length - WHOLE_UNDER) * share) : item;
    }),
  }));

  while (compilationLength(fitted) > target * 1.03) {
    const droppable = fitted.sections.filter((s) => s.items.length > 1);
    if (droppable.length === 0) break;
    const weakest = Math.min(...droppable.flatMap((s) => s.items.map((item) => item.score ?? NO_SCORE)));
    // Of the weakest, the last one of the longest part
    const from = [...droppable].filter((s) => s.items.some((item) => (item.score ?? NO_SCORE) === weakest)).sort((x, y) => sectionLength(y) - sectionLength(x))[0];
    const gone = [...from.items].reverse().find((item) => (item.score ?? NO_SCORE) === weakest)!;
    fitted = mapSections(fitted, (s) => (s.id === from.id ? { ...s, items: s.items.filter((item) => item.id !== gone.id) } : s));
  }

  const left = compilationLength(fitted);
  if (!whole && left > target * 1.03) {
    const squeeze = target / left;
    fitted = mapSections(fitted, (s) => ({
      ...s,
      items: s.items.map((item) => around(item, Math.max(Math.min(item.end - item.start, MIN_FITTED), (item.end - item.start) * squeeze))),
    }));
  }
  return fitted;
}

/**
 * The templates the AI chose, on the compilation: `main` becomes the video's
 * template, and only the passages shown otherwise keep a template of their own.
 */
export function applyLooks<T extends Pick<Compilation, "sections" | "template">>(c: T, main: string, looks: Record<string, string>): T {
  return {
    ...mapSections(c, (s) => ({
      ...s,
      items: s.items.map((item) => {
        const { template: _own, ...rest } = item;
        const key = looks[item.id];
        return key && key !== main ? { ...rest, template: key } : rest;
      }),
    })),
    template: main,
  };
}

/** Every passage back to the video's template */
export function clearLooks<T extends Pick<Compilation, "sections">>(c: T): T {
  return mapSections(c, (s) => ({ ...s, items: s.items.map(({ template: _own, ...rest }) => rest) }));
}

/** How many passages each template shows, the most used first: [["empile", 9], ["plein", 3]] */
export function looksCount(c: Pick<Compilation, "sections" | "template">, fallback: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of allItems(c)) {
    const key = item.template || c.template || fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** The AI's plan as sections of items, in the order it gave */
export function sectionsFromPlan(plan: VideoPlan, liveDuration: number): CompilationSection[] {
  const sections: CompilationSection[] = [];
  const taken: CompilationItem[] = [];
  for (const planned of plan.sections) {
    const items: CompilationItem[] = [];
    for (const hit of planned.hits) {
      const item = itemFromHit(hit, liveDuration);
      if (taken.some((t) => sameMoment(t, item))) continue;
      taken.push(item);
      items.push(item);
    }
    if (items.length > 0) sections.push({ id: newId(), title: planned.title, query: "", items });
  }
  return sections;
}

/** The video as the AI is told about it when a change is asked: its parts and where their passages are in the live */
export function planCurrent(c: Pick<Compilation, "sections">): { title: string; items: { start: number; end: number }[] }[] {
  return c.sections.filter((s) => s.items.length > 0).map((s) => ({ title: s.title, items: s.items.map(({ start, end }) => ({ start, end })) }));
}

/**
 * The video once the AI changed it as asked: it gives the whole video again.
 * A passage it kept is the one the video already had (its clip, its cut, its
 * template stay); the others are new. A part keeps its id.
 */
export function revisedSections(
  c: Pick<Compilation, "sections">,
  plan: VideoPlan,
  liveDuration: number,
): { sections: CompilationSection[]; added: number; removed: number; fresh: string[]; gone: { item: CompilationItem; section: string; index: number }[] } {
  const before = allItems(c);
  const kept = new Set<string>();
  const parts = new Set<string>();
  const sections: CompilationSection[] = [];
  const fresh: string[] = [];
  let added = 0;
  // The AI names passages by the transcript's lines, whose times hold silence: a passage cut on
  // its words shares little with them. It is the same one as soon as they share a word's worth
  const same = (item: CompilationItem, hit: { start: number; end: number }) =>
    sameMoment(item, hit) || Math.min(item.end, hit.end) - Math.max(item.start, hit.start) >= SAME_LINE;
  for (const planned of plan.sections) {
    const items: CompilationItem[] = [];
    for (const hit of planned.hits) {
      const known = before.find((item) => !kept.has(item.id) && same(item, hit));
      if (known) {
        kept.add(known.id);
        items.push(known);
      } else if (!before.some((item) => same(item, hit)) && !items.some((item) => same(item, hit))) {
        const item = itemFromHit(hit, liveDuration);
        items.push(item);
        fresh.push(item.id);
        added++;
      }
    }
    if (items.length === 0) continue;
    const old =
      c.sections.find((s) => !parts.has(s.id) && s.title.trim() === planned.title.trim()) ??
      c.sections.find((s) => !parts.has(s.id) && s.items.some((item) => items.includes(item)));
    const id = old?.id ?? newId();
    parts.add(id);
    sections.push({ id, title: planned.title, query: old?.query ?? "", items });
  }
  // What it took out, and where each one was (the video shows them leaving)
  const gone = c.sections.flatMap((s) => s.items.map((item, index) => ({ item, section: s.id, index })).filter(({ item }) => !kept.has(item.id)));
  return { sections, added, removed: gone.length, fresh, gone };
}

/** "1:23:45" in the live */
export function liveClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** What the AI is doing, in the streamer's words: the tool it just called and on what */
export function stepText(t: TFunction, step: LiveSearchStep | null): string {
  const detail = step?.detail ?? "";
  switch (step?.step) {
    case "hearing":
    case "overview":
    case "best_moments":
    case "chat_peaks":
      return t(`compilation.step.${step.step}`);
    case "search_speech":
    case "search_chat":
      return detail ? t(`compilation.step.${step.step}`, { words: detail }) : t("compilation.step.thinking");
    case "find_sounds":
      return t("compilation.step.find_sounds", { sound: t(`compilation.sound.${detail}`, { defaultValue: detail }) });
    case "loud_moments":
      return t(`compilation.step.${["raised_voices", "quiet"].includes(detail) ? detail : "loudest"}`);
    case "read":
    case "listen":
      // The models give times as H:MM:SS, sometimes as seconds
      return t(`compilation.step.${step.step}`, { at: /^\d+(\.\d+)?$/.test(detail) ? liveClock(Number(detail)) : detail });
    default:
      return t("compilation.step.thinking");
  }
}
