import { describe, expect, it } from "vitest";
import { analysisProgress, clock, hoursMinutes, splitVodTitle } from "./format";

describe("format", () => {
  it("pulls the server tag out of a VOD title", () => {
    expect(splitVodTitle("(FlashFA) Maurice va passer un bon mercredi")).toEqual({ tag: "FlashFA", title: "Maurice va passer un bon mercredi" });
    expect(splitVodTitle("[FR] Ranked")).toEqual({ tag: "FR", title: "Ranked" });
    expect(splitVodTitle("Sans tag")).toEqual({ tag: null, title: "Sans tag" });
    expect(splitVodTitle(null)).toEqual({ tag: null, title: "" });
  });

  it("formats durations", () => {
    expect(clock(23838)).toBe("6:37:18");
    expect(clock(65)).toBe("1:05");
    expect(hoursMinutes(22921)).toBe("6 h 22");
    expect(hoursMinutes(600)).toBe("10 min");
  });

  it("estimates analysis progress from the step and its counter", () => {
    const start = analysisProgress("DOWNLOADING_AUDIO");
    const clipping = analysisProgress("CLIPPING", "Extraction clips (16/20)...");
    expect(start.percent).toBeLessThan(10);
    expect(clipping.percent).toBeGreaterThan(90);
    expect(clipping.minutesLeft).toBe(1);
    expect(analysisProgress("ANALYZING_CLIPS", "Analyse IA (25/50)").percent).toBeGreaterThan(analysisProgress("ANALYZING_CLIPS").percent);
  });
});
