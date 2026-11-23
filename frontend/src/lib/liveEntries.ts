import type { Compilation } from "./api";
import { allItems, compilationLength } from "./compilation";
import type { Moment } from "./moments";
import { isWaiting } from "./suggestions";
import { sourceOf, VIDEO_SOURCES, type VideoSource } from "./videoSources";

/**
 * Everything a live gives, in one list of three sections: its clips (the moments the analysis
 * found, and those asked to the AI), its sequences and its compilations (the ideas of the AI
 * and the videos made). Each entry is to see, kept or passed, whatever its source: keeping
 * one makes it a video (see the steps of a live: choose, edit, export).
 */

export type EntryState = "todo" | "kept" | "passed";

export type LiveEntry =
  | { kind: "moment"; key: string; source: "clip"; state: EntryState; score: number; moment: Moment }
  | {
      kind: "video";
      key: string;
      source: VideoSource;
      state: EntryState;
      /** How well the AI thinks it would do (an idea of its own), null for a video the streamer made */
      score: number | null;
      /** An idea of the AI nobody had built yet */
      idea: boolean;
      video: Compilation;
    };

export const momentKey = (filename: string) => `m:${filename}`;
export const videoKey = (id: string) => `v:${id}`;

/** A video nobody put anything in (the blank one a « new » leaves behind): not worth a line */
const blank = (video: Compilation) => allItems(video).length === 0 && !video.brief && !video.suggestion;

const stateOf = (video: Compilation): EntryState => (video.passed ? "passed" : isWaiting(video) ? "todo" : "kept");
/** Kept first, then what is still to see, then what was passed */
const RANK: Record<EntryState, number> = { kept: 0, todo: 1, passed: 2 };

/** The entries of each source, in the order the list shows them */
export function liveEntries(moments: Moment[], videos: Compilation[]): Record<VideoSource, LiveEntry[]> {
  const out: Record<VideoSource, LiveEntry[]> = { clip: [], sequence: [], compilation: [] };
  const clips = new Set(moments.map((m) => m.filename));
  const made: Extract<LiveEntry, { kind: "video" }>[] = [];
  for (const video of videos) {
    // The video of a clip of the analysis is that clip's line, not a second one
    if (video.clip && clips.has(video.clip)) continue;
    if (blank(video)) continue;
    const idea = isWaiting(video);
    made.push({ kind: "video", key: videoKey(video.id), source: sourceOf(video), state: stateOf(video), score: video.suggestion?.score ?? null, idea, video });
  }
  // (the newest of the streamer's own first, the best idea first)
  made.sort((a, b) => RANK[a.state] - RANK[b.state] || (a.state === "kept" ? b.video.updated_at.localeCompare(a.video.updated_at) : (b.score ?? 0) - (a.score ?? 0)));
  for (const entry of made) out[entry.source].push(entry);
  // Clips: those asked to the AI, then the analysis's in its own order (the best first)
  out.clip.push(...moments.map((moment): LiveEntry => ({ kind: "moment", key: momentKey(moment.filename), source: "clip", state: moment.state, score: moment.score, moment })));
  return out;
}

/** How many entries of a section are shown before « see the others » */
export const SHOWN = 6;

/** The entries on screen, in order: every section, cut to its first ones unless it is open (`open`) or holds what is selected */
export function shownEntries(entries: Record<VideoSource, LiveEntry[]>, open: Partial<Record<VideoSource, boolean>>, selected: string | null): LiveEntry[] {
  return VIDEO_SOURCES.flatMap((source) => {
    const list = entries[source];
    const whole = open[source] || list.findIndex((entry) => entry.key === selected) >= SHOWN;
    return whole ? list : list.slice(0, SHOWN);
  });
}

/** What is kept: the videos of this live to edit and export */
export const keptCount = (entries: Record<VideoSource, LiveEntry[]>): number => VIDEO_SOURCES.reduce((sum, source) => sum + entries[source].filter((entry) => entry.state === "kept").length, 0);

/** Ideas of the AI still to see, by source */
export const ideasToSee = (entries: Record<VideoSource, LiveEntry[]>, source: VideoSource): number => entries[source].filter((entry) => entry.kind === "video" && entry.idea && entry.state === "todo").length;

/** What a video is, in numbers: the stretch of the live a sequence tells, the moments spotted for an idea, what it makes */
export function videoFacts(video: Compilation): { span: [number, number] | null; moments: number; passages: number; seconds: number } {
  const items = allItems(video);
  return {
    span: video.suggestion?.span ?? null,
    moments: video.suggestion?.moments.length ?? 0,
    passages: items.length,
    // A video that is built lasts what its passages last; an idea, what it aims for
    seconds: items.length > 0 ? compilationLength(video) : (video.target ?? 0),
  };
}

/** Where to look in the live for a video: its passages, else the moments the AI spotted (live seconds, a few, spread) */
export function videoMoments(video: Compilation, most = 5): number[] {
  const items = allItems(video);
  const all = items.length > 0 ? items.filter((item) => !item.job).map((item) => item.start) : (video.suggestion?.moments ?? []);
  if (all.length <= most) return all;
  if (most <= 1) return all.slice(0, 1);
  return Array.from({ length: most }, (_, i) => all[Math.round((i * (all.length - 1)) / (most - 1))]);
}
