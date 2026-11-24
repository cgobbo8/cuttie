import { useSyncExternalStore } from "react";
import { LiveError, chooseSound, ensurePieces, getLiveSearchProgress, planLiveVideo, saveCompilation, type Compilation, type LiveFailure, type LiveSearchStep } from "./api";
import { PLAIN_CUT, allItems, applySound, applyTight, fitToTarget, sectionsFromPlan, setVideoTransition, soundBrief, withHook } from "./compilation";
import { isTransition } from "./transitions";
import { sourceOf } from "./videoSources";

/**
 * An idea of the AI kept from the live's page is built behind the streamer's back: they stay
 * where they are and go on sorting while the AI plans the video, its passages are cut from the
 * live and set on their words, and its music and opening are chosen. What the montage does when
 * a video is described in it, without the montage being on screen. One video at a time; the
 * others wait their turn. It lives outside the pages: going to another one does not stop it.
 */

export interface Build {
  job: string;
  id: string;
  name: string;
  /** Waiting its turn, being planned by the AI, its passages being cut, done, or failed */
  state: "waiting" | "planning" | "cutting" | "done" | "failed";
  /** What the AI is doing right now, while it plans */
  step: LiveSearchStep | null;
  /** Why it failed (the live can't be read, no credits…), or "empty": nothing in the live matched */
  why?: LiveFailure | "empty";
  /** The video once built */
  video?: Compilation;
}

export interface BuildWith {
  /** How long the live is, seconds */
  duration: number;
  language: string;
  /** The tracks whose file is on this machine (another one can't be played) */
  tracks: string[];
}

/** Clips cut from the live at once */
const CUT_BATCH = 4;
/** How far over the length asked a video may run before passages are taken out of it (as in the montage) */
const PLAN_OVER = 1.1;
const PROGRESS_EVERY = 1200;

let builds: Build[] = [];
const listeners = new Set<() => void>();
const ended = new Set<(build: Build) => void>();
const queue: { build: Build; video: Compilation; using: BuildWith }[] = [];
let running = false;

const keyOf = (build: Pick<Build, "job" | "id">) => `${build.job}/${build.id}`;
function set(build: Build, patch: Partial<Build>) {
  builds = builds.map((one) => (keyOf(one) === keyOf(build) ? { ...one, ...patch } : one));
  listeners.forEach((listener) => listener());
}
const now = (build: Build) => builds.find((one) => keyOf(one) === keyOf(build)) ?? build;

async function run(build: Build, video: Compilation, using: BuildWith): Promise<void> {
  const target = video.target ?? 45;
  const brief = (video.brief ?? "").trim() || video.name;
  let stopped = false;
  const timer = window.setInterval(async () => {
    const step = await getLiveSearchProgress(build.job).catch(() => null);
    if (!stopped && step) set(build, { step });
  }, PROGRESS_EVERY);
  try {
    set(build, { state: "planning" });
    const plan = await planLiveVideo(build.job, brief, target, undefined, video.lives ?? [], video.suggestion?.moments ?? [], false, sourceOf(video));
    stopped = true;
    const sections = sectionsFromPlan(plan, using.duration);
    if (sections.length === 0) return set(build, { state: "failed", why: "empty", step: null });
    // The video as the AI planned it (it keeps the name it was proposed under)
    let built = await saveCompilation(build.job, withHook({ ...video, sections, target, titles: sections.length > 1 || video.titles, hook: video.hook.trim() || (plan.hook ?? "").trim().slice(0, 120), brief, answer: plan.note ?? "", asks: [] }));
    set(build, { state: "cutting", step: null, video: built });

    // Each passage gets its clip, and goes where its words are really said (the transcript's times were rough)
    const tight: Record<string, [number, number] | null> = {};
    const items = allItems(built);
    for (const live of new Set(items.map((item) => item.job ?? build.job))) {
      const theirs = items.filter((item) => (item.job ?? build.job) === live);
      for (let i = 0; i < theirs.length; i += CUT_BATCH) {
        const asked = theirs.slice(i, i + CUT_BATCH).map(({ id, start, end, fit }) => (fit ? { id, start: Math.min(start, fit[0]), end: Math.max(end, fit[1]), fit } : { id, start, end }));
        const done = await ensurePieces(live, asked);
        for (const piece of done.pieces) if (piece.tight !== undefined) tight[piece.id] = piece.tight ?? null;
      }
    }
    // ...then the video is brought to the length asked for: the weakest passages go, none is shortened
    built = fitToTarget(applyTight(built, tight), target * PLAN_OVER, true);

    // Its music, its opening and its transition, chosen from what kind of video it is (it does without when this fails)
    try {
      const { ids, ...said } = soundBrief(built);
      const choice = await chooseSound(build.job, { ...said, asked: brief, language: using.language, compilation: built.id, universe: built.universe ?? null });
      const dressed = applySound(built, { music: choice.music && using.tracks.includes(choice.music) ? choice.music : null, intro: choice.intro, look: choice.look, opening: choice.teaser ? ids[choice.teaser - 1] : null });
      built = choice.transition && (choice.transition === PLAIN_CUT || isTransition(choice.transition)) ? setVideoTransition(dressed, choice.transition) : dressed;
    } catch {
      // (as planned, undressed)
    }
    built = await saveCompilation(build.job, withHook(built));
    set(build, { state: "done", step: null, video: built });
  } catch (err) {
    set(build, { state: "failed", why: err instanceof LiveError ? err.reason : "failed", step: null });
  } finally {
    stopped = true;
    window.clearInterval(timer);
    ended.forEach((listener) => listener(now(build)));
  }
}

async function next(): Promise<void> {
  if (running) return;
  const one = queue.shift();
  if (!one) return;
  running = true;
  try {
    await run(one.build, one.video, one.using);
  } finally {
    running = false;
    next();
  }
}

/** Has an idea built behind the page (once: asked again while it is being built, nothing more happens) */
export function startBuild(job: string, video: Compilation, using: BuildWith): void {
  const known = builds.find((one) => one.job === job && one.id === video.id);
  if (known && known.state !== "failed" && known.state !== "done") return;
  const build: Build = { job, id: video.id, name: video.name, state: "waiting", step: null };
  builds = [...builds.filter((one) => keyOf(one) !== keyOf(build)), build];
  listeners.forEach((listener) => listener());
  queue.push({ build, video, using });
  next();
}

/** Forgets a build that ended (its video is on screen, or its failure was said) */
export function dropBuild(job: string, id: string): void {
  builds = builds.filter((one) => !(one.job === job && one.id === id && (one.state === "done" || one.state === "failed")));
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every build under way or just ended */
export function useBuilds(): Build[] {
  return useSyncExternalStore(
    subscribe,
    () => builds,
    () => builds,
  );
}

/** Still at work on this video */
export const building = (list: Build[], job: string, id: string): Build | undefined => list.find((one) => one.job === job && one.id === id && one.state !== "done" && one.state !== "failed");

/** Called each time a build ends, well or not */
export function onBuildEnd(listener: (build: Build) => void): () => void {
  ended.add(listener);
  return () => {
    ended.delete(listener);
  };
}

/** For tests: nothing built, nothing waiting */
export function resetBuilds(): void {
  builds = [];
  queue.length = 0;
  running = false;
}
