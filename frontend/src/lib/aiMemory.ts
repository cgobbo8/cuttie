/**
 * What the AI remembers of the streamer (page « Ma chaîne », « Mémoire »): pure logic of the window.
 * The AI writes the memory itself after each live (backend/app/services/memory.py); the server
 * serves it (api/app/services/memory.ts).
 */

import type { AiMemory, MemoryReadingResult } from "./api";

/** Told to the rest of the app when a note was changed by a correction the AI proposed (the notes card reloads) */
export const NOTE_CHANGED = "cuttie:note-changed";
/** ...and when the AI has just read a live into its memory: it may have a correction to propose for a note */
export const MEMORY_READ = "cuttie:memory-read";

/** A section of the memory as the lines to show (the « - » that starts each is dropped) */
export function memoryLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*·]\s*/, "").trim())
    .filter(Boolean);
}

/** The AI holds nothing yet: no section written, no live read */
export const isEmptyMemory = (memory: Pick<AiMemory, "sections" | "lives">): boolean => memory.lives.length === 0 && Object.values(memory.sections).every((text) => !text.trim());

/** An event of a live as its time (when it starts with one, « [1:12:40] ») and what happened */
export function eventParts(event: string): { at: string | null; text: string } {
  const timed = /^\s*\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/s.exec(event);
  return timed ? { at: timed[1], text: timed[2].trim() } : { at: null, text: event.trim() };
}

/** The day of a live as it is shown: « 9 nov. 2026 » ("" when it is not a day) */
export function liveDay(date: string | null | undefined, lang: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? "");
  if (!day) return "";
  return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric" }).format(new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])));
}

/**
 * What a correction changes in a sentence: the words both share at the start (`head`) and at the
 * end (`tail`), and between them what is taken out (`was`) and put in (`now`). Cut between words.
 */
export function changedWords(before: string, after: string): { head: string; was: string; now: string; tail: string } {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return {
    head: a.slice(0, start).join(""),
    was: a.slice(start, a.length - end).join(""),
    now: b.slice(start, b.length - end).join(""),
    tail: a.slice(a.length - end).join(""),
  };
}

/** How reading the earlier lives ended, as the key of what is said and whether it went well */
export function readingOutcome(result: MemoryReadingResult): { key: "done" | "partial" | "credits" | "key" | "unreachable" | "stopped" | "nothing"; ok: boolean } {
  if (result.stopped === "credits" || result.stopped === "key" || result.stopped === "unreachable") return { key: result.stopped, ok: false };
  if (result.stopped === "asked") return { key: "stopped", ok: true };
  if (result.read === 0) return { key: "nothing", ok: false };
  return result.failed > 0 ? { key: "partial", ok: true } : { key: "done", ok: true };
}
