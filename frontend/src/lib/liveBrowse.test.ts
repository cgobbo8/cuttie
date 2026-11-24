import { describe, expect, it } from "vitest";
import { parseClock, pickedRange, spanText } from "./liveBrowse";

describe("a time of the live as it is typed", () => {
  it("reads what a player writes, and what a streamer says", () => {
    expect(parseClock("3:20:00")).toBe(12000);
    expect(parseClock("3h20")).toBe(12000);
    expect(parseClock(" 3 h 20 ")).toBe(12000);
    expect(parseClock("3h20m15")).toBe(12015);
    expect(parseClock("3H20M15S")).toBe(12015);
    expect(parseClock("3h")).toBe(10800);
    // Two numbers are minutes and seconds, as on a player
    expect(parseClock("20:15")).toBe(1215);
    expect(parseClock("95m")).toBe(5700);
    expect(parseClock("95min")).toBe(5700);
    expect(parseClock("12m30")).toBe(750);
    expect(parseClock("40s")).toBe(40);
    // A number alone is seconds
    expect(parseClock("1200")).toBe(1200);
    expect(parseClock("0:00:00")).toBe(0);
  });

  it("says when it is not a time", () => {
    for (const text of ["", "  ", "vers la fin", "3:75:00", "1:2:3:4", "h", "3h20x", "-5"]) expect(parseClock(text), text).toBeNull();
  });
});

describe("a stretch of the live picked between two marks", () => {
  it("is in order, inside the live, and long enough to be a passage", () => {
    expect(pickedRange(12014.004, 12052.3, 23061)).toEqual({ start: 12014, end: 12052.3, capped: false });
    // Marked the other way round: the same stretch
    expect(pickedRange(12052.3, 12014, 23061)).toEqual({ start: 12014, end: 12052.3, capped: false });
    // One mark missing, or two marks on the same second: nothing yet
    expect(pickedRange(12014, null, 23061)).toBeNull();
    expect(pickedRange(null, 12052, 23061)).toBeNull();
    expect(pickedRange(12014, 12014.5, 23061)).toBeNull();
    // Never past the end of the live
    expect(pickedRange(23050, 23100, 23061)).toEqual({ start: 23050, end: 23061, capped: false });
  });

  it("stops at the longest a passage can be, and says so", () => {
    expect(pickedRange(600, 1200, 23061)).toEqual({ start: 600, end: 780, capped: true });
  });
});

describe("spanText", () => {
  it("says a short stretch in seconds, to the tenth, as the language writes them", () => {
    expect(spanText(12.44, "fr")).toBe("12,4 s");
    expect(spanText(12.44, "en")).toBe("12.4 s");
    expect(spanText(0.96, "en")).toBe("1.0 s");
  });

  it("says a minute or more as a clock", () => {
    expect(spanText(59.96, "fr")).toBe("1:00");
    expect(spanText(92.3, "fr")).toBe("1:32");
    expect(spanText(180, "fr")).toBe("3:00");
  });
});
