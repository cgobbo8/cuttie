import type { Compilation } from "./api";
import { isEffectLevel } from "./effects";
import { DEFAULT_HOOK_LOOK, JINGLE_IDS, isJingle } from "./intro/intros";
import { MUSIC_VOLUMES } from "./music/mix";
import { HOOK_STYLES, isHookStyle } from "./templateSpec";
import { TRANSITION_IDS, isTransition } from "./transitions";
import { UNIVERSES, dressAs, universeOf } from "./universes";

/**
 * What the assistant asks to change in how a video looks or sounds (« mets une musique qui
 * tabasse », « enlève l'intro »), set on the video as the look panel would. It names things
 * in its own words: a track or a layout by its name, the rest by the app's ids. What it asks
 * for that the app has no such thing for is said back with what there is, so it can ask again.
 */

export interface LookChoices {
  /** The layouts a video can take: the streamer's own, then the app's */
  templates: { key: string; name: string }[];
  /** The tracks that can play (those whose file is on this machine) */
  musics: { id: string; name: string }[];
  /** The jingle the streamer prefers (their channel's), when they have one */
  jingle?: string | null;
}

export interface LookChange {
  video: Compilation;
  /** What was set, by what the assistant named */
  set: Record<string, string>;
  /** What could not be: why, and what there is */
  unknown: Record<string, string>;
}

const plain = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
/** Nothing, in the assistant's words */
const none = (value: string | null | undefined) => value == null || ["", "none", "no", "off", "aucun", "aucune", "sans", "ninguno", "ninguna"].includes(plain(value));
const usual = (value: string) => ["default", "channel", "model", "template", "auto", "defaut", "chaine", "modele"].includes(plain(value));

/** The one named: by its id, its exact name, then a name that holds what was said */
function named<T>(list: T[], said: string, id: (one: T) => string, name: (one: T) => string): T | undefined {
  const asked = plain(said);
  return list.find((one) => plain(id(one)) === asked) ?? list.find((one) => plain(name(one)) === asked) ?? list.find((one) => plain(name(one)).includes(asked) || asked.includes(plain(name(one))));
}

