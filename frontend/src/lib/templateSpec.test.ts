import { describe, expect, it } from "vitest";
import { buildTemplate, NATIVE_LOOKS, type TemplateContext } from "./templates";
import { buildFromSpec, dragBox, specFromLayout, upgradeTemplate } from "./templateSpec";

const ctx: TemplateContext = {
  src: "/api/clips/job/clip.mp4",
  backgroundSrc: "/api/clips/job/clip.mp4/background",
  frameW: 1920,
  frameH: 1080,
  facecam: { x: 1518, y: 0, w: 402, h: 446 },
  words: [{ word: "brancard", start: 1, end: 1.4 }],
  startAt: 0,
  endAt: 60,
  colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" },
  subtitleStyle: "bold",
  widget: { enabled: true, timing: "start" },
  login: "falkarst",
  avatarUrl: "https://example.com/logo.png",
  hook: "Le pire sauvetage",
  displayName: "Falkarst",
  followers: 319,
  game: "Grand Theft Auto V",
};

const named = (layers: ReturnType<typeof buildTemplate>, name: string) => layers.find((l) => l.name === name)!.transform;

describe("element templates", () => {
  it("reads a layout's elements", () => {
    const spec = specFromLayout("signature");
    expect(spec.cam.box).toEqual({ x: 250, y: 150, w: 580, h: 640 });
    expect(spec.cam.frame).toMatchObject({ radius: 44, border: 6, borderColor: "white" });
    expect(spec.game.box).toEqual({ x: 40, y: 852, w: 1000, h: 660 });
    expect(spec.subtitles).toMatchObject({ font: "luckiest", size: 90, uppercase: true, highlight: "none" });
    expect(spec.widgets).toHaveLength(1);
    expect(spec.widgets[0]).toMatchObject({ kind: "channel-pill", box: { x: 190, y: 748, w: 700, h: 84 } });

    const discussion = specFromLayout("discussion");
    expect(discussion.cam.frame).toMatchObject({ radius: 165, border: 10, borderColor: "accent" });
    expect(discussion.subtitles.speakers).toBe(true);
    expect(specFromLayout("signature", { subtitleStyle: "karaoke" }).subtitles.highlight).toBe("highlight");
  });

  it("draws a layout the same way as the built-in template", () => {
    for (const id of ["signature", "plein", "reaction", "accroche"] as const) {
      const builtIn = buildTemplate(id, ctx);
      const fromSpec = buildFromSpec(specFromLayout(id), ctx);
      for (const name of ["Jeu", "Webcam", "Sous-titres"]) expect(named(fromSpec, name)).toEqual(named(builtIn, name));
    }
  });

  it("drops the webcam on clips without one and keeps the rest in place", () => {
    const spec = specFromLayout("signature");
    const layers = buildFromSpec(spec, { ...ctx, facecam: null });
    expect(layers.some((l) => l.type === "facecam")).toBe(false);
    expect(named(layers, "Jeu")).toEqual({ x: 40, y: 852, width: 1000, height: 660 });
  });

  it("styles subtitles, frames and backgrounds", () => {
    const spec = specFromLayout("signature");
    spec.subtitles = { ...spec.subtitles, font: "bangers", size: 110, color: "highlight", highlight: "accent", stroke: false };
    spec.cam.frame = { radius: 300, border: 12, borderColor: "accent", shadow: true };
    spec.cam.box = { x: 240, y: 150, w: 600, h: 600 };
    spec.background = { kind: "color", color: "#FF0000", dim: 0.4 };
    const layers = buildFromSpec(spec, ctx);
    const subs = layers.find((l) => l.type === "subtitles")!.subtitle!;
    expect(subs).toMatchObject({ fontFamily: "Bangers", fontSize: 110, customColor: "#F7C502", activeColor: "#42BF85", noStroke: true });
    const outline = layers.find((l) => l.name === "Webcam · contour")!;
    expect(outline.shape).toMatchObject({ shapeType: "circle", backgroundColor: "#42BF85", boxShadowPreset: "strong" });
    expect(layers[0].shape!.backgroundColor).toBe("#FF0000");
  });

  it("feeds the brand to widgets and times them", () => {
    const spec = specFromLayout("signature");
    spec.widgets = [
      { id: "w-1", kind: "socials", box: { x: 100, y: 1200, w: 500, h: 300 }, timing: "end", fields: { tiktok: "falk" } },
      { id: "w-2", kind: "logo", box: { x: 60, y: 60, w: 180, h: 180 }, timing: "start", fields: {} },
    ];
    const widgets = buildFromSpec(spec, { ...ctx, startAt: 10, endAt: 50 }).filter((l) => l.type === "widget");
    expect(widgets.map((w) => w.id)).toEqual(["tpl-widget-w-1", "tpl-widget-w-2"]);
    expect(widgets[0].widget!.props).toMatchObject({ login: "falkarst", followers: 319, tiktok: "falk", accent: "#42BF85", appearAt: 46.5 });
    // The logo pops in (overshoot) and fades out after ~3 s
    expect(widgets[1].animations!.map((a) => [a.type, a.easing])).toEqual([
      ["scaleIn", "back"],
      ["fadeOut", "easeIn"],
    ]);
  });

  it("times widgets to the tenth of a second, from the start or from the end", async () => {
    const { widgetWindow, timingOf, SHOW_PRESETS } = await import("./templateSpec");
    const w = { id: "w-1", kind: "handle" as const, box: { x: 0, y: 0, w: 100, h: 100 }, timing: "always" as const, fields: {} };
    // "All along": in at 1 s, out 1 s before the end
    expect(widgetWindow(w, 10, 50)).toEqual({ appearAt: 11, leaveAt: 49 });
    expect(widgetWindow({ ...w, show: { in: 2.5, inFrom: "start", out: 4, outFrom: "in" } }, 10, 50)).toEqual({ appearAt: 12.5, leaveAt: 16.5 });
    expect(widgetWindow({ ...w, show: { in: 5, inFrom: "end", out: null, outFrom: "end" } }, 10, 50)).toEqual({ appearAt: 45, leaveAt: null });
    // A short clip never shows it before it starts or after it ends
    expect(widgetWindow({ ...w, show: { in: 30, inFrom: "end", out: 1, outFrom: "end" } }, 0, 8)).toEqual({ appearAt: 0, leaveAt: 7 });
    expect(timingOf(SHOW_PRESETS.start)).toBe("start");
    expect(timingOf(SHOW_PRESETS.always)).toBe("always");
    expect(timingOf(SHOW_PRESETS.end)).toBe("end");
  });

  it("brings widgets in and out with the chosen animations", () => {
    const spec = specFromLayout("signature");
    spec.widgets = [
      { id: "w-1", kind: "logo", box: { x: 60, y: 170, w: 190, h: 190 }, timing: "always", show: { in: 1, inFrom: "start", out: 1, outFrom: "end" }, enter: "elastic", exit: "shrink", fields: {} },
      { id: "w-2", kind: "handle", box: { x: 140, y: 900, w: 700, h: 84 }, timing: "end", show: { in: 3, inFrom: "end", out: null, outFrom: "end" }, enter: "none", fields: {} },
    ];
    const [logo, handle] = buildFromSpec(spec, { ...ctx, startAt: 0, endAt: 30 }).filter((l) => l.type === "widget");
    expect(logo.animations!.map((a) => [a.type, a.easing, a.time])).toEqual([
      ["scaleIn", "elasticOut", 1],
      ["scaleOut", "easeIn.power3", 29],
    ]);
    expect(logo.widget!.props.appearAt).toBe(1);
    // No entrance: it cuts in at its time, not before
    expect(handle.animations!.map((a) => [a.type, a.time])).toEqual([["fadeIn", 27]]);
    expect(handle.animations![0].duration).toBeLessThan(0.05);
  });

  it("stacks elements in the chosen order, background always at the back", async () => {
    const { orderOf, restack } = await import("./templateSpec");
    const spec = specFromLayout("signature");
    const pill = `widget:${spec.widgets[0].id}`;
    expect(orderOf(spec)).toEqual(["game", "cam", "subtitles", "hook", pill]);
    // The game in front of the webcam, the pill behind everything
    spec.order = restack({ ...spec, order: restack(spec, "game", "front") }, pill, "back");
    expect(orderOf(spec)).toEqual([pill, "cam", "subtitles", "hook", "game"]);
    const names = buildFromSpec(spec, ctx).map((l) => l.name);
    expect(names.indexOf("Webcam")).toBeLessThan(names.indexOf("Jeu"));
    expect(names.indexOf("Widget channel-pill")).toBeLessThan(names.indexOf("Webcam"));
    expect(names.indexOf("Fond flouté")).toBe(0);
    // Unknown or missing keys are cleaned up, new widgets land on top
    expect(orderOf({ ...spec, order: ["nope", "cam", "cam"] })).toEqual(["cam", "game", "subtitles", "hook", pill]);
    expect(restack(spec, "cam", 0)[0]).toBe("cam");
  });

  it("upgrades templates saved by the first version of the editor", () => {
    const spec = upgradeTemplate({ id: "custom-abcd1234", name: "Cam ronde", base: "signature", look: { ...NATIVE_LOOKS.signature, camShape: "circle" } });
    expect(spec).toMatchObject({ version: 2, id: "custom-abcd1234", name: "Cam ronde", base: "signature" });
    expect(spec.cam.box.w).toBe(spec.cam.box.h);
  });
});

