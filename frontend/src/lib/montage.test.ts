import { describe, expect, it } from "vitest";
import type { TemplateContext } from "./templates";
import { TEMPLATE_IDS } from "./templates";
import { buildTemplate } from "./builtinTemplates";
import {
  addPiece,
  buildMontage,
  envelope,
  framesOf,
  gapsOf,
  isOverlayLayer,
  joinTouching,
  montageFrames,
  introHold,
  playsIntro,
  renderIntro,
  moveEdge,
  nextStart,
  normalizeRanges,
  outputTime,
  pieceAt,
  rangesLength,
  removePiece,
  sameRanges,
  snapToWords,
  splitAt,
  tighten,
  wordsIn,
  type Range,
  withEffects,
  renderPieces,
} from "./montage";

const word = (text: string, start: number, end: number) => ({ word: text, start, end });

const ctx: TemplateContext = {
  src: "/api/clips/job/clip.mp4",
  backgroundSrc: "/api/clips/job/clip.mp4/background",
  frameW: 1920,
  frameH: 1080,
  facecam: { x: 1518, y: 0, w: 402, h: 446 },
  words: [word("avant", 1, 1.4), word("le", 6, 6.2), word("tigre", 6.3, 6.9), word("apres", 31, 31.5)],
  chat: [
    { author: "a", text: "avant", timestamp: 2 },
    { author: "b", text: "pendant", timestamp: 7 },
  ],
  startAt: 0,
  endAt: 60,
  colors: { accent: "#42BF85", highlight: "#F7C502", dark: "#19405A", light: "#BDF3DA" },
  subtitleStyle: "bold",
  widget: { enabled: true, timing: "start" },
  login: "falkarst",
  avatarUrl: null,
  hook: "Le tigre",
};

