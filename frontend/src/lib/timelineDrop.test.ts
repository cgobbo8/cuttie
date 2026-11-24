import { describe, expect, it } from "vitest";
import { dropPlace, frameUnder, scrubClock, type Span } from "./timelineDrop";

// Two parts: a, b, c in the first (0-300), d, e in the second (300-500)
const marks: Span[] = [
  { id: "a", from: 0, to: 100 },
  { id: "b", from: 100, to: 200 },
  { id: "c", from: 200, to: 300 },
  { id: "d", from: 300, to: 400 },
  { id: "e", from: 400, to: 500 },
];
const parts: Record<string, string> = { a: "one", b: "one", c: "one", d: "two", e: "two" };
const sectionOf = (id: string) => parts[id];

describe("a passage dragged along the timeline", () => {
  it("lands before the passage whose first half is under it, after the one whose second half is", () => {
    // a dragged over the second half of b: after b, that is before c
    expect(dropPlace(marks, sectionOf, "a", 170)).toEqual({ section: "one", before: "c", at: 200 });
    // over the first half of c: the same place
    expect(dropPlace(marks, sectionOf, "a", 230)).toEqual({ section: "one", before: "c", at: 200 });
    // c dragged to the very start
    expect(dropPlace(marks, sectionOf, "c", 10)).toEqual({ section: "one", before: "a", at: 0 });
    // a dragged past everything: the end of the last part
    expect(dropPlace(marks, sectionOf, "a", 490)).toEqual({ section: "two", before: null, at: 500 });
  });

  it("stays in a part while over its last passage, and joins the next one past it", () => {
    // a over the second half of c, the last of its part: the end of that part
    expect(dropPlace(marks, sectionOf, "a", 280)).toEqual({ section: "one", before: null, at: 300 });
    // just past c: the head of the second part
    expect(dropPlace(marks, sectionOf, "a", 320)).toEqual({ section: "two", before: "d", at: 300 });
    // e brought back over the end of the first part
    expect(dropPlace(marks, sectionOf, "e", 290)).toEqual({ section: "one", before: null, at: 300 });
  });

  it("says nothing when it would stay where it is", () => {
    // b let go over itself, on either side
    expect(dropPlace(marks, sectionOf, "b", 120)).toBeNull();
    expect(dropPlace(marks, sectionOf, "b", 190)).toBeNull();
    // c, the last of its part, let go at the end of its part
    expect(dropPlace(marks, sectionOf, "c", 290)).toBeNull();
    // d, the head of its part, let go just before e
    expect(dropPlace(marks, sectionOf, "d", 330)).toBeNull();
    // ...but d over the end of the first part moves there
    expect(dropPlace(marks, sectionOf, "d", 280)).toEqual({ section: "one", before: null, at: 300 });
    // a video of one passage, or a passage nobody knows: nowhere to go
    expect(dropPlace([marks[0]], sectionOf, "a", 50)).toBeNull();
    expect(dropPlace(marks, sectionOf, "zz", 50)).toBeNull();
  });
});

describe("a place on the timeline as a time", () => {
  it("reads the frame under the pointer, kept inside the video", () => {
    const box = { left: 100, width: 400 };
    expect(frameUnder(100, box, 301)).toBe(0);
    expect(frameUnder(300, box, 301)).toBe(150);
    expect(frameUnder(900, box, 301)).toBe(300);
    expect(frameUnder(-50, box, 301)).toBe(0);
    expect(frameUnder(300, { left: 0, width: 0 }, 301)).toBe(0);
  });

  it("is said to the tenth of a second", () => {
    expect([scrubClock(0), scrubClock(46.26), scrubClock(59.96), scrubClock(144.04), scrubClock(-3)]).toEqual(["0:00.0", "0:46.3", "1:00.0", "2:24.0", "0:00.0"]);
  });
});
