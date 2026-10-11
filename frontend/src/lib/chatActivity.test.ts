import { describe, expect, it } from "vitest";
import { busyThreshold, stackChat } from "./chatActivity";

const line = (t: number, author = "viewer", text = "mdr") => ({ t, author, text });

describe("chat activity", () => {
  it("stacks messages that come together, one column per burst, bots aside", () => {
    const columns = stackChat([line(12.4), line(3), line(3.8, "Ellyia"), line(4.1), line(30, "StreamElements"), line(12.9)]);
    expect(columns.map((c) => [c.t, c.lines.length])).toEqual([
      [3, 3],
      [12.4, 2],
    ]);
    // A message more than 1.2 s after a column's first one starts a new column
    expect(stackChat([line(1), line(2.1), line(2.3)]).map((c) => c.lines.length)).toEqual([2, 1]);
  });

  it("brightens the busiest tenth of the live", () => {
    // 11 busy slices: the two busiest stand out
    const counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 0, 0];
    expect(busyThreshold(counts)).toBe(10);
    expect(busyThreshold([0, 1, 1, 1])).toBe(2);
    expect(busyThreshold([])).toBe(Infinity);
  });
});