describe("pieces of a clip", () => {
  it("keeps pieces in order, inside the clip; those that touch stay two, those that overlap become one", () => {
    expect(normalizeRanges([[30, 40], [5, 12], [11.98, 20], [-3, 2], [58, 70]], 60)).toEqual([
      [0, 2],
      [5, 12],
      [12, 20],
      [30, 40],
      [58, 60],
    ]);
    expect(normalizeRanges([[10, 30], [15, 20], [25, 40]], 60)).toEqual([[10, 40]]);
    // Too short to be a piece, or the wrong way round
    expect(normalizeRanges([[10, 10.2], [20, 15]], 60)).toEqual([[15, 20]]);
    expect(normalizeRanges([], 60)).toEqual([]);
  });

  it("measures what the pieces make together", () => {
    const pieces: Range[] = [[5, 12], [30, 40]];
    expect(rangesLength(pieces)).toBe(17);
    expect(envelope(pieces)).toEqual([5, 40]);
    expect(envelope([])).toBeNull();
    expect(pieceAt(pieces, 6)).toBe(0);
    expect(pieceAt(pieces, 20)).toBe(-1);
    expect(pieceAt(pieces, 39.9)).toBe(1);
  });

  it("cuts a piece in two at the playhead, nothing taken out", () => {
    expect(splitAt([[5, 25]], 15)).toEqual([[5, 15], [15, 25]]);
    expect(splitAt([[5, 25], [40, 50]], 44.444)).toEqual([[5, 25], [40, 44.44], [44.44, 50]]);
    // The two halves stay two when the cut is saved
    expect(normalizeRanges(splitAt([[5, 25]], 15), 60)).toEqual([[5, 15], [15, 25]]);
    // Too close to an edge: nothing to cut
    expect(splitAt([[5, 25]], 5.3)).toEqual([[5, 25]]);
    // The playhead is not in a piece
    expect(splitAt([[5, 25]], 40)).toEqual([[5, 25]]);
  });

  it("adds a piece where the clip was cut out", () => {
    // 10 s of context before the AI's cut
    expect(addPiece([[40, 65]], 12, 80)).toEqual([[12, 20], [40, 65]]);
    // Close to the next piece: it goes up to it, and they stay two
    expect(addPiece([[40, 65]], 36, 80)).toEqual([[36, 40], [40, 65]]);
    // No room for a piece
    expect(addPiece([[40, 65]], 39.8, 80)).toEqual([[40, 65]]);
    // Up to the end of the clip
    expect(addPiece([[40, 65]], 76, 80)).toEqual([[40, 65], [76, 80]]);
    // Already in a piece
    expect(addPiece([[40, 65]], 50, 80)).toEqual([[40, 65]]);
  });

  it("removes a piece but never the last one", () => {
    expect(removePiece([[5, 12], [30, 40]], 0)).toEqual([[30, 40]]);
    expect(removePiece([[30, 40]], 0)).toEqual([[30, 40]]);
  });

  it("moves an edge without crossing the neighbors", () => {
    const pieces: Range[] = [[5, 12], [30, 40], [50, 55]];
    expect(moveEdge(pieces, 1, "start", 20, 60)[1]).toEqual([20, 40]);
    expect(moveEdge(pieces, 1, "start", 3, 60)[1]).toEqual([12, 40]);
    expect(moveEdge(pieces, 1, "end", 58, 60)[1]).toEqual([30, 50]);
    // Never shorter than the shortest piece
    expect(moveEdge(pieces, 1, "end", 10, 60)[1]).toEqual([30, 30.4]);
    expect(moveEdge(pieces, 2, "end", 99, 60)[2]).toEqual([50, 60]);
    // A lone cut stays at least a second long
    expect(moveEdge([[30, 40]], 0, "start", 39.8, 60, 1)[0]).toEqual([39, 40]);
  });

  it("joins two pieces when an edge is dragged onto its neighbor", () => {
    const touching: Range[] = [[5, 15], [15, 25], [40, 50]];
    expect(joinTouching(touching, 0, "end")).toEqual([[5, 25], [40, 50]]);
    expect(joinTouching(touching, 1, "start")).toEqual([[5, 25], [40, 50]]);
    // Not touching, or no neighbor on that side
    expect(joinTouching(touching, 1, "end")).toBe(touching);
    expect(joinTouching(touching, 0, "start")).toBe(touching);
    expect(joinTouching(touching, 2, "end")).toBe(touching);
  });

  it("plays two pieces that touch as one stretch", () => {
    const pieces: Range[] = [[5, 15], [15, 25]];
    expect(pieceAt(pieces, 14.99)).toBe(0);
    expect(pieceAt(pieces, 15)).toBe(1);
    expect(gapsOf(pieces, 30)).toEqual([[0, 5], [25, 30]]);
    expect(outputTime(pieces, 20)).toBe(15);
    expect(rangesLength(pieces)).toBe(20);
  });

  it("compares pieces and lists what is cut out", () => {
    expect(sameRanges([[5, 12]], [[5.04, 11.96]], 0.15)).toBe(true);
    expect(sameRanges([[5, 12]], [[5.4, 12]], 0.15)).toBe(false);
    expect(sameRanges([[5, 12]], [[5, 12], [20, 30]])).toBe(false);
    expect(gapsOf([[5, 12], [30, 40]], 60)).toEqual([[0, 5], [12, 30], [40, 60]]);
    expect(gapsOf([[0, 60]], 60)).toEqual([]);
  });

  it("knows where the video goes on and what time it is in the result", () => {
    const pieces: Range[] = [[5, 12], [30, 40]];
    expect(nextStart(pieces, 6)).toBe(6);
    expect(nextStart(pieces, 0)).toBe(5);
    expect(nextStart(pieces, 20)).toBe(30);
    expect(nextStart(pieces, 45)).toBeNull();
    expect(outputTime(pieces, 0)).toBe(0);
    expect(outputTime(pieces, 8)).toBe(3);
    expect(outputTime(pieces, 20)).toBe(7);
    expect(outputTime(pieces, 35)).toBe(12);
    expect(outputTime(pieces, 99)).toBe(17);
  });
});

