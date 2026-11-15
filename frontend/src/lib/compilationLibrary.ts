import type { CompilationSummary, LiveCompilations, TwitchVod } from "./api";
import { ACTIVE_STATUSES } from "./format";

/** Where a compilation stands, as its card says it */
export type CompilationStatus = "empty" | "draft" | "exported" | "changed";

/** Saved this long after its export, a compilation was changed since (saving the export itself takes a moment) */
const CHANGED_AFTER_MS = 60_000;

export function compilationStatus(c: Pick<CompilationSummary, "passages" | "exported_at" | "updated_at">): CompilationStatus {
  if (c.passages === 0) return "empty";
  if (!c.exported_at) return "draft";
  return Date.parse(c.updated_at) - Date.parse(c.exported_at) > CHANGED_AFTER_MS ? "changed" : "exported";
}

/** When a live was streamed (else when it was analysed) */
export const liveWhen = (live: Pick<LiveCompilations, "stream_date" | "created_at">): string | null => live.stream_date ?? live.created_at;

/**
 * The lives that have compilations, newest live first, each with its newest compilation first;
 * `jobId`: that live only. A compilation made from several lives is in each of their groups.
 */
export function libraryGroups(lives: LiveCompilations[], jobId: string | null = null): LiveCompilations[] {
  return lives
    .filter((live) => live.compilations.length > 0 && (!jobId || live.job_id === jobId))
    .map((live) => ({ ...live, compilations: [...live.compilations].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)) }))
    .sort((a, b) => Date.parse(liveWhen(b) ?? "") - Date.parse(liveWhen(a) ?? ""));
}

/** How many compilations there are: one made from several lives is listed with each, and counts once */
export function libraryCount(lives: LiveCompilations[]): number {
  return new Set(lives.flatMap((live) => live.compilations.map((c) => `${c.home}/${c.id}`))).size;
}

/** The names of the compilations kept with a live (a copy is kept where its original is) */
export function namesKeptWith(lives: LiveCompilations[], home: string): string[] {
  const names = new Map(lives.flatMap((live) => live.compilations.filter((c) => c.home === home).map((c) => [c.id, c.name] as const)));
  return [...names.values()];
}

/** "Calme (copie)", then "Calme (copie 2)": a name no compilation of the live has yet */
export function copyName(name: string, taken: string[], word: string): string {
  const base = name.replace(new RegExp(` \\(${word}(?: \\d+)?\\)$`), "");
  for (let n = 1; ; n++) {
    const candidate = `${base} (${word}${n > 1 ? ` ${n}` : ""})`.slice(0, 80);
    if (!taken.includes(candidate) || n > 50) return candidate;
  }
}

/** "14 nov." (with the year when it is not this one), to say when in a sentence */
export function plainDate(iso: string, lang: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toLocaleDateString(lang, { day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}

/** Where a live of the channel stands when it can't be picked yet: never analysed, being analysed, or stopped on an error */
export type VodState = "new" | "running" | "failed";

/**
 * The channel's lives a compilation can't take from yet, newest first: those never analysed,
 * being analysed, or whose analysis stopped. A live still being streamed is left out (nothing to analyse yet).
 */
export function vodsToAnalyse(vods: TwitchVod[]): { vod: TwitchVod; state: VodState }[] {
  return vods
    .filter((vod) => !vod.recording && vod.job?.status !== "DONE")
    .map((vod) => ({ vod, state: (!vod.job ? "new" : ACTIVE_STATUSES.has(vod.job.status) ? "running" : "failed") as VodState }))
    .sort((a, b) => Date.parse(b.vod.published_at) - Date.parse(a.vod.published_at));
}