export function applyLook(video: Compilation, look: Record<string, string | null | undefined>, choices: LookChoices): LookChange {
  let next = video;
  const set: Record<string, string> = {};
  const unknown: Record<string, string> = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(look, key);

  if (has("universe")) {
    const said = look.universe;
    if (none(said) || usual(said!)) {
      next = dressAs(next, null);
      set.universe = "channel";
    } else {
      const universe = universeOf(plain(said!)) ?? UNIVERSES.find((one) => plain(said!).includes(one.id));
      if (universe) {
        next = dressAs(next, universe);
        set.universe = universe.id;
      } else unknown.universe = `no such look: there is channel, ${UNIVERSES.map((one) => one.id).join(", ")}`;
    }
  }

  if (has("template")) {
    const said = look.template;
    if (none(said) || usual(said!)) {
      next = { ...next, template: null };
      set.template = "default";
    } else {
      const template = named(choices.templates, said!, (one) => one.key, (one) => one.name);
      if (template) {
        next = { ...next, template: template.key };
        set.template = template.name;
      } else unknown.template = `no such layout: there is ${choices.templates.map((one) => one.name).join(", ")}`;
    }
  }

  if (has("title_style")) {
    const said = look.title_style;
    if (none(said) || usual(said!)) {
      const { titleStyle: _before, ...rest } = next;
      next = rest;
      set.title_style = "template";
    } else if (isHookStyle(plain(said!))) {
      next = { ...next, titleStyle: plain(said!) };
      set.title_style = plain(said!);
    } else unknown.title_style = `no such way of writing titles: there is template, ${HOOK_STYLES.join(", ")}`;
  }

  if (has("effects")) {
    const said = look.effects;
    const { effects: _before, ...rest } = next;
    if (none(said)) {
      next = rest;
      set.effects = "none";
    } else if (isEffectLevel(plain(said!))) {
      next = { ...rest, effects: plain(said!) };
      set.effects = plain(said!);
    } else unknown.effects = "effects is one of: none, light, strong";
  }

  if (has("transition")) {
    const said = look.transition;
    const { transition: _before, ...rest } = next;
    if (none(said) || plain(said!) === "cut") {
      next = rest;
      set.transition = "cut";
    } else if (isTransition(plain(said!))) {
      next = { ...rest, transition: plain(said!) };
      set.transition = plain(said!);
    } else unknown.transition = `no such transition: there is cut, ${TRANSITION_IDS.join(", ")}`;
  }

  // What the video opens on: nothing, a jingle, or one of its own moments played first (a hook), framed by a jingle's graphics
  if (has("opening") || has("intro")) {
    const graphic = has("intro") && !none(look.intro) ? plain(look.intro!) : null;
    if (graphic && !isJingle(graphic)) unknown.intro = `no such intro: there is ${JINGLE_IDS.join(", ")}`;
    const picked = graphic && isJingle(graphic) ? graphic : null;
    const before = next.intro;
    // (the streamer asked: no longer one the AI chose by itself)
    const { by: _by, ...kept } = before ?? { style: "" };
    const opening = has("opening") ? (none(look.opening) ? "none" : plain(look.opening!)) : has("intro") && none(look.intro) ? "none" : before?.style === "hook" ? "hook" : "intro";
    const { intro: _intro, ...rest } = next;
    if (opening === "none") {
      next = rest;
      set.opening = "none";
    } else if (opening === "hook") {
      const { sound: _sound, ...hook } = kept;
      const frame = picked ?? (isJingle(before?.look) ? before.look : (universeOf(next.universe)?.look ?? DEFAULT_HOOK_LOOK));
      next = { ...rest, intro: { ...hook, style: "hook", look: frame } };
      set.opening = "hook";
      set.intro = frame;
    } else if (opening === "intro") {
      const { hook: _moment, look: _look, ...jingle } = kept;
      const style = picked ?? (before && isJingle(before.style) ? before.style : isJingle(before?.look) ? before.look : isJingle(choices.jingle) ? choices.jingle : (universeOf(next.universe)?.look ?? JINGLE_IDS[0]));
      next = { ...rest, intro: { ...jingle, style } };
      set.opening = "intro";
      set.intro = style;
    } else unknown.opening = "opening is one of: none, intro, hook";
  }

  if (has("music")) {
    const said = look.music;
    const { music: before, ...rest } = next;
    if (none(said)) {
      next = rest;
      set.music = "none";
    } else {
      const track = named(choices.musics, said!, (one) => one.id, (one) => one.name);
      if (track) {
        next = { ...rest, music: { ...(before?.volume ? { volume: before.volume } : {}), track: track.id } };
        set.music = track.name;
      } else unknown.music = choices.musics.length > 0 ? `no such track: there is ${choices.musics.map((one) => one.name).join(", ")}` : "no music on this machine";
    }
  }

  if (has("presence") && !none(look.presence)) {
    const said = plain(look.presence!);
    const level = (["low", "discreet", "discrete", "quiet", "discret"].includes(said) ? "low" : ["high", "strong", "loud", "fort", "forte"].includes(said) ? "high" : said === "normal" ? "normal" : null) as keyof typeof MUSIC_VOLUMES | null;
    if (!level) unknown.presence = "presence is one of: low, normal, high";
    else if (!next.music) unknown.presence = "this video plays no music";
    else {
      const { volume: _before, ...track } = next.music;
      next = { ...next, music: MUSIC_VOLUMES[level] === 1 ? track : { ...track, volume: MUSIC_VOLUMES[level] } };
      set.presence = level;
    }
  }

  return { video: next, set, unknown };
}

/** A video's look as the assistant is told about it once it changed */
export function lookOf(video: Compilation, choices: LookChoices): Record<string, string | boolean | null> {
  return {
    universe: video.universe ?? "channel",
    template: choices.templates.find((one) => one.key === video.template)?.name ?? "default",
    title_style: video.titleStyle ?? "template",
    effects: video.effects ?? "none",
    transition: video.transition ?? "cut",
    opening: !video.intro ? "none" : video.intro.style === "hook" ? "hook" : "intro",
    intro: video.intro ? (video.intro.style === "hook" ? (video.intro.look ?? DEFAULT_HOOK_LOOK) : video.intro.style) : null,
    music: video.music ? (choices.musics.find((one) => one.id === video.music!.track)?.name ?? video.music.track) : "none",
  };
}