describe("clean cuts", () => {
  const words = [word("je", 2, 2.2), word("te", 2.25, 2.4), word("jure", 2.4, 2.9), word("regarde", 3.6, 4.1)];

  it("drops a handle between two words", () => {
    // In the middle of "jure": the silence after it
    expect(snapToWords(3.1, words)).toBe(3.25);
    // Glued words: right where one ends and the next starts
    expect(snapToWords(2.36, words)).toBe(2.4);
    // Nothing near
    expect(snapToWords(10, words)).toBe(10);
    // Before the first word, after the last
    expect(snapToWords(1.85, words)).toBe(1.92);
    expect(snapToWords(4.3, words)).toBe(4.18);
    expect(snapToWords(7, [])).toBe(7);
  });

  it("takes the silences out", () => {
    const spoken = [word("ok", 1, 1.5), word("donc", 1.6, 2), word("voila", 6, 6.5), word("fin", 6.6, 7)];
    // 4 s without a word between "donc" and "voila"
    expect(tighten([[0, 8]], spoken, 20)).toEqual([[0, 2.3], [5.8, 8]]);
    // A long wait before the first word and after the last
    expect(tighten([[0, 20]], [word("seul", 10, 10.4)], 20)).toEqual([[9.8, 10.7]]);
    // No word at all (an action without a comment): untouched
    expect(tighten([[30, 40]], spoken, 60)).toEqual([[30, 40]]);
    // Short pauses stay
    expect(tighten([[0, 3]], [word("a", 0.5, 1), word("b", 1.8, 2.2)], 20)).toEqual([[0, 3]]);
  });

  it("gives a word to the piece that plays most of it", () => {
    const list = [word("a", 4.6, 5.2), word("b", 5.3, 5.6), word("c", 8.9, 9.4)];
    expect(wordsIn(list, 5, 9).map((w) => w.word)).toEqual(["b"]);
    expect(wordsIn(list, 4.8, 9.2).map((w) => w.word)).toEqual(["a", "b", "c"]);
  });
});