describe("dragging on the frame", () => {
  const box = { x: 100, y: 100, w: 400, h: 300 };

  it("moves, sticks to the center line and runs past the edges without leaving the frame", () => {
    const { box: moved, guides } = dragBox(box, "move", 236, 0, []);
    // Center 300 + 236 = 536: snaps to 540
    expect(moved.x + moved.w / 2).toBe(540);
    expect(guides).toContainEqual({ axis: "x", at: 540 });
    // Pushed far out: 60 px stay in the frame
    expect(dragBox(box, "move", -500, 5000, []).box).toEqual({ x: -340, y: 1860, w: 400, h: 300 });
    // Half out on the left
    expect(dragBox(box, "move", -300, 0, [], { snap: false }).box.x).toBe(-200);
  });

  it("sticks to the other elements' edges", () => {
    const other = { x: 600, y: 700, w: 200, h: 200 };
    const { box: moved } = dragBox(box, "move", 0, 296, [other]);
    expect(moved.y).toBe(400);
    const below = dragBox(box, "move", 0, 495, [other]).box;
    expect(below.y).toBe(600); // bottom edge 900 meets the other's bottom
  });

  it("resizes from a corner, keeping the shape when asked", () => {
    const free = dragBox(box, "se", 100, 37, []).box;
    expect(free).toEqual({ x: 100, y: 100, w: 500, h: 337 });
    const kept = dragBox(box, "se", 100, 10, [], { keepRatio: true }).box;
    expect(kept.w / kept.h).toBeCloseTo(400 / 300, 2);
    expect(dragBox(box, "nw", 1000, 1000, []).box.w).toBe(40);
  });

  it("grows past the frame, e.g. a zoomed-in game", () => {
    const game = { x: 0, y: 0, w: 1080, h: 1920 };
    const big = dragBox(game, "se", 400, 300, [], { snap: false }).box;
    expect(big).toEqual({ x: 0, y: 0, w: 1480, h: 2220 });
    const left = dragBox(game, "w", -250, 0, [], { snap: false }).box;
    expect(left.x).toBe(-250);
  });
});

