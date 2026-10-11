import type { ClipChatLine } from "./api";
import { isChatBot } from "./templateContext";

/** Messages this close together stack in one column of dots */
export const CHAT_STACK_SECONDS = 1.2;

/** The chat of a clip as columns of dots: one per message (bots aside), stacked when they come together */
export function stackChat(lines: ClipChatLine[], seconds = CHAT_STACK_SECONDS): { t: number; lines: ClipChatLine[] }[] {
  const columns: { t: number; lines: ClipChatLine[] }[] = [];
  for (const m of lines.filter((l) => !isChatBot(l.author)).sort((a, b) => a.t - b.t)) {
    const last = columns[columns.length - 1];
    if (last && m.t - last.t <= seconds) last.lines.push(m);
    else columns.push({ t: m.t, lines: [m] });
  }
  return columns;
}

/** From how many messages a slice of the live counts among its busiest tenth */
export function busyThreshold(counts: number[]): number {
  const busy = counts.filter((c) => c > 0).sort((a, b) => a - b);
  return Math.max(2, busy[Math.floor(busy.length * 0.9)] ?? Infinity);
}
