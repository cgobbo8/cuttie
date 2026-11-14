import { describe, expect, it } from "vitest";
import { isTransition, lookStyle, transitionAt, transitionSpan, TRANSITION_IDS } from "./transitions";

const scaleOf = (transform?: string) => Number(transform?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);

describe("transitions between two pieces", () => {
  it("does nothing away from the cut", () => {
    for (const id of TRANSITION_IDS) {
      const { before, after } = transitionSpan(id, 30);
      expect(transitionAt(id, -before - 1, 30), id).toBeNull();
      expect(transitionAt(id, after, 30), id).toBeNull();
      expect(transitionAt(id, 0, 30), id).not.toBeNull();
    }
  });

  it("lasts as long in seconds at any frame rate", () => {
    expect(transitionSpan("slide", 60).after).toBe(transitionSpan("slide", 30).after * 2);
    expect(transitionSpan("zoom", 60).before).toBe(transitionSpan("zoom", 30).before * 2);
  });

  it("leaves the piece coming in whole on its last frame", () => {
    for (const id of TRANSITION_IDS) {
      const { after } = transitionSpan(id, 30);
      const last = transitionAt(id, after - 1, 30)!;
      // Nearly where it rests: the next frame, with no transition at all, does not jump
      expect(Math.abs(scaleOf(last.piece.transform) - 1), id).toBeLessThan(0.03);
      expect(last.piece.opacity ?? 1, id).toBeGreaterThan(0.9);
      expect(last.flash, id).toBeLessThan(0.05);
    }
  });

  it("holds the picture before only when the transition shows both", () => {
    expect(transitionAt("slide", 3, 30)!.held).not.toBeNull();
    expect(transitionAt("swipe", 3, 30)!.held).not.toBeNull();
    expect(transitionAt("pop", 3, 30)!.held).not.toBeNull();
    expect(transitionAt("fade", 3, 30)!.held).not.toBeNull();
    expect(transitionAt("flash", 3, 30)!.held).toBeNull();
    expect(transitionAt("zoom", 3, 30)!.held).toBeNull();
    expect(transitionAt("shake", 3, 30)!.held).toBeNull();
  });

  it("pushes one picture out as the other comes in", () => {
    const start = transitionAt("slide", 0, 30)!;
    expect(start.piece.transform).toBe("translateX(100%)");
    expect(start.held!.transform).toMatch(/translateX\((-?0)%\)/);
    const mid = transitionAt("swipe", 4, 30)!;
    const y = Number(mid.piece.transform!.match(/translateY\(([\d.-]+)%\)/)![1]);
    const heldY = Number(mid.held!.transform!.match(/translateY\(([\d.-]+)%\)/)![1]);
    // Edge to edge: no gap between the two
    expect(y - heldY).toBeCloseTo(100, 1);
  });

  it("is brightest on the cut", () => {
    expect(transitionAt("flash", 0, 30)!.flash).toBe(1);
    expect(transitionAt("flash", -1, 30)!.flash).toBeGreaterThan(transitionAt("flash", -2, 30)!.flash);
    expect(transitionAt("flash", 4, 30)!.flash).toBeLessThan(0.5);
  });

  it("never shows the edges of a picture that zooms or shakes", () => {
    for (let frame = -5; frame < 9; frame++) {
      const zoom = transitionAt("zoom", frame, 30);
      if (zoom) expect(scaleOf(zoom.piece.transform)).toBeGreaterThanOrEqual(1);
      const shake = transitionAt("shake", frame, 30);
      if (!shake) continue;
      const [x, y] = shake.piece.transform!.match(/translate\(([\d.-]+)%, ([\d.-]+)%\)/)!.slice(1).map(Number);
      const grown = (scaleOf(shake.piece.transform) - 1) * 50;
      // What the picture gains on each side covers how far it moves, with room for its turn
      expect(Math.abs(x)).toBeLessThanOrEqual(grown * 0.6 + 0.001);
      expect(Math.abs(y)).toBeLessThanOrEqual(grown * 0.6 + 0.001);
    }
  });

  it("blurs by the size of the picture it is drawn on", () => {
    const look = transitionAt("zoom", -1, 30)!.piece;
    const big = lookStyle(look, 1080).filter!;
    const small = lookStyle(look, 108).filter!;
    expect(Number(big.match(/blur\(([\d.]+)px\)/)![1])).toBeCloseTo(Number(small.match(/blur\(([\d.]+)px\)/)![1]) * 10, 0);
    expect(lookStyle({}, 1080)).toEqual({});
  });

  it("knows its own names only", () => {
    expect(isTransition("zoom")).toBe(true);
    expect(isTransition("cut")).toBe(false);
    expect(isTransition(undefined)).toBe(false);
  });
});
