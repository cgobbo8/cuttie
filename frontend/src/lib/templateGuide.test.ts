import { describe, expect, it } from "vitest";
import { specFromLayout } from "./builtinTemplates";
import { BUILTIN_USES, describeSpec, placeOf, templateGuides, usageOf } from "./templateGuide";
import { TEMPLATE_IDS } from "./templates";

const names = { nameOf: (id: string) => `Nom ${id}` };

describe("what a template is, in words", () => {
  it("says where a box sits on the frame", () => {
    expect(placeOf({ x: 0, y: 0, w: 1080, h: 1920 })).toBe("fills the whole frame");
    expect(placeOf({ x: 0, y: 0, w: 1080, h: 740 })).toBe("at the top, across the full width (y 0 to 740, 100 % of the width, 39 % of the height)");
    expect(placeOf({ x: 60, y: 1090, w: 300, h: 300 })).toBe("in the lower part, on the left (y 1090 to 1390, 28 % of the width, 16 % of the height)");
    // What runs past the frame is not seen: only the part on screen counts
    expect(placeOf({ x: -12, y: 746, w: 1104, h: 1186 })).toBe("in the lower part, across the full width (y 746 to 1920, 100 % of the width, 61 % of the height)");
    expect(placeOf({ x: 700, y: 900, w: 300, h: 120 })).toContain("in the middle, on the right");
  });

  it("describes the stacked layout as it is built", () => {
    const text = describeSpec(specFromLayout("empile", { subtitleStyle: "karaoke" }));
    expect(text).toContain("Webcam: the streamer's face, above the game, at the top, across the full width (y 0 to 740");
    expect(text).toContain("Picture: the game (the stream picture, cropped around its center to fill its box), in the lower part, across the full width (y 746 to 1920");
    expect(text).toContain("Captions (what is said, word by word): on the seam between the webcam and the game");
    expect(text).toContain("3 words at a time, the spoken word in the channel's highlight color, the spoken word pops bigger");
    expect(text).toContain("Hook line (the video's title, on the first frame): in the middle, centered");
    expect(text).toContain("dark text on a white box");
    expect(text).toContain("on screen for the first 3.5 s");
    // The channel pill and the follow button, with when they come and go
    expect(text).toContain("channel pill (the channel's logo and name) at the top, centered");
    expect(text).toContain("pops in 0.3 s after the start, shrinks away 3.3 s later");
    expect(text).toContain("a follow button that a cursor clicks");
    expect(text).toContain("3 s before the end, stays to the end");
    expect(text).toContain("Stacking, bottom to top: game, webcam, chat, captions, hook, pop-up.");
  });

  it("tells the layouts apart", () => {
    const of = (id: (typeof TEMPLATE_IDS)[number]) => describeSpec(specFromLayout(id));
    expect(of("plein")).toContain("Picture: the game (the stream picture, cropped around its center to fill its box), fills the whole frame.");
    expect(of("plein")).toContain("Webcam: the streamer's face, laid over the game, in the lower part, on the left");
    expect(of("plein")).toContain("round, an outline of 8 px in the channel's main color, a shadow");
    expect(of("accroche")).toContain("the whole 16:9 stream picture, webcam included, not cropped");
    expect(of("accroche")).toContain("Webcam: not shown on its own (it is in the stream picture).");
    expect(of("accroche")).toContain("on screen for the whole video");
    expect(of("sanscam")).toContain("Webcam: not shown.");
    expect(of("sanscam")).toContain("on screen for the first half");
    expect(of("discussion")).toContain("one color per speaker");
    expect(of("discussion")).toContain("Twitch chat: message bubbles");
    expect(of("signature")).toContain("Background (behind everything): the clip itself, blurred and darkened.");
    expect(of("reaction")).toContain("a card with rounded corners");
    // Seven layouts, seven different descriptions
    expect(new Set(TEMPLATE_IDS.map(of)).size).toBe(7);
  });

  it("follows what the streamer changed in a template of their own", () => {
    const spec = specFromLayout("empile", { id: "custom-abc", name: "Le mien" });
    spec.hook.visible = false;
    spec.widgets = [{ id: "w-bar", kind: "progress-bar", box: { x: 0, y: 1900, w: 1080, h: 20 }, timing: "always", fields: {} }];
    spec.cam.box = { x: 40, y: 220, w: 400, h: 400 };
    spec.cam.frame = { radius: 200, border: 6, borderColor: "white", shadow: false };
    const text = describeSpec(spec);
    expect(text).toContain("Hook line: none.");
    expect(text).toContain("a progress bar of the video at the bottom, across the full width");
    expect(text).toContain("from the first frame, stays to the end");
    expect(text).toContain("in the upper part, on the left");
    expect(text).toContain("round, an outline of 6 px in white");
    // What it is good for: written for it, else what its starting layout is for
    expect(usageOf(spec)).toContain(BUILTIN_USES.empile);
    expect(usageOf({ ...spec, usage: " Pour mes fails. " })).toBe("Pour mes fails.");
  });

  it("lists every template for the AI, the streamer's own first", () => {
    const own = specFromLayout("plein", { id: "custom-abc", name: "Mes fails" });
    own.usage = "Pour mes fails en voiture.";
    const guides = templateGuides([own], { ...names, subtitleStyle: "bold", widget: { enabled: false, timing: "start" } });
    expect(guides.map((g) => g.key)).toEqual(["custom-abc", ...TEMPLATE_IDS]);
    expect(guides[0]).toMatchObject({ name: "Mes fails", needs_cam: false });
    expect(guides[0].description.endsWith("Good for: Pour mes fails en voiture.")).toBe(true);
    const stacked = guides.find((g) => g.key === "empile")!;
    expect(stacked.name).toBe("Nom empile");
    expect(stacked.needs_cam).toBe(true);
    expect(stacked.description).toContain("When nobody is in the webcam: cannot be used");
    expect(stacked.description).toContain(`Good for: ${BUILTIN_USES.empile}`);
    // The channel turned its widgets off: no pop-up is promised
    expect(stacked.description).toContain("Pop-ups: none.");
    expect(guides.find((g) => g.key === "plein")!.description).toContain("When nobody is in the webcam: the same without the webcam.");
    expect(guides.find((g) => g.key === "sanscam")!.needs_cam).toBe(false);
    // Short enough to be read with a few pictures
    expect(Math.max(...guides.map((g) => g.description.length))).toBeLessThan(2200);
  });
});
