import { describe, expect, it } from "vitest";
import type { Compilation } from "./api";
import { applyLook, lookOf } from "./assistantLook";

const item = (id: string, start: number) => ({ id, start, end: start + 4, text: "", max_start: start, max_end: start + 4 });
const video = (more: Partial<Compilation> = {}): Compilation =>
  ({
    id: "vvvvvvvvvv",
    name: "La mission du yacht",
    sections: [{ id: "s1", title: "Le plan", query: "", items: [item("a", 100), item("b", 200)] }],
    template: null,
    titles: true,
    hook: "",
    target: 60,
    created_at: "",
    updated_at: "",
    ...more,
  }) as Compilation;

const choices = {
  templates: [
    { key: "tpl_mine", name: "Mon modèle" },
    { key: "empile", name: "Empilé" },
    { key: "gta", name: "GTA" },
  ],
  musics: [
    { id: "drift", name: "Drift Phonk" },
    { id: "u1", name: "Money for Nothing" },
  ],
  jingle: "news",
};

describe("what the assistant changes in a video's look", () => {
  it("sets a music by its name, however it is written, and how loud it is", () => {
    const done = applyLook(video(), { music: "drift phonk", presence: "forte" }, choices);
    expect(done.video.music).toEqual({ track: "drift", volume: 1.6 });
    expect(done.set).toEqual({ music: "Drift Phonk", presence: "high" });
    expect(done.unknown).toEqual({});
    // A few words of its name do; another track keeps the level that was set
    const other = applyLook(done.video, { music: "money" }, choices);
    expect(other.video.music).toEqual({ track: "u1", volume: 1.6 });
    // Back to normal: the level is no longer written
    expect(applyLook(other.video, { presence: "normal" }, choices).video.music).toEqual({ track: "u1" });
    expect(applyLook(other.video, { music: "none" }, choices).video.music).toBeUndefined();
  });

  it("says what there is when it asks for something the app has not", () => {
    const done = applyLook(video(), { music: "Thunderstruck", transition: "wobble", effects: "huge", title_style: "comic", template: "Cinéma 4K", universe: "minecraft", opening: "trailer", intro: "boom", presence: "high" }, choices);
    expect(done.video).toEqual(video());
    expect(done.set).toEqual({});
    expect(done.unknown.music).toContain("Drift Phonk; Money for Nothing");
    expect(done.unknown.transition).toContain("flash");
    expect(done.unknown.effects).toContain("light");
    expect(done.unknown.title_style).toContain("viceplate");
    expect(done.unknown.template).toContain("Empilé");
    expect(done.unknown.universe).toContain("gta");
    expect(done.unknown.opening).toContain("hook");
    expect(done.unknown.intro).toContain("slam");
    expect(done.unknown.presence).toBe("this video plays no music");
  });

  it("sets the layout, the titles, the effects and the transition, and takes each back", () => {
    const done = applyLook(video(), { template: "empilé", title_style: "box", effects: "strong", transition: "slide" }, choices);
    expect(done.video).toMatchObject({ template: "empile", titleStyle: "box", effects: "strong", transition: "slide" });
    expect(done.set).toEqual({ template: "Empilé", title_style: "box", effects: "strong", transition: "slide" });
    const back = applyLook(done.video, { template: "default", title_style: "template", effects: "none", transition: "cut" }, choices);
    expect(back.video).toEqual(video());
    expect(back.set).toEqual({ template: "default", title_style: "template", effects: "none", transition: "cut" });
  });

  it("opens the video on a jingle, on a hook, or on nothing", () => {
    // An intro: the one the streamer prefers unless one is named
    expect(applyLook(video(), { opening: "intro" }, choices).video.intro).toEqual({ style: "news" });
    expect(applyLook(video(), { opening: "intro", intro: "glitch" }, choices).video.intro).toEqual({ style: "glitch" });
    // Naming a jingle is enough; what the streamer had set on it stays, and it is no longer « chosen by the AI »
    const titled = video({ intro: { style: "news", title: "Le yacht", follow: false, by: "ai" } });
    expect(applyLook(titled, { intro: "rush" }, choices).video.intro).toEqual({ style: "rush", title: "Le yacht", follow: false });
    // A hook framed by the jingle it takes the place of, or by the one named
    expect(applyLook(titled, { opening: "hook" }, choices).video.intro).toEqual({ style: "hook", look: "fuse", title: "Le yacht", follow: false });
    const hook = applyLook(titled, { opening: "hook", intro: "neon" }, choices);
    expect(hook.video.intro).toMatchObject({ style: "hook", look: "neon" });
    expect(hook.set).toEqual({ opening: "hook", intro: "neon" });
    // On a hook, a jingle named changes what frames it; back to a jingle, that one is kept
    expect(applyLook(hook.video, { intro: "arcade" }, choices).video.intro).toMatchObject({ style: "hook", look: "arcade" });
    expect(applyLook(hook.video, { opening: "intro" }, choices).video.intro).toEqual({ style: "neon", title: "Le yacht", follow: false });
    // Nothing
    expect(applyLook(hook.video, { opening: "none" }, choices).video.intro).toBeUndefined();
    expect(applyLook(hook.video, { intro: "aucune" }, choices).video.intro).toBeUndefined();
  });

  it("dresses the video in a game's look and gives it back to the channel", () => {
    const dressed = applyLook(video(), { universe: "GTA" }, choices);
    expect(dressed.video).toMatchObject({ universe: "gta", template: "gta", titleStyle: "viceplate", intro: { style: "hook", look: "sunset" } });
    expect(dressed.set).toEqual({ universe: "gta" });
    // In that look, an intro asked for without a name is the look's own
    expect(applyLook({ ...dressed.video, intro: undefined } as Compilation, { opening: "intro" }, { ...choices, jingle: null }).video.intro).toEqual({ style: "sunset" });
    const back = applyLook(dressed.video, { universe: "channel" }, choices);
    expect(back.video.universe).toBeUndefined();
    expect(back.video.template).toBeNull();
    expect(back.set).toEqual({ universe: "channel" });
  });

  it("understands the names the app shows, in the streamer's language", () => {
    const named = {
      ...choices,
      musics: [{ id: "drift", name: "Drift Phonk", about: "phonk · skill" }, { id: "lofi", name: "Chill Lo-Fi", about: "lofi · posé" }],
      names: { transitions: { slide: "Glissé", pop: "Rebond" }, intros: { slam: "Impact", news: "Flash info" }, effects: { light: "Légers", strong: "Marqués" }, titles: { box: "Bandeau" } },
    };
    const done = applyLook(video(), { transition: "glisse", effects: "Marqués", title_style: "bandeau", opening: "intro", intro: "flash info" }, named);
    expect(done.video).toMatchObject({ transition: "slide", effects: "strong", titleStyle: "box", intro: { style: "news" } });
    expect(done.unknown).toEqual({});
    // What it can't place is said back with both the id and the name on screen, and each track with what it is
    const lost = applyLook(video(), { transition: "fondu enchaîné", music: "une musique plus posée" }, named);
    expect(lost.unknown.transition).toContain("slide (Glissé)");
    expect(lost.unknown.music).toContain("Chill Lo-Fi (lofi · posé)");
    expect(lost.unknown.music).toContain("choose one of these");
  });

  it("tells the assistant how the video looks now", () => {
    const dressed = video({ universe: "gta", template: "gta", titleStyle: "viceplate", effects: "light", intro: { style: "hook", look: "sunset" }, music: { track: "u1" } });
    expect(lookOf(dressed, choices)).toEqual({ universe: "gta", template: "GTA", title_style: "viceplate", effects: "light", chat: "template", transition: "cut", opening: "hook", intro: "sunset", music: "Money for Nothing" });
    expect(lookOf(video(), choices)).toEqual({ universe: "channel", template: "default", title_style: "template", effects: "none", chat: "template", transition: "cut", opening: "none", intro: null, music: "none" });
  });

  it("shows the chat on every passage, on none, or as each layout does", () => {
    const shown = applyLook(video(), { chat: "on" }, choices);
    expect(shown.video.chat).toBe("on");
    expect(shown.set).toEqual({ chat: "on" });
    expect(applyLook(shown.video, { chat: "off" }, choices).video.chat).toBe("off");
    // Back to what each layout does
    const back = applyLook(shown.video, { chat: "template" }, choices);
    expect("chat" in back.video).toBe(false);
    expect(back.set).toEqual({ chat: "template" });
    // Something it has no such thing for is said, and nothing changes
    const odd = applyLook(shown.video, { chat: "sometimes" }, choices);
    expect(odd.video.chat).toBe("on");
    expect(odd.unknown.chat).toContain("template");
  });
});
