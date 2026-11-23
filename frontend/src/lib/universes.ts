/**
 * A universe: the look of a game, which a video from a live on that game can take instead of the
 * channel's own (its colours, the font of its titles). It names what belongs to it among what the
 * app has (a layout, intros, fonts, musics); the rest can still be chosen, it just comes after.
 *
 * Only one for now: GTA. A video made from a live on that game is dressed in it when it is created
 * (the server does it: api/app/services/compilations.ts knows the same games), and the streamer
 * can go back to their channel's look in a click.
 */
import type { Compilation } from "./api";
import { DEFAULT_HOOK_LOOK, GTA_JINGLES, introPack, isJingle, type IntroPackId, type JingleId } from "./intro/intros";
import type { MusicTrack } from "./music/mix";
import type { TemplateId } from "./templates";
import type { HookStyle } from "./templateSpec";

export interface Universe {
  id: string;
  /** The intros' pack it goes with */
  pack: IntroPackId;
  /** Its layout */
  template: TemplateId;
  /** What frames the hook of a video dressed in it, and the jingle it takes when it has one of another pack */
  look: JingleId;
  intros: readonly JingleId[];
  /** Its ways of writing a title */
  titles: readonly HookStyle[];
  /** A live on its game, as Twitch names it */
  plays: (game: string | null | undefined) => boolean;
  /** A music that goes with it, by what it is called (a theme of the game, a track of its soundtrack) or one that ships with the app */
  sounds: (track: Pick<MusicTrack, "id" | "name">) => boolean;
}

const GTA_WORDS = /grand theft auto|\bgta\b|vice city|san andreas|liberty city|los santos|leonida/i;

export const UNIVERSES: Universe[] = [
  {
    id: "gta",
    pack: "gta",
    template: "gta",
    look: "sunset",
    intros: GTA_JINGLES,
    titles: ["viceplate", "vice"],
    plays: (game) => /grand theft auto|^\s*gta\b/i.test(game ?? ""),
    // (the synthwave track that ships has the sound of an evening in Vice City)
    sounds: (track) => track.id === "synthwave" || GTA_WORDS.test(track.name),
  },
];

export const universeOf = (id: string | null | undefined): Universe | undefined => UNIVERSES.find((universe) => universe.id === id);
/** The universe of a live's game (undefined: none of the app's) */
export const universeFor = (game: string | null | undefined): Universe | undefined => UNIVERSES.find((universe) => universe.plays(game));

/** The tracks that go with a universe first, the others after, each group in its own order */
export function universeTracks<T extends Pick<MusicTrack, "id" | "name">>(tracks: T[], universe: Universe | undefined): { own: T[]; others: T[] } {
  if (!universe) return { own: [], others: tracks };
  return { own: tracks.filter((track) => universe.sounds(track)), others: tracks.filter((track) => !universe.sounds(track)) };
}

/**
 * A video dressed in a universe (null: back to the channel's own look). Its layout becomes the
 * universe's; what it opens on takes the universe's graphics: a jingle of another pack becomes
 * the universe's, a hook is framed by it, and a video with no opening and several passages opens
 * on its hook (its content plays from the first frame, in the universe's frame: what the
 * most-viewed short videos do). Going back: the channel's default layout, and graphics of the
 * universe give way to the app's own. Its titles are written the universe's way, whatever the
 * layout of each passage (going back: as each template writes them, unless the streamer chose a
 * way that isn't the universe's). Everything else the streamer set stays.
 */
export function dressAs<T extends Pick<Compilation, "template" | "intro" | "sections" | "universe" | "titleStyle">>(c: T, universe: Universe | null): T {
  const { universe: before, intro, titleStyle, ...kept } = c;
  const was = universeOf(before);
  // (a way of writing the streamer chose stays, unless it belongs to the look the video leaves)
  const own = titleStyle && !(was?.titles as readonly string[] | undefined)?.includes(titleStyle) ? titleStyle : undefined;
  const rest = { ...kept, ...(own && !universe ? { titleStyle: own } : {}) };
  if (!universe) {
    const mine = (graphic: unknown) => !was || introPack(graphic) !== was.pack;
    const back =
      !intro || (intro.style === "hook" ? mine(intro.look) : mine(intro.style))
        ? intro
        : intro.style === "hook"
          ? (({ look: _look, ...hook }) => hook)(intro)
          : undefined;
    return { ...rest, template: was && c.template === was.template ? null : c.template, ...(back ? { intro: back } : {}) } as unknown as T;
  }
  const passages = c.sections.reduce((count, section) => count + section.items.length, 0);
  const framed = (graphic: unknown): JingleId => (isJingle(graphic) && introPack(graphic) === universe.pack ? graphic : universe.look);
  const opening = !intro
    ? passages >= 2
      ? { style: "hook", look: universe.look }
      : undefined
    : intro.style === "hook"
      ? { ...intro, look: framed(intro.look ?? DEFAULT_HOOK_LOOK) }
      : introPack(intro.style) === universe.pack
        ? intro
        : (({ sound: _sound, ...jingle }) => ({ ...jingle, style: universe.look }))(intro);
  const titles = (universe.titles as readonly string[]).includes(titleStyle ?? "") ? titleStyle : universe.titles[0];
  return { ...rest, universe: universe.id, template: universe.template, titleStyle: titles, ...(opening ? { intro: opening } : {}) } as unknown as T;
}
