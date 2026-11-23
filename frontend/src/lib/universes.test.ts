import { describe, expect, it } from "vitest";
import type { Compilation } from "./api";
import { dressAs, universeFor, universeOf, universeTracks, UNIVERSES } from "./universes";
import { INTRO_PACKS } from "./intro/intros";
import { TEMPLATE_IDS } from "./templates";
import { HOOK_STYLES } from "./templateSpec";

const gta = universeOf("gta")!;
const passage = (id: string) => ({ id, start: 0, end: 5, text: "", why: "", sources: [] });
type Video = Pick<Compilation, "template" | "intro" | "sections" | "universe" | "titleStyle">;
const video = (items: number, more: Partial<Video> = {}): Video => ({ template: null, sections: [{ id: "s", title: "", query: "", items: Array.from({ length: items }, (_, i) => passage(`p${i}`)) }], ...more });

describe("the look of a game a video can be dressed in", () => {
  it("is made of things the app has", () => {
    for (const universe of UNIVERSES) {
      expect(TEMPLATE_IDS).toContain(universe.template);
      const pack = INTRO_PACKS.find((one) => one.id === universe.pack)!;
      expect(pack.jingles).toEqual(universe.intros);
      expect(universe.intros).toContain(universe.look);
      expect(universe.titles.length).toBeGreaterThan(0);
      for (const style of universe.titles) expect(HOOK_STYLES).toContain(style);
    }
  });

  it("knows the lives of its game, as Twitch names them", () => {
    expect(["Grand Theft Auto VI", "Grand Theft Auto V", "GTA 6", "gta: San Andreas"].map((game) => universeFor(game)?.id)).toEqual(["gta", "gta", "gta", "gta"]);
    expect(["Just Chatting", "Valorant", "Gtaoui", "", null, undefined].map((game) => universeFor(game))).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it("puts the musics that go with it first: a theme of the game by its name, and the track that sounds like it", () => {
    const tracks = [{ id: "phonk", name: "Drift Phonk" }, { id: "own-1", name: "Gta Vice City Theme" }, { id: "synthwave", name: "Arcade Retro Nights" }, { id: "own-2", name: "Travis Scott - BURN (Grand Theft Auto VI)" }, { id: "own-3", name: "Flower In A Hurricane" }];
    const { own, others } = universeTracks(tracks, gta);
    expect(own.map((track) => track.id)).toEqual(["own-1", "synthwave", "own-2"]);
    expect(others.map((track) => track.id)).toEqual(["phonk", "own-3"]);
    // No universe: nothing is set apart
    expect(universeTracks(tracks, undefined)).toEqual({ own: [], others: tracks });
  });

  it("dresses a video: its layout, and its look round what the video opens on", () => {
    // A video of several passages with no opening: it opens on its hook, framed by the universe (its content plays from the first frame)
    expect(dressAs(video(3), gta)).toMatchObject({ universe: "gta", template: "gta", intro: { style: "hook", look: "sunset" } });
    // One passage, nothing to tease: no opening
    expect(dressAs(video(1), gta)).not.toHaveProperty("intro");
    // A jingle of the app's own becomes the universe's (its title and its follow button stay, its sound is the new one's)
    expect(dressAs(video(3, { intro: { style: "slam", title: "Le titre", sound: "boom", follow: false } }), gta).intro).toEqual({ style: "sunset", title: "Le titre", follow: false });
    // A hook keeps its moment and is framed by the universe; graphics already of the universe stay
    expect(dressAs(video(3, { intro: { style: "hook", look: "neon", hook: { item: "p1", start: 1, end: 4 } } }), gta).intro).toEqual({ style: "hook", look: "sunset", hook: { item: "p1", start: 1, end: 4 } });
    expect(dressAs(video(3, { intro: { style: "hook", look: "wanted" } }), gta).intro).toEqual({ style: "hook", look: "wanted" });
    expect(dressAs(video(3, { intro: { style: "miami", title: "Le titre" } }), gta).intro).toEqual({ style: "miami", title: "Le titre" });
  });

  it("writes the titles of a dressed video its way, whatever the layout of each passage", () => {
    // Nothing chosen, or a way of the channel's: the universe's first; one of the universe's own stays
    expect(dressAs(video(3), gta).titleStyle).toBe("viceplate");
    expect(dressAs(video(3, { titleStyle: "brand" }), gta).titleStyle).toBe("viceplate");
    expect(dressAs(video(3, { titleStyle: "vice" }), gta).titleStyle).toBe("vice");
    // Back to the channel: as each template writes them again
    expect(dressAs(dressAs(video(3), gta), null)).not.toHaveProperty("titleStyle");
    // (a way the streamer chose that isn't the universe's stays, in a video that was dressed or not)
    expect(dressAs({ ...dressAs(video(3), gta), titleStyle: "box" }, null).titleStyle).toBe("box");
    expect(dressAs(video(3, { titleStyle: "viceplate" }), null).titleStyle).toBe("viceplate");
  });

  it("goes back to the channel's look: its default layout, the app's own graphics", () => {
    const dressed = dressAs(video(3), gta);
    const back = dressAs(dressed, null);
    expect(back).not.toHaveProperty("universe");
    expect(back.template).toBeNull();
    // The hook stays, framed by the app's default
    expect(back.intro).toEqual({ style: "hook" });
    // A jingle of the universe goes; a layout or an intro the streamer chose apart from it stay
    expect(dressAs({ ...video(3, { intro: { style: "cover" } }), universe: "gta", template: "gta" }, null)).not.toHaveProperty("intro");
    expect(dressAs({ ...video(3, { intro: { style: "slam" } }), universe: "gta", template: "plein" }, null)).toMatchObject({ template: "plein", intro: { style: "slam" } });
    // A video that was never dressed is left as it is
    expect(dressAs(video(2, { intro: { style: "neon" } }), null)).toMatchObject({ template: null, intro: { style: "neon" } });
  });
});
