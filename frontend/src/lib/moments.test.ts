import { describe, expect, it } from "vitest";
import type { HotPoint } from "./api";
import { buildMoments, countStates, nextTodo } from "./moments";

function hp(filename: string | null, score: number, start: number, end: number): HotPoint {
  return {
    timestamp_seconds: (start + end) / 2,
    timestamp_display: "",
    score: 0.5,
    final_score: score,
    signals: {} as HotPoint["signals"],
    clip_filename: filename,
    vertical_filename: null,
    clip_name: filename ?? "",
    clip_source: "auto",
    clip_start: start,
    clip_end: end,
    llm: null,
    chat_mood: null,
    chat_message_count: null,
  };
}

describe("moments", () => {
  const hotPoints = [
    hp("raté.mp4", 0.69, 8732, 8783),
    hp("hélico.mp4", 0.75, 9007, 9072),
    hp("raté-bis.mp4", 0.64, 8740, 8790),
    hp(null, 0.9, 100, 160),
  ];

  it("ranks clips best first and applies the streamer's choices", () => {
    const moments = buildMoments(hotPoints, { "raté.mp4": { state: "kept", trim: [2, 40] } });
    expect(moments.map((m) => m.filename)).toEqual(["hélico.mp4", "raté.mp4", "raté-bis.mp4"]);
    expect(moments.map((m) => m.rank)).toEqual([1, 2, 3]);
    expect(moments[0].score).toBe(75);
    expect(moments[1].state).toBe("kept");
    expect(moments[1].trim).toEqual([2, 40]);
    expect(moments[0].duration).toBe(65);
  });

  it("starts from the cut the AI suggests, until the streamer trims it", () => {
    const withCut = { ...hp("hélico.mp4", 0.75, 9007, 9072), llm: { cut_start: 12.5, cut_end: 41 } as HotPoint["llm"] };
    const [suggested] = buildMoments([withCut], {});
    expect(suggested.trim).toEqual([12.5, 41]);
    expect(suggested.suggested).toEqual([12.5, 41]);
    expect(suggested.trimmedByUser).toBe(false);
    // The streamer's own trim (even the whole clip) wins
    const [own] = buildMoments([withCut], { "hélico.mp4": { trim: [0, 65] } });
    expect(own.trim).toEqual([0, 65]);
    expect(own.trimmedByUser).toBe(true);
    // No usable suggestion: the whole clip
    const tooShort = { ...withCut, llm: { cut_start: 10, cut_end: 12 } as HotPoint["llm"] };
    expect(buildMoments([tooShort], {})[0].trim).toBeNull();
  });

  it("flags a weaker clip of the same passage", () => {
    const moments = buildMoments(hotPoints, {});
    expect(moments[2].duplicateOf?.filename).toBe("raté.mp4");
    expect(moments[0].duplicateOf).toBeNull();
  });

  it("finds the next moment to sort, wrapping around", () => {
    const moments = buildMoments(hotPoints, { "raté.mp4": { state: "kept" }, "raté-bis.mp4": { state: "passed" } });
    expect(nextTodo(moments, 0)).toBe(0);
    expect(nextTodo(moments, 1)).toBe(0);
    expect(countStates(moments)).toEqual({ kept: 1, passed: 1, todo: 1 });
    expect(nextTodo(buildMoments(hotPoints, { "hélico.mp4": { state: "kept" }, "raté.mp4": { state: "kept" }, "raté-bis.mp4": { state: "kept" } }), 0)).toBe(-1);
  });
});
