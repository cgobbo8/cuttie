import type { AssistantMessage, AssistantPlace } from "./api";

/**
 * What the assistant offers to do, one tap away: read from where the streamer is (the live and
 * what is left to sort in it, the clip or the video on screen and what it lacks) and from what
 * the assistant just answered (ideas to build, videos to export, a live to analyse). Never a
 * fixed list: a video that already plays a music is not offered one.
 */

export type SuggestionIcon = "analyse" | "ideas" | "build" | "cut" | "search" | "music" | "opening" | "length" | "more" | "export" | "best" | "look";

export interface Suggestion {
  /** Its words: `assistant.suggest.<id>`, with `params` */
  id: string;
  icon: SuggestionIcon;
  params?: Record<string, string | number>;
  /** About what it costs, dollars (nothing said: a fraction of a cent, or free) */
  cost?: number;
  /** To be finished by the streamer: its words go into the box instead of being sent */
  fill?: boolean;
}

/** How many are offered at once */
export const MAX_SUGGESTIONS = 4;
/** What having a video built, changed or a live analysed costs, about (as the assistant itself is told) */
export const COSTS = { build: 0.04, change: 0.02, analyse: 0.3 };
/** Past this, a short video is offered to be brought back to a minute (seconds) */
const LONG = 75;

const number = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const short = (name: string) => (name.length > 42 ? `${name.slice(0, 40).trimEnd()}…` : name);

/** What follows from the assistant's last answer: what it showed is acted on */
function followUps(last: AssistantMessage | undefined, place: AssistantPlace | null): Suggestion[] {
  if (last?.role !== "assistant" || last.action || last.failed) return [];
  const offered: Suggestion[] = [];
  for (const block of last.reply ?? []) {
    if (block.type !== "widget") continue;
    if (block.kind === "videos") {
      const idea = block.items.find((video) => video.state === "idea");
      if (idea) offered.push({ id: "buildNamed", icon: "build", params: { name: short(idea.name) }, cost: COSTS.build });
      const drafts = block.items.filter((video) => video.state === "draft");
      if (drafts.length > 1) offered.push({ id: "exportThose", icon: "export", params: { count: drafts.length } });
    }
    if (block.kind === "lives") {
      const live = block.items.find((one) => !one.analysed && one.title);
      if (live) offered.push({ id: "analyseNamed", icon: "analyse", params: { name: short(live.title) }, cost: COSTS.analyse });
    }
    if (block.kind === "clips" && block.items.some((clip) => clip.state !== "kept")) offered.push({ id: "keepThose", icon: "best" });
    if (block.kind === "passages" && place?.page !== "edit" && block.items.length > 1) offered.push({ id: "videoOfThose", icon: "build", cost: COSTS.build });
  }
  return offered;
}

/** What the page on screen calls for */
function fromPlace(place: AssistantPlace | null): Suggestion[] {
  const facts = place?.facts ?? {};
  switch (place?.page) {
    case "live": {
      const offered: Suggestion[] = [];
      if (place.clip) offered.push({ id: "cutClip", icon: "cut" });
      // Ideas of the AI nobody built yet: the best one first; none: the live is looked through for some
      if (number(facts.ideas) > 0) offered.push({ id: "buildBest", icon: "build", cost: COSTS.build });
      else offered.push({ id: "findIdeas", icon: "ideas" });
      if (number(facts.to_sort) > 3) offered.push({ id: "bestClips", icon: "best", params: { count: number(facts.to_sort) } });
      offered.push({ id: "findMoment", icon: "search", fill: true });
      return offered;
    }
    case "edit": {
      if (!place.video) return [{ id: "findIdeas", icon: "ideas" }, { id: "findMoment", icon: "search", fill: true }];
      const passages = number(facts.passages);
      // An idea of the AI not built yet, or a video with nothing in it
      if (facts.waiting) return [{ id: "buildThis", icon: "build", cost: COSTS.build }];
      if (passages === 0) return [{ id: "describe", icon: "build", fill: true, cost: COSTS.build }, { id: "findAdd", icon: "search", fill: true }];
      const offered: Suggestion[] = [];
      if (place.video.source === "clip") offered.push({ id: "cutClip", icon: "cut" });
      else if (number(facts.seconds) > LONG) offered.push({ id: "shorten", icon: "length", cost: COSTS.change });
      // What it lacks: a music, something to open on
      if (!facts.music) offered.push({ id: "music", icon: "music" });
      if (facts.opening === "none" && passages >= 2) offered.push({ id: "hook", icon: "opening" });
      if (place.video.source !== "clip") offered.push({ id: "findAdd", icon: "search", fill: true });
      if (facts.music && facts.opening !== "none") offered.push({ id: "restyle", icon: "look", fill: true });
      if (!facts.exported) offered.push({ id: "exportThis", icon: "export" });
      return offered;
    }
    case "export": {
      const waiting = number(facts.to_export);
      return [...(waiting > 0 ? [{ id: "exportAll", icon: "export" as const, params: { count: waiting } }] : []), { id: "leftToExport", icon: "export" }, { id: "ideasWaiting", icon: "ideas" }];
    }
    case "videos":
      return [{ id: "leftToExport", icon: "export" }, { id: "ideasWaiting", icon: "ideas" }, { id: "bestOfAll", icon: "best" }];
    case "analysis":
      return [{ id: "leftToExport", icon: "export" }, { id: "ideasWaiting", icon: "ideas" }];
    default: {
      // Home, the lives: the latest live first when it was never analysed
      const latest = typeof facts.last_live === "string" && facts.last_live && !facts.last_live_analysed ? facts.last_live : null;
      return [
        latest ? { id: "analyseNamed", icon: "analyse", params: { name: short(latest) }, cost: COSTS.analyse } : { id: "whatsNew", icon: "ideas" },
        { id: "leftToExport", icon: "export" },
        { id: "ideasWaiting", icon: "ideas" },
      ];
    }
  }
}

export function suggestionsFor(place: AssistantPlace | null, last?: AssistantMessage): Suggestion[] {
  const offered: Suggestion[] = [];
  for (const one of [...followUps(last, place), ...fromPlace(place)]) {
    if (!offered.some((other) => other.id === one.id)) offered.push(one);
  }
  return offered.slice(0, MAX_SUGGESTIONS);
}
