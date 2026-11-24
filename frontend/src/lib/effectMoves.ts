import type { SegmentEffect } from "./effects";

/**
 * What moves the picture of a video, as it is shown to the streamer: where each move is on the
 * video's clock, and what it is for. The effects themselves are placed without them seeing it
 * (see effects.ts): a lane of the timeline says where they fell.
 */

/** A shout (the webcam comes closer), a line that lands, a slow close-up on plain talk, or a whole passage that plays a little closer */
export type MoveKind = "shout" | "line" | "calm" | "closer";

export interface Move {
  kind: MoveKind;
  /** Frames of the whole video */
  from: number;
  to: number;
  /** It comes with a small tremor */
  shake: boolean;
}

/**
 * The moves of a video: `segments[i].effects` are piece `i`'s, on its own clock, and
 * `marks[i]` is where that piece plays in the video (frames). A tremor is not a move of its
 * own: it belongs to the zoom it comes with.
 */
export function videoMoves(segments: { effects?: SegmentEffect[] }[], marks: { from: number; to: number }[], fps: number): Move[] {
  const moves: Move[] = [];
  segments.forEach((segment, i) => {
    const mark = marks[i];
    if (!mark) return;
    const effects = segment.effects ?? [];
    for (const effect of effects) {
      if (effect.kind === "shake") continue;
      const kind: MoveKind = effect.kind === "zoom" ? "closer" : effect.kind === "ease" ? "calm" : effect.on === "cam" ? "shout" : "line";
      const from = Math.min(mark.to, mark.from + Math.round(effect.at * fps));
      const to = Math.min(mark.to, from + Math.max(1, Math.round(effect.for * fps)));
      moves.push({ kind, from, to, shake: effects.some((other) => other.kind === "shake" && Math.abs(other.at - effect.at) < 0.05) });
    }
  });
  return moves.sort((a, b) => a.from - b.from);
}

/** How many of them are seen as a move: a passage that only plays a little closer is not one */
export const seenMoves = (moves: Move[]): number => moves.filter((move) => move.kind !== "closer").length;
