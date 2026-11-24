import type { Compilation } from "./api";
import { EFFECT_LEVELS, isEffectLevel } from "./effects";
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
  /** The tracks that can play (those whose file is on this machine), each with what it is in a few words (genre, kinds of video) */
  musics: { id: string; name: string; about?: string }[];
  /** The jingle the streamer prefers (their channel's), when they have one */
  jingle?: string | null;
  /**
   * What the app calls each thing on screen, by id (« Glissé » for slide, « Impact » for slam,
   * « Marqués » for strong): the assistant speaks the streamer's language and names them so
   */
  names?: { transitions?: Record<string, string>; intros?: Record<string, string>; effects?: Record<string, string>; titles?: Record<string, string> };
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

/** The id meant: said as it is, or by the name the app shows for it */
function idOf<T extends string>(said: string, ids: readonly T[], names: Record<string, string> = {}): T | null {
  const asked = plain(said);
  return ids.find((id) => id === asked) ?? ids.find((id) => names[id] && plain(names[id]) === asked) ?? null;
}
/** What was set, as the app shows it (the assistant then says « Glissé », not « slide ») */
const shownAs = (id: string, names: Record<string, string> = {}) => names[id] ?? id;
/** What there is, each with the name the app shows: « slide (Glissé) » */
const listed = (ids: readonly string[], names: Record<string, string> = {}) => ids.map((id) => (names[id] && plain(names[id]) !== id ? `${id} (${names[id]})` : id)).join(", ");

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
    } else {
      const style = idOf(said!, HOOK_STYLES, choices.names?.titles);
      if (style && isHookStyle(style)) {
        next = { ...next, titleStyle: style };
        set.title_style = shownAs(style, choices.names?.titles);
      } else unknown.title_style = `no such way of writing titles: there is template, ${listed(HOOK_STYLES, choices.names?.titles)}`;
    }
  }

  if (has("chat")) {
    // The Twitch chat written on the video: on every passage, on none, or as each layout does
    const said = (look.chat ?? "").trim().toLowerCase();
    const { chat: _before, ...rest } = next;
    if (said === "on" || said === "off") {
      next = { ...rest, chat: said };
      set.chat = said;
    } else if (none(look.chat) || said === "template" || said === "auto") {
      next = rest;
      set.chat = "template";
    } else unknown.chat = "chat is one of: template (as each layout does), on, off";
  }

  if (has("effects")) {
    const said = look.effects;
    const { effects: _before, ...rest } = next;
    if (none(said)) {
      next = rest;
      set.effects = "none";
    } else {
      const level = idOf(said!, EFFECT_LEVELS, choices.names?.effects);
      if (level && isEffectLevel(level)) {
        next = { ...rest, effects: level };
        set.effects = shownAs(level, choices.names?.effects);
      } else unknown.effects = `effects is one of: none, ${listed(EFFECT_LEVELS, choices.names?.effects)}`;
    }
  }

  if (has("transition")) {
    const said = look.transition;
    const { transition: _before, ...rest } = next;
    if (none(said) || plain(said!) === "cut") {
      next = rest;
      set.transition = "cut";
    } else {
      const transition = idOf(said!, TRANSITION_IDS, choices.names?.transitions);
      if (transition && isTransition(transition)) {
        next = { ...rest, transition };
        set.transition = shownAs(transition, choices.names?.transitions);
      } else unknown.transition = `no such transition: there is cut, ${listed(TRANSITION_IDS, choices.names?.transitions)}`;
    }
  }

  // What the video opens on: nothing, a jingle, or one of its own moments played first (a hook), framed by a jingle's graphics
  if (has("opening") || has("intro")) {
    const graphic = has("intro") && !none(look.intro) ? idOf(look.intro!, JINGLE_IDS, choices.names?.intros) : null;
    if (has("intro") && !none(look.intro) && !graphic) unknown.intro = `no such intro: there is ${listed(JINGLE_IDS, choices.names?.intros)}`;
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
      set.intro = shownAs(frame, choices.names?.intros);
    } else if (opening === "intro") {
      const { hook: _moment, look: _look, ...jingle } = kept;
      const style = picked ?? (before && isJingle(before.style) ? before.style : isJingle(before?.look) ? before.look : isJingle(choices.jingle) ? choices.jingle : (universeOf(next.universe)?.look ?? JINGLE_IDS[0]));
      next = { ...rest, intro: { ...jingle, style } };
      set.opening = "intro";
      set.intro = shownAs(style, choices.names?.intros);
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
      } else unknown.music = choices.musics.length > 0 ? `no track is called that: choose one of these by its name. ${choices.musics.map((one) => (one.about ? `${one.name} (${one.about})` : one.name)).join("; ")}` : "no music on this machine";
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
    chat: video.chat ?? "template",
    transition: video.transition ?? "cut",
    opening: !video.intro ? "none" : video.intro.style === "hook" ? "hook" : "intro",
    intro: video.intro ? (video.intro.style === "hook" ? (video.intro.look ?? DEFAULT_HOOK_LOOK) : video.intro.style) : null,
    music: video.music ? (choices.musics.find((one) => one.id === video.music!.track)?.name ?? video.music.track) : "none",
  };
}