describe("what the apps cover", () => {
  it("flags elements under the description, the buttons or the tabs", async () => {
    const { coveredBy } = await import("./templateSpec");
    expect(coveredBy({ x: 140, y: 1640, w: 800, h: 96 })).toEqual(["bottom"]);
    expect(coveredBy({ x: 900, y: 900, w: 160, h: 200 })).toEqual(["right"]);
    expect(coveredBy({ x: 60, y: 60, w: 300, h: 100 })).toEqual(["top"]);
    expect(coveredBy({ x: 240, y: 300, w: 600, h: 600 })).toEqual([]);
  });

  it("drops every kit widget in the visible part of the frame", async () => {
    const { coveredBy } = await import("./templateSpec");
    const { KIT_WIDGETS } = await import("../components/editor/widgets/kit");
    for (const w of KIT_WIDGETS) expect(coveredBy(w.box), w.id).toEqual([]);
  });

  it("drops a new widget on a free spot near its usual one", async () => {
    const { placeWidget } = await import("./templateSpec");
    const spec = specFromLayout("signature");
    // Its usual spot is under the subtitles: it moves up, above them, clear of the webcam
    const socials = placeWidget(spec, { x: 250, y: 1140, w: 500, h: 320 }, "end");
    expect(socials.y + socials.h).toBeLessThanOrEqual(spec.subtitles.box.y);
    expect(socials.y).toBeGreaterThanOrEqual(spec.cam.box.y + spec.cam.box.h);
    // A free spot stays as is
    expect(placeWidget(spec, { x: 60, y: 170, w: 190, h: 190 }, "start")).toEqual({ x: 60, y: 170, w: 190, h: 190 });
    // Two widgets on screen together don't stack; one at the start and one at the end can share a spot
    spec.widgets.push({ id: "w-a", kind: "handle", box: { x: 140, y: 900, w: 700, h: 84 }, timing: "start", fields: {} });
    const handle = placeWidget(spec, { x: 140, y: 900, w: 700, h: 84 }, "start");
    expect(handle.y).not.toBe(900);
    expect(placeWidget(spec, { x: 140, y: 900, w: 700, h: 84 }, "end").y).toBe(900);
    // No free spot left: where it hides the least, not on the subtitles
    spec.widgets.push({ id: "w-b", kind: "socials", box: { x: 250, y: 910, w: 500, h: 320 }, timing: "end", fields: {} });
    const crowded = placeWidget(spec, { x: 250, y: 1300, w: 500, h: 160 }, "end");
    const subs = spec.subtitles.box;
    expect(crowded.y + crowded.h <= subs.y || crowded.y >= subs.y + subs.h).toBe(true);
  });

  it("shows the hook line where it hides neither the webcam nor the subtitles", async () => {
    const { placeWidget } = await import("./templateSpec");
    const spec = specFromLayout("signature");
    const hook = placeWidget(spec, spec.hook.box, "always");
    // Too wide next to the buttons: narrowed to the safe column, under the webcam and its pill, above the subtitles
    expect(hook).toMatchObject({ x: 150, w: 780 });
    expect(hook.y).toBeGreaterThanOrEqual(spec.widgets[0].box.y + spec.widgets[0].box.h);
    expect(hook.y + hook.h).toBeLessThanOrEqual(spec.subtitles.box.y);
    // Where the layout leaves room at the top, it stays there
    const sanscam = specFromLayout("sanscam");
    const hidden = { ...sanscam, hook: { ...sanscam.hook, visible: false } };
    expect(placeWidget(hidden, sanscam.hook.box, "always")).toEqual({ x: 40, y: 150, w: 1000, h: 230 });
  });

  it("keeps the text, webcam and brand of every layout in the visible part", async () => {
    const { coveredBy } = await import("./templateSpec");
    const { TEMPLATE_IDS } = await import("./templates");
    for (const id of TEMPLATE_IDS) {
      for (const facecam of [ctx.facecam, null]) {
        // The game may run under the apps' interface, the rest may not
        const layers = buildTemplate(id, { ...ctx, facecam }).filter((l) => l.type !== "gameplay" && !l.locked && l.name !== "Assombrir");
        for (const l of layers) {
          const t = l.transform;
          expect(coveredBy({ x: t.x, y: t.y, w: t.width, h: t.height }), `${id} ${facecam ? "cam" : "no cam"} ${l.name}`).toEqual([]);
        }
      }
    }
  });
});
