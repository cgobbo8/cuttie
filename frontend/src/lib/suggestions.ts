import type { Compilation, CompilationSummary, LiveCompilations } from "./api";

/**
 * Videos the AI proposes on its own once a live is analysed: each is a compilation with the
 * request the AI wrote in the streamer's place (`brief`) and what it saw (`suggestion`), and
 * nothing built yet. Opening one builds it, like any video described to the AI.
 */

/** A proposed video nobody has had built yet: no passage, no answer */
export const isWaiting = (c: Pick<Compilation, "suggestion" | "answer" | "sections">): boolean =>
  !!c.suggestion && !c.answer && c.sections.every((s) => s.items.length === 0);

/** How a virality index reads: strong from 80, good from 65, else worth a try */
export type ViralityLevel = "high" | "good" | "fair";
export const viralityLevel = (score: number): ViralityLevel => (score >= 80 ? "high" : score >= 65 ? "good" : "fair");

/** The cards of a live as its group shows them: the proposed videos that wait first (the most promising first), then the others, newest first */
export function withProposedFirst(cards: CompilationSummary[]): CompilationSummary[] {
  const waiting = cards.filter((c) => c.waiting).sort((a, b) => (b.suggestion?.score ?? 0) - (a.suggestion?.score ?? 0));
  return [...waiting, ...cards.filter((c) => !c.waiting)];
}

/** Proposed videos that wait in the library: one kept with a live counts once, with that live */
export const waitingIn = (lives: LiveCompilations[], jobId?: string): number =>
  // (an idea the streamer passed on no longer waits)
  new Set(lives.flatMap((live) => live.compilations.filter((c) => c.waiting && !c.passed && (!jobId || c.home === jobId)).map((c) => `${c.home}/${c.id}`))).size;
