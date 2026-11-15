import { useCallback, useEffect, useState } from "react";
import { getSuggestions, type Compilation, type CompilationSummary, type LiveCompilations } from "./api";
import { useTransmitChannel } from "./TransmitContext";

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
  new Set(lives.flatMap((live) => live.compilations.filter((c) => c.waiting && (!jobId || c.home === jobId)).map((c) => `${c.home}/${c.id}`))).size;

/**
 * How many proposed videos of a live wait to be opened, kept up to date: the AI proposes
 * them a little after the analysis ends, and says so on the live's channel.
 * `known`: the count when the page already has it (nothing is fetched then).
 */
export function useSuggested(jobId: string | undefined, known?: number): number {
  const [count, setCount] = useState(known ?? 0);
  const load = useCallback(() => {
    if (!jobId) return;
    getSuggestions(jobId).then(
      (now) => setCount(now.suggested),
      () => {},
    );
  }, [jobId]);
  useEffect(() => {
    if (known === undefined) load();
    else setCount(known);
  }, [known, load]);
  useTransmitChannel(jobId ? `jobs/${jobId}` : null, (raw: unknown) => {
    const data = raw as { type?: string; suggested?: number };
    if (data?.type === "suggestions" && typeof data.suggested === "number") setCount(data.suggested);
  });
  return count;
}
