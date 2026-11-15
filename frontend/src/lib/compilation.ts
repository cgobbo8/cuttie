/**
 * Compilations: videos made of pieces of the live found by searching it.
 * Pure logic of the builder: turning search results into items, ordering
 * them in sections, fitting a length. Items are moments in live seconds;
 * each gets its own small clip (see api/app/services/compilations.ts).
 */

import type { TFunction } from "i18next";
import type { Compilation, CompilationItem, CompilationSection, LiveHit, LiveSearchStep, VideoPlan } from "./api";
import { HOOK_MAX, HOOK_MIN, HOOK_SECONDS, introSeconds, type HookChoice } from "./intro/intros";
import { isTransition, type TransitionId } from "./transitions";

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
    ...(hit.job ? { job: hit.job } : {}),
    ...(hit.opening ? { opening: true } : {}),
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

/** Two moments of the same live (times of two lives say nothing of each other) */
const sameLive = (a: { job?: string }, b: { job?: string }) => (a.job ?? "") === (b.job ?? "");

function sameMoment(a: { start: number; end: number; job?: string }, b: { start: number; end: number; job?: string }): boolean {
  if (!sameLive(a, b)) return false;
  const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shared > 0 && shorter > 0 && shared / shorter >= SAME_MOMENT;
}

/** The item of the compilation that shows this moment, if any (search results already added) */
export function itemFor(c: Pick<Compilation, "sections">, moment: { start: number; end: number; job?: string }): CompilationItem | undefined {
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

/**
 * Several passages one place earlier (-1) or later (+1), each as `moveItem`
 * moves one and in their order: they keep their places among themselves. One
 * that would have to jump over another of them that can't move stays behind it.
 */
export function moveItems<T extends Pick<Compilation, "sections">>(c: T, ids: Iterable<string>, by: -1 | 1): T {
  const picked = new Set(ids);
  const order = allItems(c).filter((item) => picked.has(item.id)).map((item) => item.id);
  // The one in front goes first
  if (by === 1) order.reverse();
  let next = c;
  for (const id of order) {
    const section = next.sections.find((s) => s.items.some((item) => item.id === id))!;
    const neighbor = section.items[section.items.findIndex((item) => item.id === id) + by];
    if (neighbor && picked.has(neighbor.id)) continue;
    next = moveItem(next, id, by);
  }
  return next;
}

/**
 * Passages taken from wherever they are and put together, in the order they
 * play, in one part: right before its passage `before`, at its end without
 * one. Dropped on one of themselves, they go before the next passage that stays.
 */
export function placeItems<T extends Pick<Compilation, "sections">>(c: T, ids: Iterable<string>, sectionId: string, before: string | null = null): T {
  const picked = new Set(ids);
  const moved = allItems(c).filter((item) => picked.has(item.id));
  const target = c.sections.find((s) => s.id === sectionId);
  if (moved.length === 0 || !target) return c;
  let anchor = before;
  if (anchor && picked.has(anchor)) {
    const at = target.items.findIndex((item) => item.id === anchor);
    anchor = at === -1 ? null : (target.items.slice(at + 1).find((item) => !picked.has(item.id))?.id ?? null);
  }
  const next = mapSections(c, (s) => {
    const rest = s.items.filter((item) => !picked.has(item.id));
    if (s.id !== sectionId) return rest.length === s.items.length ? s : { ...s, items: rest };
    const found = anchor ? rest.findIndex((item) => item.id === anchor) : -1;
    const at = found === -1 ? rest.length : found;
    return { ...s, items: [...rest.slice(0, at), ...moved, ...rest.slice(at)] };
  });
  // Dropped where they already were: nothing changed
  const order = (x: Pick<Compilation, "sections">) => x.sections.map((s) => s.items.map((item) => item.id).join(",")).join("|");
  return order(next) === order(c) ? c : next;
}

/** Without these passages */
export function removeItems<T extends Pick<Compilation, "sections">>(c: T, ids: Iterable<string>): T {
  const picked = new Set(ids);
  return mapSections(c, (s) => (s.items.some((item) => picked.has(item.id)) ? { ...s, items: s.items.filter((item) => !picked.has(item.id)) } : s));
}

/** The passages from one to another, both included, in the order they play (a range picked with Shift) */
export function itemsBetween(c: Pick<Compilation, "sections">, a: string, b: string): string[] {
  const ids = allItems(c).map((item) => item.id);
  const [from, to] = [ids.indexOf(a), ids.indexOf(b)].sort((x, y) => x - y);
  return from === -1 ? (ids.includes(b) ? [b] : []) : ids.slice(from, to + 1);
}

/* ── Transitions ──────────────────────────────────────────── */

/** A passage's own way in that says "no transition here", where the rest of the video has one */
export const PLAIN_CUT = "cut";

/**
 * The ready-made transition each passage comes in with, by passage: its own
 * when it has one, else the video's. None for the video's first passage
 * (nothing comes before it) nor where a plain cut was asked.
 */
export function transitionsOf(c: Pick<Compilation, "sections" | "transition">): Record<string, TransitionId> {
  const found: Record<string, TransitionId> = {};
  allItems(c).forEach((item, i) => {
    const key = item.transition ?? c.transition;
    if (i > 0 && isTransition(key)) found[item.id] = key;
  });
  return found;
}

/**
 * How these passages come in: a ready-made transition, a plain cut, or (null)
 * as the rest of the video does. One that would only repeat the video's is not
 * kept: the passage follows the video again.
 */
export function setTransition<T extends Pick<Compilation, "sections" | "transition">>(c: T, ids: Iterable<string>, transition: string | null): T {
  const picked = new Set(ids);
  const same = transition === null || transition === (c.transition ?? PLAIN_CUT);
  return mapSections(c, (s) => ({
    ...s,
    items: s.items.map((item) => {
      if (!picked.has(item.id)) return item;
      const { transition: _own, ...rest } = item;
      return same ? rest : { ...rest, transition: transition! };
    }),
  }));
}

/** The whole video with one transition (null: plain cuts), every passage following it */
export function setVideoTransition<T extends Pick<Compilation, "sections" | "transition">>(c: T, transition: string | null, everywhere = false): T {
  const { transition: _before, ...rest } = c;
  const next = { ...rest, ...(transition && transition !== PLAIN_CUT ? { transition } : {}) } as T;
  return mapSections(next, (s) => ({
    ...s,
    items: s.items.map((item) => {
      // A passage's own choice stays, unless it now only repeats the video's
      if (!everywhere && item.transition !== undefined && item.transition !== (next.transition ?? PLAIN_CUT)) return item;
      const { transition: _own, ...plain } = item;
      return plain;
    }),
  }));
}

/** How many passages come in their own way (not as the rest of the video does) */
export const ownTransitions = (c: Pick<Compilation, "sections" | "transition">): number =>
  allItems(c).filter((item, i) => i > 0 && item.transition !== undefined && item.transition !== (c.transition ?? PLAIN_CUT)).length;

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

/* ── The "hook" intro: the moment of the video it plays first ── */

/**
 * The part of a passage a hook plays when nobody chose: all of one that is a hook's length, the
 * end of a longer one (where the punchline is; nothing says so, the streamer can move it). Live seconds.
 */
export function hookSpan(item: Pick<CompilationItem, "start" | "end">): [number, number] {
  return item.end - item.start <= HOOK_MAX ? [item.start, item.end] : [hundredth(item.end - HOOK_SECONDS), item.end];
}

/**
 * The passage a video opens on when nobody chose: the one the AI named as its hook; else, among
 * those short enough to be played whole (any, when none is), the best scored (of equals, the
 * last: a payoff comes late), or the last one when nobody scored them. Never the first passage,
 * which would play twice in a row; null when the video has no other.
 */
export function bestHook(items: CompilationItem[]): CompilationItem | null {
  const later = items.slice(1);
  if (later.length === 0) return null;
  const named = later.find((item) => item.opening);
  if (named) return named;
  const short = later.filter((item) => item.end - item.start <= HOOK_MAX);
  const among = short.length > 0 ? short : later;
  const scored = among.filter((item) => item.score !== undefined);
  if (scored.length === 0) return among[among.length - 1];
  const best = Math.max(...scored.map((item) => item.score!));
  return [...scored].reverse().find((item) => item.score === best)!;
}

/** The moment a "hook" intro plays: a passage of the video and the part of it that is shown (live seconds) */
export interface HookMoment {
  item: CompilationItem;
  start: number;
  end: number;
  /** Nobody chose it: the app did, and chooses again when the video changes */
  auto: boolean;
}

/**
 * What a video with a "hook" intro opens on: the moment the streamer chose while it is still
 * one of the video's passages (kept inside the passage as it is cut today), else the app's
 * choice. Null: another intro, or a video with fewer than two passages.
 */
export function hookMoment(c: Pick<Compilation, "sections" | "intro">): HookMoment | null {
  if (c.intro?.style !== "hook") return null;
  const items = allItems(c);
  const kept = c.intro.hook;
  const chosen = kept && !kept.auto ? items.slice(1).find((item) => item.id === kept.item) : undefined;
  if (chosen && kept) {
    const most = Math.min(HOOK_MAX, chosen.end - chosen.start);
    const least = Math.min(HOOK_MIN, most);
    const length = Math.min(most, Math.max(least, kept.end - kept.start));
    const start = Math.min(Math.max(kept.start, chosen.start), chosen.end - length);
    return { item: chosen, start: hundredth(start), end: hundredth(start + length), auto: false };
  }
  const item = bestHook(items);
  if (!item) return null;
  const [start, end] = hookSpan(item);
  return { item, start, end, auto: true };
}

/** The video with what its "hook" intro plays written on it (what the library counts its length with); itself when nothing changes */
export function withHook<T extends Pick<Compilation, "sections" | "intro">>(c: T): T {
  if (!c.intro) return c;
  const moment = hookMoment(c);
  const next: HookChoice | undefined = moment ? { item: moment.item.id, start: moment.start, end: moment.end, ...(moment.auto ? { auto: true } : {}) } : undefined;
  const now = c.intro.hook;
  if ((!now && !next) || (now && next && now.item === next.item && now.start === next.start && now.end === next.end && !!now.auto === !!next.auto)) return c;
  const { hook: _before, ...rest } = c.intro;
  return { ...c, intro: next ? { ...rest, hook: next } : rest };
}

/** Seconds the video's intro adds: its style's, or what its hook's moment lasts */
export function openingSeconds(c: Pick<Compilation, "sections" | "intro">): number {
  if (c.intro?.style !== "hook") return introSeconds(c.intro);
  const moment = hookMoment(c);
  return moment ? moment.end - moment.start : 0;
}

/**
 * Where a hook cut out of a longer passage starts: on a word, never inside one. `words`: the
 * clip's (clip seconds); `at`: where it would start; `floor`: where the passage itself starts.
 */
export function hookStart(words: { start: number; end: number }[], at: number, floor: number): number {
  const next = words.find((word) => word.start >= at - 0.35);
  return next ? Math.max(floor, next.start - 0.1) : at;
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
export function sectionsFromPlan(plan: VideoPlan, liveDuration: LiveLength): CompilationSection[] {
  const sections: CompilationSection[] = [];
  const taken: CompilationItem[] = [];
  for (const planned of plan.sections) {
    const items: CompilationItem[] = [];
    for (const hit of planned.hits) {
      const item = itemFromHit(hit, lengthOf(liveDuration, hit.job));
      if (taken.some((t) => sameMoment(t, item))) continue;
      taken.push(item);
      items.push(item);
    }
    if (items.length > 0) sections.push({ id: newId(), title: planned.title, query: "", items });
  }
  return sections;
}

/** The video as the AI is told about it when a change is asked: its parts and where their passages are in the live */
export function planCurrent(c: Pick<Compilation, "sections">): { title: string; items: { start: number; end: number; job?: string; opening?: boolean }[] }[] {
  return c.sections
    .filter((s) => s.items.length > 0)
    .map((s) => ({ title: s.title, items: s.items.map(({ start, end, job, opening }) => ({ start, end, ...(job ? { job } : {}), ...(opening ? { opening: true } : {}) })) }));
}

/** How long a live is: one length for all, or by live when the compilation takes from several (`job`: absent for its own) */
export type LiveLength = number | ((job?: string) => number);
const lengthOf = (length: LiveLength, job?: string): number => (typeof length === "function" ? length(job) : length);

/**
 * The video once the AI changed it as asked: it gives the whole video again.
 * A passage it kept is the one the video already had (its clip, its cut, its
 * template stay); one it gave back with other lines (`recut`: tighter, longer)
 * keeps its clip and template and is cut again on these lines; the others are
 * new. A part keeps its id.
 */
export function revisedSections(
  c: Pick<Compilation, "sections">,
  plan: VideoPlan,
  liveDuration: LiveLength,
): { sections: CompilationSection[]; added: number; removed: number; recut: string[]; fresh: string[]; gone: { item: CompilationItem; section: string; index: number }[] } {
  const before = allItems(c);
  const kept = new Set<string>();
  const parts = new Set<string>();
  const sections: CompilationSection[] = [];
  const fresh: string[] = [];
  const recut: string[] = [];
  let added = 0;
  // The AI names passages by the transcript's lines, whose times hold silence: a passage cut on
  // its words shares little with them. It is the same one as soon as they share a word's worth
  const same = (item: CompilationItem, hit: { start: number; end: number; job?: string }) =>
    sameMoment(item, hit) || (sameLive(item, hit) && Math.min(item.end, hit.end) - Math.max(item.start, hit.start) >= SAME_LINE);
  // The moment the video can open on is the one the AI names now; when it names none, the one it had named stays
  const names = plan.sections.some((s) => s.hits.some((hit) => hit.opening));
  const opens = (item: CompilationItem, hit: { opening?: boolean }): CompilationItem => {
    if (!names || !!item.opening === !!hit.opening) return item;
    const { opening: _before, ...rest } = item;
    return hit.opening ? { ...rest, opening: true } : rest;
  };
  for (const planned of plan.sections) {
    const items: CompilationItem[] = [];
    for (const hit of planned.hits) {
      const known = before.find((item) => !kept.has(item.id) && same(item, hit));
      if (known) {
        kept.add(known.id);
        if (hit.recut) {
          const { start, end, text, fit } = itemFromHit(hit, lengthOf(liveDuration, hit.job));
          items.push(opens({ ...known, start, end, text, fit }, hit));
          recut.push(known.id);
        } else items.push(opens(known, hit));
        // A passage given back in two (a dead line taken out of its middle): its second half is new
      } else if ((hit.recut || !before.some((item) => same(item, hit))) && !items.some((item) => same(item, hit))) {
        const item = itemFromHit(hit, lengthOf(liveDuration, hit.job));
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
  return { sections, added, removed: gone.length, recut, fresh, gone };
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

/** What the AI is told of a video to choose its music and its intro: its title, its parts, how long, and what is said in some of its passages */
export function soundBrief(c: Pick<Compilation, "name" | "sections">, most = 30): { title: string; parts: string[]; seconds: number; passages: number; said: string[]; lengths: number[]; ids: string[] } {
  // Those where something is said, in the video's order; of a long video, some spread over the whole of it
  const items = allItems(c).filter((item) => item.text.trim());
  const step = Math.max(1, items.length / most);
  const picked = Array.from({ length: Math.min(most, items.length) }, (_, i) => items[Math.floor(i * step)]);
  return {
    title: c.name.trim(),
    parts: c.sections.filter((s) => s.items.length > 0 && s.title.trim()).map((s) => s.title.trim()),
    seconds: Math.round(compilationLength(c)),
    passages: allItems(c).length,
    said: picked.map((item) => item.text.trim()),
    // How long each of them lasts, seconds: a hook plays a short passage whole, only the end of a long one
    lengths: picked.map((item) => Math.round((item.end - item.start) * 10) / 10),
    // Which passage each line is: the AI names the one the video could open on by its place in `said`
    ids: picked.map((item) => item.id),
  };
}

/**
 * The video with the sound the AI chose: its music and its intro, or without them when it
 * chose none. What the streamer had set on them stays (the music's presence, the intro's own
 * title and sound) when the track or the style doesn't change. The intro says the AI chose it (`by`):
 * its next choices stay away from the intros it gave the last videos, not from those picked by hand.
 * `opening`: the passage the AI named as the one the video can open on (what a "hook" intro plays
 * unless the streamer chose another); none named: the one it had named before stays.
 */
export function applySound<T extends Pick<Compilation, "music" | "intro" | "sections">>(c: T, choice: { music: string | null; intro: string | null; opening?: string | null }): T {
  const { music, intro, ...kept } = c;
  // Never the first passage: it would play twice in a row
  const named = choice.opening && allItems(c).findIndex((item) => item.id === choice.opening) > 0 ? choice.opening : null;
  const rest = named
    ? mapSections(kept as unknown as T, (s) => ({
        ...s,
        items: s.items.map((item) => {
          if (!!item.opening === (item.id === named)) return item;
          const { opening: _before, ...plain } = item;
          return item.id === named ? { ...plain, opening: true } : plain;
        }),
      }))
    : kept;
  return {
    ...rest,
    ...(choice.music ? { music: { ...(music?.volume !== undefined ? { volume: music.volume } : {}), track: choice.music } } : {}),
    ...(choice.intro
      ? {
          intro: {
            ...(intro?.title ? { title: intro.title } : {}),
            ...(intro?.style === choice.intro && intro.sound ? { sound: intro.sound } : {}),
            ...(intro?.follow === false ? { follow: false } : {}),
            style: choice.intro,
            by: "ai",
          },
        }
      : {}),
  } as T;
}
