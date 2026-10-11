import { describe, expect, it } from "vitest";
import type { TemplateContext } from "./templates";
import { buildFromSpec, dragBox } from "./templateSpec";
import { buildTemplate, builtInSpec, specFromLayout, upgradeTemplate } from "./builtinTemplates";

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
    expect(spec.cam.box).toEqual({ x: 230, y: 210, w: 620, h: 560 });
    expect(spec.cam.frame).toMatchObject({ radius: 48, border: 6, borderColor: "accent", shadow: true });
    expect(spec.game.box).toEqual({ x: 40, y: 830, w: 1000, h: 563 });
    expect(spec.subtitles).toMatchObject({ font: "montserrat", size: 64, uppercase: true, highlight: "none", pop: true, words: 3 });
    expect(spec.hook).toMatchObject({ visible: true, style: "brand", until: 3.5 });
    expect(spec.widgets).toHaveLength(1);
    expect(spec.widgets[0]).toMatchObject({ kind: "channel-pill", box: { x: 240, y: 740, w: 600, h: 60 }, enter: "pop" });

    // Webcam on top, full width; the pill centered over it like the rest, a follow button comes at the end
    const stacked = specFromLayout("empile");
    expect(stacked.cam.box).toEqual({ x: 0, y: 0, w: 1080, h: 740 });
    expect(stacked.subtitles).toMatchObject({ font: "anton", uppercase: true, words: 3 });
    expect(stacked.widgets.map((w) => [w.kind, w.timing])).toEqual([
      ["channel-pill", "start"],
      ["follow-button", "end"],
    ]);
    expect(stacked.widgets[0].box.x + stacked.widgets[0].box.w / 2).toBe(540);
    expect(stacked.widgets[0].fields).toEqual({});
    // ...unless the channel's widget already comes at the end
    expect(specFromLayout("empile", { widgetTiming: "end" }).widgets.map((w) => w.kind)).toEqual(["channel-pill"]);

    const discussion = specFromLayout("discussion");
    expect(discussion.subtitles).toMatchObject({ speakers: true, uppercase: false, highlight: "none" });
    expect(specFromLayout("signature", { subtitleStyle: "karaoke" }).subtitles.highlight).toBe("highlight");
    expect(specFromLayout("signature", { subtitleStyle: "minimal" }).subtitles).toMatchObject({ font: "geist", boxed: true, pop: false });
  });

  it("hands the pill its alignment: a name tag stays against its edge", () => {
    // Discussion RP without a cam: the pill is a name tag on the scene
    const spec = builtInSpec("discussion", { hasCam: false });
    expect(spec.widgets[0].fields).toEqual({ align: "left" });
    const pill = buildFromSpec(spec, ctx).find((l) => l.widget?.widgetId === "channel-pill")!;
    expect(pill.widget!.props.align).toBe("left");
  });

  it("draws a layout the same way as the built-in template", async () => {
    const { TEMPLATE_IDS } = await import("./templates");
    const shape = (layers: ReturnType<typeof buildTemplate>) => layers.map((l) => [l.name, l.transform]);
    for (const id of TEMPLATE_IDS) expect(shape(buildFromSpec(specFromLayout(id), ctx)), id).toEqual(shape(buildTemplate(id, ctx)));
  });

  it("shows the Twitch chat in Discussion RP, as bubbles, and keeps it hidden elsewhere", () => {
    const chat = [
      { author: "Chiione_", text: "MOI !", timestamp: 9.6 },
      { author: "Flaytee_", text: "la chance", timestamp: 14.7 },
    ];
    const talk = buildTemplate("discussion", { ...ctx, chat }).find((l) => l.type === "chat")!;
    expect(talk.chat).toMatchObject({ messages: chat, maxVisible: 2, style: "bubbles", fontFamily: "Geist Variable" });
    expect(talk.transform).toEqual({ x: 60, y: 1245, width: 760, height: 190 });
    expect(buildTemplate("empile", { ...ctx, chat }).some((l) => l.type === "chat")).toBe(false);
    // Turned on in another layout: drawn with the rest, between the webcam and the subtitles
    const spec = specFromLayout("signature");
    spec.chat = { ...spec.chat!, visible: true };
    const names = buildFromSpec(spec, { ...ctx, chat }).map((l) => l.name);
    expect(names.indexOf("Chat")).toBeGreaterThan(names.indexOf("Webcam"));
    expect(names.indexOf("Chat")).toBeLessThan(names.indexOf("Sous-titres"));
    // Templates saved before the chat existed have none
    delete spec.chat;
    expect(buildFromSpec(spec, { ...ctx, chat }).some((l) => l.type === "chat")).toBe(false);
  });

  it("films the whole stream picture in Cinéma, and puts the game card over the face cam in Réaction", () => {
    const cinema = buildTemplate("accroche", ctx);
    const game = cinema.find((l) => l.name === "Jeu")!;
    // Webcam included: the crop is the whole 1920x1080 picture (to a pixel or two), no webcam of its own
    expect(game.video!.crop).toMatchObject({ y: 0, h: 1080 });
    expect(game.video!.crop!.w).toBeGreaterThanOrEqual(1916);
    expect(cinema.some((l) => l.type === "facecam")).toBe(false);
    expect(cinema[0].shape!.backgroundColor).toBe("#000000");
    // The title stays the whole clip
    expect(cinema.find((l) => l.name === "Accroche")!.animations).toBeUndefined();
    const names = buildTemplate("reaction", ctx).map((l) => l.name);
    expect(names.indexOf("Jeu")).toBeGreaterThan(names.indexOf("Webcam"));
  });

  it("drops the webcam on clips without one and keeps the rest in place", () => {
    const spec = specFromLayout("signature");
    const layers = buildFromSpec(spec, { ...ctx, facecam: null });
    expect(layers.some((l) => l.type === "facecam")).toBe(false);
    expect(named(layers, "Jeu")).toEqual({ x: 40, y: 830, width: 1000, height: 563 });
  });

  it("rearranges the built-in layouts on clips without webcam", () => {
    // Stacked layouts fall back on "Sans cam", with their own lettering
    const stacked = buildTemplate("empile", { ...ctx, facecam: null });
    expect(stacked.some((l) => l.type === "facecam")).toBe(false);
    expect(named(stacked, "Jeu")).toEqual({ x: 0, y: 240, width: 1080, height: 1350 });
    expect(stacked.find((l) => l.type === "subtitles")!.subtitle!.fontFamily).toBe("Anton");
    // Signature moves its game card up
    expect(named(buildTemplate("signature", { ...ctx, facecam: null }), "Jeu").y).toBeLessThan(830);
  });

  it("shows the hook line from the first frame, then fades it out", () => {
    const hookOf = (layers: ReturnType<typeof buildTemplate>) => layers.find((l) => l.name === "Accroche")!;
    const clip = { ...ctx, startAt: 10, endAt: 50 };
    // A cover: on screen at the first frame, gone 3.5 s later
    const hook = hookOf(buildTemplate("plein", clip));
    expect(hook.animations).toEqual([expect.objectContaining({ type: "fadeOut", time: 13.5 })]);
    expect(hook.text).toMatchObject({ uppercase: true, stroke: true, fontFamily: '"Anton", system-ui, sans-serif' });
    // On a white box: dark sentence-case text, no outline
    expect(hookOf(buildTemplate("empile", clip)).text).toMatchObject({ color: "#0C0C0E", uppercase: false });
    expect(hookOf(buildTemplate("empile", clip)).text!.stroke).toBeUndefined();
    // "Sans cam" keeps it for half the clip; on a box, in the channel color with readable text
    expect(hookOf(buildTemplate("sanscam", clip)).animations![0].time).toBe(30);
    const brand = buildTemplate("signature", { ...clip, colors: { ...ctx.colors, accent: "#FFE14D" } });
    expect(brand.find((l) => l.name === "Fond de l'accroche")!.shape!.backgroundColor).toBe("#FFE14D");
    expect(hookOf(brand).text!.color).toBe("#0C0C0E");
    // Kept the whole clip
    const spec = specFromLayout("signature");
    spec.hook.until = null;
    expect(hookOf(buildFromSpec(spec, clip)).animations).toBeUndefined();
  });

  it("shows a few words at a time, the spoken one popping", () => {
    const subs = buildTemplate("reaction", ctx).find((l) => l.type === "subtitles")!.subtitle!;
    expect(subs).toMatchObject({ maxWords: 2, pop: true });
    // Older templates: 4 words, no pop
    const spec = specFromLayout("signature");
    delete spec.subtitles.words;
    delete spec.subtitles.pop;
    const old = buildFromSpec(spec, ctx).find((l) => l.type === "subtitles")!.subtitle!;
    expect(old.maxWords).toBeUndefined();
    expect(old.pop).toBeUndefined();
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
    expect(orderOf(spec)).toEqual(["game", "cam", "chat", "subtitles", "hook", pill]);
    // The game in front of the webcam, the pill behind everything
    spec.order = restack({ ...spec, order: restack(spec, "game", "front") }, pill, "back");
    expect(orderOf(spec)).toEqual([pill, "cam", "chat", "subtitles", "hook", "game"]);
    const names = buildFromSpec(spec, ctx).map((l) => l.name);
    expect(names.indexOf("Webcam")).toBeLessThan(names.indexOf("Jeu"));
    expect(names.indexOf("Widget channel-pill")).toBeLessThan(names.indexOf("Webcam"));
    expect(names.indexOf("Fond flouté")).toBe(0);
    // Unknown or missing keys are cleaned up, new widgets land on top
    expect(orderOf({ ...spec, order: ["nope", "cam", "cam"] })).toEqual(["cam", "game", "chat", "subtitles", "hook", pill]);
    expect(restack(spec, "cam", 0)[0]).toBe("cam");
  });

  it("upgrades templates saved by the first version of the editor", () => {
    const look = { camSize: "m", camShape: "circle", camBorder: "white", background: "blur", subtitlePosition: "auto", subtitleSize: "m", widgetPosition: "auto", hook: "on" } as const;
    const spec = upgradeTemplate({ id: "custom-abcd1234", name: "Cam ronde", base: "signature", look });
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

  it("keeps the shape from an edge handle, growing around the middle", () => {
    // Shift + bottom handle: taller and wider on both sides, the top stays
    const down = dragBox(box, "s", 0, 60, [], { keepRatio: true, snap: false }).box;
    expect(down).toEqual({ x: 60, y: 100, w: 480, h: 360 });
    expect(down.x + down.w / 2).toBe(box.x + box.w / 2);
    // Shift + right handle: wider and taller on both sides, the left stays
    const right = dragBox(box, "e", 80, 0, [], { keepRatio: true, snap: false }).box;
    expect(right).toEqual({ x: 100, y: 70, w: 480, h: 360 });
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
    const signature = specFromLayout("signature");
    const spec = { ...signature, hook: { ...signature.hook, visible: false } };
    // Its usual spot is under the subtitles: it moves up, above them, clear of the webcam
    const socials = placeWidget(spec, { x: 250, y: 1140, w: 500, h: 320 }, "end");
    expect(socials.y + socials.h).toBeLessThanOrEqual(spec.subtitles.box.y);
    expect(socials.y).toBeGreaterThanOrEqual(spec.cam.box.y + spec.cam.box.h);
    // A free spot stays as is
    expect(placeWidget(spec, { x: 60, y: 1000, w: 160, h: 160 }, "start")).toEqual({ x: 60, y: 1000, w: 160, h: 160 });
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
    const signature = specFromLayout("signature");
    const spec = { ...signature, hook: { ...signature.hook, visible: false } };
    const hook = placeWidget(spec, { x: 40, y: 860, w: 1000, h: 140 }, "always");
    // Too wide next to the buttons: narrowed to the safe column, under the webcam and its pill, above the subtitles
    expect(hook).toMatchObject({ x: 150, w: 780 });
    expect(hook.y).toBeGreaterThanOrEqual(spec.widgets[0].box.y + spec.widgets[0].box.h);
    expect(hook.y + hook.h).toBeLessThanOrEqual(spec.subtitles.box.y);
    // Where the layout leaves room at the top, it stays there
    const sanscam = specFromLayout("sanscam");
    const hidden = { ...sanscam, hook: { ...sanscam.hook, visible: false } };
    expect(placeWidget(hidden, sanscam.hook.box, "always")).toEqual({ x: 100, y: 280, w: 880, h: 160 });
  });

  it("keeps the text, webcam and brand of every layout in the visible part", async () => {
    const { coveredBy } = await import("./templateSpec");
    const { TEMPLATE_IDS } = await import("./templates");
    for (const id of TEMPLATE_IDS) {
      for (const facecam of [ctx.facecam, null]) {
        // The game (and its seam) may run under the apps' interface, the rest may not
        const layers = buildTemplate(id, { ...ctx, facecam }).filter((l) => !l.name.startsWith("Jeu") && !l.locked && l.name !== "Assombrir");
        for (const l of layers) {
          const t = l.transform;
          const zones = coveredBy({ x: t.x, y: t.y, w: t.width, h: t.height });
          // A webcam filling the top of the frame runs under the tabs: the face sits lower
          const fullWidthCam = l.type === "facecam" && t.y === 0 && t.width === 1080;
          expect(fullWidthCam ? zones.filter((z) => z !== "top") : zones, `${id} ${facecam ? "cam" : "no cam"} ${l.name}`).toEqual([]);
        }
      }
    }
  });
});
