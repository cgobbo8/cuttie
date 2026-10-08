import { describe, expect, it } from "vitest";
import { buildTemplate, coverCrop, gameRegion, NATIVE_LOOKS, suggestTemplate, TEMPLATE_IDS, type TemplateContext, type TemplateLook } from "./templates";

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
  subtitleStyle: "karaoke",
  widget: { enabled: true, timing: "start" },
  login: "falkarst",
  avatarUrl: "https://example.com/logo.png",
  hook: "Le pire sauvetage de Los Santos",
};

describe("templates", () => {
  it("keeps the gameplay left of a top-right webcam", () => {
    expect(gameRegion(ctx)).toEqual({ x: 0, y: 0, w: 1518, h: 1080 });
    expect(gameRegion({ ...ctx, facecam: null })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("crops to the box's aspect ratio", () => {
    const crop = coverCrop({ x: 0, y: 0, w: 1920, h: 1080 }, 9 / 16);
    expect(crop.h).toBe(1080);
    expect(crop.w).toBe(608);
    expect(crop.x).toBe(656);
  });

  it("builds every template with layers inside the canvas and the brand applied", () => {
    for (const id of TEMPLATE_IDS) {
      const layers = buildTemplate(id, ctx);
      expect(layers.length).toBeGreaterThan(2);
      const subs = layers.find((l) => l.type === "subtitles")!;
      expect(subs.subtitle!.words).toHaveLength(1);
      const widget = layers.find((l) => l.type === "widget");
      expect(widget?.widget?.props.login).toBe("falkarst");
      for (const l of layers.filter((l) => !l.locked)) {
        expect(l.transform.x).toBeGreaterThanOrEqual(0);
        expect(l.transform.y + l.transform.height).toBeLessThanOrEqual(1920);
      }
    }
  });

  it("uses the webcam crop and the brand's karaoke color", () => {
    const layers = buildTemplate("signature", ctx);
    const cam = layers.find((l) => l.type === "facecam")!;
    expect(cam.video!.crop!.x).toBeGreaterThanOrEqual(1518);
    expect(layers.find((l) => l.type === "subtitles")!.subtitle!.activeColor).toBe("#F7C502");
    // Widget in at the start, out after ~3 s
    expect(layers.find((l) => l.type === "widget")!.animations!.map((a) => a.type)).toEqual(["slideInBottom", "fadeOut"]);
  });

  it("times the widget from the trimmed start (renders keep clip time)", () => {
    const anims = buildTemplate("signature", { ...ctx, startAt: 12, endAt: 50 }).find((l) => l.type === "widget")!.animations!;
    expect(anims[0].time).toBeCloseTo(12.25);
    const end = buildTemplate("signature", { ...ctx, startAt: 12, endAt: 50, widget: { enabled: true, timing: "end" } }).find((l) => l.type === "widget")!;
    expect(end.animations![0].time).toBeCloseTo(46.5);
  });

  it("uses the pre-blurred backdrop instead of blurring in the renderer", () => {
    const bg = buildTemplate("signature", ctx)[0];
    expect(bg.video).toEqual({ src: "/api/clips/job/clip.mp4/background", background: true });
    expect(bg.style.blur).toBe(0);
  });

  it("drops the webcam, the widget and the hook when there are none", () => {
    const layers = buildTemplate("accroche", { ...ctx, facecam: null, widget: { enabled: false, timing: "start" }, hook: " " });
    expect(layers.some((l) => l.type === "facecam" || l.type === "widget" || l.type === "text")).toBe(false);
  });

  it("suggests a template from what happens in the moment", () => {
    expect(suggestTemplate("fail", true)).toBe("plein");
    expect(suggestTemplate("storytelling", true)).toBe("discussion");
    expect(suggestTemplate("fun", true, 1)).toBe("reaction");
    expect(suggestTemplate("fun", false)).toBe("sanscam");
    expect(suggestTemplate("fun", true, 0.5, 0.2)).toBe("signature");
  });

  describe("adjusted looks", () => {
    const look = (patch: Partial<TemplateLook>, id: keyof typeof NATIVE_LOOKS = "signature") => ({ ...NATIVE_LOOKS[id], ...patch });

    it("rounds the webcam into a circle with a ring in the channel color", () => {
      const layers = buildTemplate("signature", ctx, look({ camShape: "circle", camBorder: "accent" }));
      const webcam = layers.find((l) => l.type === "facecam")!;
      expect(webcam.transform.width).toBe(webcam.transform.height);
      expect(webcam.style.borderRadius).toBe(webcam.transform.width / 2);
      const ring = layers.find((l) => l.name === "Anneau de la cam")!;
      expect(ring.shape!.shapeType).toBe("circle");
      expect(ring.shape!.backgroundColor).toBe("#42BF85");
      // The crop follows the new (square) box
      expect(webcam.video!.crop!.w / webcam.video!.crop!.h).toBeCloseTo(1, 1);
    });

    it("resizes the webcam around its spot and can drop the frame", () => {
      const native = buildTemplate("signature", ctx).find((l) => l.type === "facecam")!.transform;
      const big = buildTemplate("signature", ctx, look({ camSize: "l", camBorder: "none" }));
      const t = big.find((l) => l.type === "facecam")!.transform;
      expect(t.width).toBeGreaterThan(native.width);
      expect(t.x + t.width / 2).toBeCloseTo(native.x + native.width / 2, 0);
      expect(big.some((l) => l.name === "Cadre de la cam")).toBe(false);
    });

    it("swaps the blurred clip for a plain or tinted background", () => {
      const dark = buildTemplate("signature", ctx, look({ background: "dark" }));
      expect(dark[0].type).toBe("shape");
      expect(dark[0].shape!.backgroundColor).toBe("#19405A");
      expect(dark.some((l) => l.video?.background)).toBe(false);
      const brand = buildTemplate("signature", ctx, look({ background: "brand" }));
      expect(brand[1].shape!.backgroundColor).toBe("#42BF85");
    });

    it("moves and resizes the subtitles, moves or hides the widget", () => {
      const layers = buildTemplate("signature", ctx, look({ subtitlePosition: "top", subtitleSize: "l", widgetPosition: "none" }));
      const subs = layers.find((l) => l.type === "subtitles")!;
      expect(subs.transform.y + subs.transform.height / 2).toBe(420);
      expect(subs.subtitle!.fontSize).toBe(Math.round(90 * 1.2));
      expect(layers.some((l) => l.type === "widget")).toBe(false);
      const top = buildTemplate("reaction", ctx, look({ widgetPosition: "top" }, "reaction")).find((l) => l.type === "widget")!;
      expect(top.transform.y).toBe(152);
    });

    it("can hide the hook line", () => {
      expect(buildTemplate("accroche", ctx, look({ hook: "off" }, "accroche")).some((l) => l.type === "text")).toBe(false);
    });

    it("keeps every combination inside the canvas", () => {
      for (const id of TEMPLATE_IDS) {
        for (const camSize of ["s", "l"] as const) {
          for (const camShape of ["rounded", "circle"] as const) {
            for (const subtitlePosition of ["top", "bottom"] as const) {
              const layers = buildTemplate(id, ctx, look({ camSize, camShape, subtitlePosition }, id));
              for (const l of layers) {
                expect(l.transform.x).toBeGreaterThanOrEqual(0);
                expect(l.transform.y).toBeGreaterThanOrEqual(0);
                expect(l.transform.x + l.transform.width).toBeLessThanOrEqual(1080);
                expect(l.transform.y + l.transform.height).toBeLessThanOrEqual(1920);
              }
            }
          }
        }
      }
    });
  });

  it("keeps layer ids across rebuilds so the preview doesn't reload its videos", () => {
    const a = buildTemplate("signature", ctx).map((l) => l.id);
    const b = buildTemplate("signature", { ...ctx, hook: "autre" }, { ...NATIVE_LOOKS.signature, camShape: "circle" }).map((l) => l.id);
    expect(new Set(a).size).toBe(a.length);
    expect(b).toEqual(a);
  });
});
