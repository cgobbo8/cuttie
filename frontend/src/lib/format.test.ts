import { describe, expect, it } from "vitest";
import { analysisProgress, clock, dayDate, fileSize, hoursMinutes, splitVodTitle, timeLeft } from "./format";

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

  it("follows the worker's estimate when there is one", () => {
    // Started 30 min ago, should be done in 1 h 30 (a live transcribed on a small card)
    const eta = { start: 10_000, end: 10_000 + 2 * 3600 };
    const p = analysisProgress("ANALYZING_CLIPS", "Analyse IA (25/50)", eta, 10_000 + 1800);
    expect(p).toEqual({ percent: 25, minutesLeft: 90 });
    // Late on its estimate: still a minute left, not zero
    expect(analysisProgress("CLIPPING", null, eta, eta.end + 120).minutesLeft).toBe(1);
    expect(timeLeft(90)).toBe("1 h 30");
    expect(timeLeft(125)).toBe("2 h 05");
    expect(timeLeft(12)).toBe("12 min");
  });
});

describe("dayDate", () => {
  it("keeps a bare date on its day", () => {
    expect(dayDate("2026-10-02", "fr-FR")).toBe("Vendredi 2 octobre");
    expect(dayDate("2026-10-06T18:58:04Z", "fr-FR")).toMatch(/^Mardi 6 octobre$/);
  });

  it("says sizes in the units of the language", () => {
    // Intl puts a (narrow) no-break space before the unit
    const size = (bytes: number, lang: string) => fileSize(bytes, lang).replace(/[\u00a0\u202f]/g, " ");
    expect(size(1.24e9, "fr")).toBe("1,2 Go");
    expect(size(12.6e9, "fr")).toBe("13 Go");
    expect(size(484e6, "fr")).toBe("484 Mo");
    expect(size(270_527, "fr")).toBe("271 ko");
    expect(size(0, "fr")).toBe("0 ko");
    expect(size(1.24e9, "en")).toBe("1.2 GB");
  });
});