describe("montage for Remotion", () => {
  const build = (c: TemplateContext) => buildTemplate("signature", c);

  it("rounds pieces to whole frames", () => {
    expect(framesOf(4, 30)).toBe(120);
    expect(framesOf(0.01, 30)).toBe(1);
    expect(montageFrames([{ duration: 4 }, { duration: 3.02 }], 30)).toBe(120 + 91);
    // An intro holds the screen first: the video is that much longer (one this app doesn't know adds nothing)
    expect(montageFrames([{ duration: 4 }], 30, { style: "slam" })).toBe(48 + 120);
    expect(montageFrames([{ duration: 4 }], 30, { style: "wobble" })).toBe(120);
    // A hook holds the screen for as long as its moment; without one it is no intro at all
    expect(montageFrames([{ duration: 4 }], 30, { style: "hook", hook: { duration: 4.2 } })).toBe(126 + 120);
    expect(montageFrames([{ duration: 4 }], 30, { style: "hook" })).toBe(120);
    expect(introHold({ style: "hook", hook: { duration: 4.2 } }, 60)).toBe(252);
    expect(playsIntro({ style: "hook" })).toBe(false);
    expect(playsIntro({ style: "slam" }) && playsIntro({ style: "hook", hook: { duration: 3 } })).toBe(true);
    // To the renderer, the moment of a hook names its clip (and its live when it isn't the export's own)
    const drawn = { title: "T", name: "F", logo: null, colors: { accent: "#111111", highlight: "#222222", dark: "#000000", light: "#ffffff" }, font: "Anton" };
    const moment = { from: 12, duration: 4.2, layers: [] };
    expect(renderIntro({ ...drawn, style: "hook", hook: moment }, "piece_abc.mp4", "live-2")).toEqual({ ...drawn, style: "hook", hook: { ...moment, clip: "piece_abc.mp4", job: "live-2" } });
    expect(renderIntro({ ...drawn, style: "hook", hook: moment }, "piece_abc.mp4").hook).toEqual({ ...moment, clip: "piece_abc.mp4" });
    expect(renderIntro({ ...drawn, style: "slam", sound: "boom" })).toEqual({ ...drawn, style: "slam", sound: "boom" });
  });

  it("moves the picture on what is said when the video asks for it, on each piece's own clock", () => {
    const said = { ...ctx, words: [word("regarde", 6, 6.4), word("le", 6.5, 6.6), word("tigre!", 6.7, 7.3), word("quoi?", 31, 31.4)] };
    const cuts = [{ ctx: said, start: 5, end: 9 }, { ctx: said, start: 30, end: 34 }];
    const montage = buildMontage(cuts, build);
    // No level: the montage as it was
    expect(withEffects(montage, cuts, null).segments.every((segment) => !("effects" in segment))).toBe(true);
    const lively = withEffects(montage, cuts, "light");
    // The first piece punches in where « regarde le tigre! » starts, 1 s into it (said at 6 s of a clip played from 5 s)
    expect(lively.segments[0].effects).toEqual([{ kind: "punch", at: 0.95, for: 0.8, amount: 1.08 }]);
    // The second plays a little closer, and punches on its own line
    expect(lively.segments[1].effects!.map((e) => [e.kind, e.at])).toEqual([["zoom", 0], ["punch", 0.95]]);
    // Its layers, its place and its length are untouched
    expect(lively.segments.map(({ effects: _effects, ...rest }) => rest)).toEqual(montage.segments);
    // A clip's key moments, in its own seconds, take over from the words; one outside the piece is left out
    const named = withEffects(montage, cuts, "light", [[7.5, 20], undefined]);
    expect(named.segments[0].effects).toEqual([{ kind: "punch", at: 2.45, for: 0.8, amount: 1.08 }]);
    // To the renderer, a piece says its effects; chosen again, the level replaces what was placed
    expect(renderPieces(lively, ["a.mp4", "b.mp4"])[0].effects).toEqual(lively.segments[0].effects);
    expect(renderPieces(montage, ["a.mp4", "b.mp4"])[0]).not.toHaveProperty("effects");
    expect(withEffects(lively, cuts, null).segments).toEqual(montage.segments);
  });

  it("gives each piece the template's layers on the clip's clock, and lays the hook and widgets once over the whole", () => {
    const montage = buildMontage([{ ctx, start: 5, end: 9 }, { ctx, start: 30, end: 34 }], build);
    expect(montage.segments.map((s) => [s.from, s.duration])).toEqual([[5, 4], [30, 4]]);

    for (const segment of montage.segments) {
      const names = segment.layers.map((p) => p.layer.name);
      expect(names).toEqual(expect.arrayContaining(["Fond flouté", "Jeu", "Webcam", "Sous-titres"]));
      expect(names).not.toContain("Accroche");
      expect(segment.layers.some((p) => p.layer.type === "widget")).toBe(false);
    }
    // Each piece only shows the words and the chat of its own part
    const subtitles = (i: number) => montage.segments[i].layers.find((p) => p.layer.subtitle)!.layer.subtitle!.words.map((w) => w.word);
    expect(subtitles(0)).toEqual(["le", "tigre"]);
    expect(subtitles(1)).toEqual(["apres"]);
    // ...and nothing while nobody speaks (the preview's placeholder would flash at every cut)
    expect(montage.segments[0].layers.find((p) => p.layer.subtitle)!.layer.subtitle!.quiet).toBe(true);

    // The hook is the cover: from the first frame of the montage, gone after 3.5 s of it
    const hook = montage.overlays.find((p) => p.layer.name === "Accroche")!.layer;
    expect(hook.animations).toEqual([expect.objectContaining({ type: "fadeOut", time: 3.5 })]);
    // The widget is timed on the 8 s of the montage, not on the clip
    const widget = montage.overlays.find((p) => p.layer.type === "widget")!.layer;
    expect(widget.widget!.props).not.toHaveProperty("startAt", 5);
    expect(widget.animations![0].time).toBeLessThan(1);
    expect(Math.max(...widget.animations!.map((a) => a.time + a.duration))).toBeLessThanOrEqual(8);

    // Stacking survives the split: every layer keeps its place in the template
    const flat = build({ ...ctx, startAt: 0, endAt: 8 });
    const all = [...montage.segments[0].layers, ...montage.overlays].sort((a, b) => a.z - b.z);
    expect(all.map((p) => p.layer.name)).toEqual(flat.map((l) => l.name));
  });

  it("goes from a piece to the one that touches it without a frame lost or played twice", () => {
    // 5.95 s is frame 178.5 and the first piece is 85.5 frames long: rounded apart, they would overlap by a frame
    const montage = buildMontage([{ ctx, start: 5.95, end: 8.8 }, { ctx, start: 8.8, end: 20.02 }, { ctx, start: 40, end: 40.01 }], build);
    const frames = montage.segments.map((s) => [Math.round(s.from * 30), Math.round(s.duration * 30)]);
    expect(frames[0][0] + frames[0][1]).toBe(frames[1][0]);
    expect(frames).toEqual([[179, 85], [264, 337], [1200, 1]]);
  });

  it("splits every built-in template into clip layers and montage layers", () => {
    for (const id of TEMPLATE_IDS) {
      const layers = buildTemplate(id, ctx);
      const overlays = layers.filter(isOverlayLayer);
      const content = layers.filter((l) => !isOverlayLayer(l));
      // What follows the clip's clock never lands on the montage's
      expect(content.some((l) => l.type === "gameplay" && !l.video?.background)).toBe(true);
      expect(overlays.every((l) => l.type === "widget" || l.type === "text" || l.type === "shape")).toBe(true);
      expect(overlays.some((l) => l.subtitle || l.video || l.chat)).toBe(false);
      // (but for a layout's own decor, which is drawn on its pictures and stays with them)
      expect(content.some((l) => l.name === "Accroche" || (l.type === "widget" && l.widget?.widgetId !== "gta-seam"))).toBe(false);
    }
  });

  it("keeps a layout's own decor with the passages shown in that layout, not over the whole video", () => {
    // A GTA video whose second passage is shown full frame (an upright imported video, say)
    const keys = ["gta", "plein"] as const;
    const montage = buildMontage([{ ctx, start: 0, end: 4 }, { ctx, start: 10, end: 14 }], (c, index) => buildTemplate(index >= 0 ? keys[index] : "gta", c));
    const kinds = (layers: { layer: { widget?: { widgetId: string } } }[]) => layers.flatMap((p) => (p.layer.widget ? [p.layer.widget.widgetId] : []));
    // The strip on the seam of the webcam and the game is on the first passage only: it would cut the second's picture in two
    expect(kinds(montage.segments[0].layers)).toEqual(["gta-seam"]);
    expect(kinds(montage.segments[1].layers)).toEqual([]);
    expect(kinds(montage.overlays)).not.toContain("gta-seam");
    // What follows the whole video stays over all of it: the title's plate, the channel's tag, the stars
    expect(kinds(montage.overlays)).toEqual(["gta-plate", "gta-tag", "gta-wanted"]);
    // ...and it is there from its passage's first picture
    const seam = montage.segments[0].layers.find((p) => p.layer.widget?.widgetId === "gta-seam")!;
    expect(seam.layer.animations ?? []).toEqual([]);
  });

  it("lets each piece have its own template, the hook and widgets coming from the video's", () => {
    // Stacked for the video, the second piece shown with the game full screen
    const keys = ["empile", "plein"] as const;
    const asked: number[] = [];
    const montage = buildMontage([{ ctx, start: 5, end: 9 }, { ctx, start: 30, end: 34 }], (c, index) => {
      asked.push(index);
      return buildTemplate(index >= 0 ? keys[index] : "empile", c);
    });
    // Each piece is built once, then the video's hook and widgets (-1)
    expect(asked).toEqual([0, 1, -1]);
    const camOf = (i: number) => montage.segments[i].layers.find((p) => p.layer.name === "Webcam")!.layer.transform;
    expect(camOf(0)).toMatchObject({ x: 0, y: 0, width: 1080 });
    expect(camOf(1).width).toBeLessThan(400);
    const gameOf = (i: number) => montage.segments[i].layers.find((p) => p.layer.name === "Jeu")!.layer.transform;
    expect(gameOf(1)).toMatchObject({ y: 0, height: 1920 });
    // One hook, the stacked template's (on the game, under the webcam)
    const hooks = montage.overlays.filter((p) => p.layer.id === "tpl-accroche");
    expect(hooks).toHaveLength(1);
    expect(hooks[0].layer.transform.y).toBeGreaterThan(700);
  });

  it("adds layers on top for the montage's own clock", () => {
    const title = { ...buildTemplate("sanscam", ctx)[0], id: "section-1", name: "Titre" };
    const montage = buildMontage([{ ctx, start: 5, end: 9 }], build, 30, (total) => {
      expect(total).toBe(4);
      return [title];
    });
    const top = montage.overlays[montage.overlays.length - 1];
    expect(top.layer.id).toBe("section-1");
    expect(top.z).toBeGreaterThan(Math.max(...montage.segments[0].layers.map((p) => p.z)));
  });
});
