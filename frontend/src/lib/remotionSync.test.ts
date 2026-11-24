import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INTRO_IDS, INTRO_SOUND_IDS, introSpan, JINGLE_IDS } from "./intro/intros";
import { MUSIC_KINDS } from "./music/mix";
import { TRANSITION_IDS } from "./transitions";
import { UNIVERSES } from "./universes";
import { CHAT_CHOICES, HOOK_STYLES } from "./templateSpec";
import { EFFECT_LEVELS } from "./effects";

/** The server renderer must draw exactly what the editor shows (scripts/sync-remotion.mjs) */
const root = path.resolve(__dirname, "../../..");
const kit = (side: string) => path.join(root, side === "front" ? "frontend/src/components/editor/widgets/kit" : "api/remotion/widgets/kit");

describe("editor and server renderer stay in sync", () => {
  it("has the same widget kit on both sides", () => {
    const files = readdirSync(kit("front")).filter((f) => f !== "WidgetImg.tsx");
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const server = path.join(kit("api"), file);
      expect(existsSync(server), `${file} missing on the server: run node scripts/sync-remotion.mjs`).toBe(true);
      expect(readFileSync(server, "utf-8"), `${file} differs: run node scripts/sync-remotion.mjs`).toBe(readFileSync(path.join(kit("front"), file), "utf-8"));
    }
  });

  it("plays the same transitions on both sides", () => {
    const server = path.join(root, "api/remotion/transitions.ts");
    expect(existsSync(server), "transitions.ts missing on the server: run node scripts/sync-remotion.mjs").toBe(true);
    expect(readFileSync(server, "utf-8"), "transitions.ts differs: run node scripts/sync-remotion.mjs").toBe(readFileSync(path.join(root, "frontend/src/lib/transitions.ts"), "utf-8"));
  });

  it("lets the server store the transitions it can draw, and no other", () => {
    const service = readFileSync(path.join(root, "api/app/services/compilations.ts"), "utf-8");
    const stored = service.match(/export const TRANSITIONS = \[([^\]]+)\]/)?.[1].match(/[a-z]+/g);
    expect(stored).toEqual([...TRANSITION_IDS]);
  });

  it("draws the same intros on both sides, and ships their sounds to both", () => {
    const front = path.join(root, "frontend/src/lib/intro");
    const files = readdirSync(front).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
    expect(files.sort()).toEqual(["IntroCard.tsx", "intros.ts"]);
    for (const file of files) {
      const server = path.join(root, "api/remotion/intro", file);
      expect(existsSync(server), `${file} missing on the server: run node scripts/sync-remotion.mjs`).toBe(true);
      expect(readFileSync(server, "utf-8"), `${file} differs: run node scripts/sync-remotion.mjs`).toBe(readFileSync(path.join(front, file), "utf-8"));
    }
    for (const id of INTRO_SOUND_IDS) {
      // Played by the page, mixed into the export by the server
      for (const side of ["frontend/public/sounds", "api/public/sounds"]) expect(existsSync(path.join(root, side, `intro-${id}.mp3`)), `${side}/intro-${id}.mp3`).toBe(true);
    }
  });

  it("knows the same universes on both sides: their layout, their graphics, their games", () => {
    const service = readFileSync(path.join(root, "api/app/services/compilations.ts"), "utf8");
    for (const universe of UNIVERSES) {
      const said = service.match(new RegExp(`${universe.id}: \\{ template: '(\\w+)', look: '(\\w+)', intros: \\[([^\\]]+)\\], titles: \\[([^\\]]+)\\]`));
      expect(said?.[1], universe.id).toBe(universe.template);
      expect(said?.[2], universe.id).toBe(universe.look);
      expect(said?.[3].match(/\w+/g), universe.id).toEqual([...universe.intros]);
      expect(said?.[4].match(/\w+/g), universe.id).toEqual([...universe.titles]);
    }
  });

  it("moves a piece's picture with the same maths in the preview and in the export, at the same levels", () => {
    const read = (file: string) => readFileSync(path.join(root, file), "utf8");
    expect(read("api/remotion/effects.ts")).toBe(read("frontend/src/lib/effects.ts"));
    expect(read("api/app/services/compilations.ts").match(/export const EFFECT_LEVELS = \[([^\]]+)\]/)?.[1].match(/\w+/g)).toEqual(EFFECT_LEVELS);
    // (the export's composition applies them as the preview's does)
    for (const file of ["api/remotion/MontageComposition.tsx", "frontend/src/components/remotion-editor/MontageComposition.tsx"]) expect(read(file), file).toContain("effectAt(segment.effects, frame, fps)");
    // (each picture moves inside its own box, at its own place in the stack, on both sides: moved as one box, a
    // piece went under what a layout draws between its layers and came out black; moved whole, it left its frame)
    for (const file of ["api/remotion/MontageComposition.tsx", "frontend/src/components/remotion-editor/MontageComposition.tsx"]) {
      expect(read(file), file).toContain('{ position: "absolute", inset: 0, zIndex: z + 1, clipPath: clip }');
      expect(read(file), file).toContain("const on = !!moved && isPicture(layer);");
      expect(read(file), file).toContain("moved={moved?.transform}");
    }
  });

  it("knows the same ways of writing a title on both sides", () => {
    const service = readFileSync(path.join(root, "api/app/services/compilations.ts"), "utf8");
    const kit = readFileSync(path.join(root, "api/app/services/brand_kit.ts"), "utf8");
    expect(service.match(/export const TITLE_STYLES = \[([^\]]+)\]/)?.[1].match(/\w+/g)).toEqual(HOOK_STYLES);
    expect(service.match(/export const CHAT_CHOICES = \[([^\]]+)\]/)?.[1].match(/\w+/g)).toEqual(CHAT_CHOICES);
    // (and a template of the streamer's can be saved with each of them)
    for (const style of HOOK_STYLES) expect(kit, style).toContain(`'${style}'`);
  });

  it("makes a jingle follow a music the same way on both sides", () => {
    // How many beats, and how much faster or slower than written: the app's numbers are the server's
    const numbers = (file: string) => readFileSync(path.join(root, file), "utf8").match(/export const BEATS = (\{[^}]+\})/)?.[1];
    expect(numbers("frontend/src/lib/intro/intros.ts")).toBeTruthy();
    expect(numbers("api/app/services/compilations.ts")).toBe(numbers("frontend/src/lib/intro/intros.ts"));
  });

  it("lets the server store the intros it can draw, with the lengths the video counts", () => {
    const service = readFileSync(path.join(root, "api/app/services/compilations.ts"), "utf-8");
    const stored = [...(service.match(/export const INTROS[^=]*= \{([^}]+)\}/)?.[1] ?? "").matchAll(/(\w+): \[(\d+), (\d+)\]/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
    expect(stored).toEqual(INTRO_IDS.map((id) => [id, introSpan(id, 30).hold, introSpan(id, 30).out]));
    const sounds = service.match(/export const INTRO_SOUNDS = \[([^\]]+)\]/)?.[1].match(/[a-z0-9]+/g);
    expect(sounds).toEqual([...INTRO_SOUND_IDS]);
  });

  it("tells the AI about the twelve graphics there are (those of a jingle, which also frame a hook), and no other", () => {
    const worker = readFileSync(path.join(root, "backend/app/services/looks.py"), "utf-8");
    const described = [...(worker.match(/^INTROS = \{([\s\S]*?)^\}/m)?.[1] ?? "").matchAll(/^\s+"(\w+)": /gm)].map((m) => m[1]);
    expect(described).toEqual([...JINGLE_IDS]);
  });

  it("tells the AI about every transition there is, and the plain cut", () => {
    const worker = readFileSync(path.join(root, "backend/app/services/looks.py"), "utf-8");
    const described = [...(worker.match(/^TRANSITIONS = \{([\s\S]*?)^\}/m)?.[1] ?? "").matchAll(/^\s+"(\w+)": /gm)].map((m) => m[1]);
    expect(described).toEqual(["cut", ...TRANSITION_IDS]);
  });

  it("mixes the music with the curve the preview plays, and reads the same catalogue", () => {
    const same = (front: string, server: string) => {
      expect(existsSync(path.join(root, server)), `${server} missing: run node scripts/sync-remotion.mjs`).toBe(true);
      expect(readFileSync(path.join(root, server), "utf-8"), `${server} differs: run node scripts/sync-remotion.mjs`).toBe(readFileSync(path.join(root, front), "utf-8"));
    };
    same("frontend/src/lib/music/curve.ts", "api/remotion/music/curve.ts");
    same("frontend/src/lib/music/catalogue.json", "api/public/musics/catalogue.json");
    const service = readFileSync(path.join(root, "api/app/services/musics.ts"), "utf-8");
    expect(service.match(/export const MUSIC_KINDS = \[([^\]]+)\]/)?.[1].match(/[a-z]+/g)).toEqual([...MUSIC_KINDS]);
  });

  it("ships every clip font to the server", () => {
    const fonts = readFileSync(path.join(root, "api/remotion/fonts.ts"), "utf-8");
    for (const file of fonts.match(/[\w-]+\.woff2/g) ?? []) {
      expect(existsSync(path.join(root, "api/public/fonts", file)), file).toBe(true);
    }
  });
});
