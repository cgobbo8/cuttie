import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { waitingBySource } from "./suggestions";
import { SOURCE_TARGET, VIDEO_SOURCES, isVideoSource, sourceOf, sourcePath } from "./videoSources";

describe("what a video is made from", () => {
  it("is one of three sources, the same on the server", () => {
    expect(VIDEO_SOURCES).toEqual(["clip", "sequence", "compilation"]);
    expect(VIDEO_SOURCES.every(isVideoSource)).toBe(true);
    expect(["", "clips", "film", null, undefined, 3].some(isVideoSource)).toBe(false);
    const service = readFileSync(path.resolve(__dirname, "../../../api/app/services/compilations.ts"), "utf8");
    expect(service.match(/export const VIDEO_SOURCES: VideoSource\[\] = \[([^\]]+)\]/)?.[1].match(/\w+/g)).toEqual(VIDEO_SOURCES);
  });

  it("is said on the video, else read from where it comes from", () => {
    expect(sourceOf({ source: "clip" })).toBe("clip");
    expect(sourceOf({ source: "sequence", suggestion: null })).toBe("sequence");
    // A stretch of the live the AI proposed, from before videos said their source: a sequence
    expect(sourceOf({ suggestion: { span: [100, 900] } })).toBe("sequence");
    // Everything else is a compilation: an idea of the AI across the live, a video made by hand, one nobody knows
    expect(sourceOf({ suggestion: {} })).toBe("compilation");
    expect(sourceOf({})).toBe("compilation");
    expect(sourceOf({ source: "film" })).toBe("compilation");
    expect(sourceOf(null)).toBe("compilation");
  });

  it("gives each source its place in a live and the length its videos aim for", () => {
    expect(sourcePath("job-1", "clip")).toBe("/job-1/compilations?kind=clip");
    expect(sourcePath("job-1", "compilation")).toBe("/job-1/compilations?kind=compilation");
    // A clip is a moment, a sequence a short story, never over a minute and a half (too long for the platforms)
    expect(SOURCE_TARGET.clip).toBeLessThan(SOURCE_TARGET.sequence);
    expect(Math.max(...Object.values(SOURCE_TARGET))).toBeLessThanOrEqual(90);
  });

  it("counts the ideas that wait on the source they are of", () => {
    const idea = (more: object) => ({ suggestion: {}, sections: [{ items: [] }], ...more });
    expect(
      waitingBySource([
        idea({ suggestion: { span: [0, 600] } }),
        idea({ source: "sequence" }),
        idea({}),
        // Built (an answer, passages), or made by hand: no longer waiting
        idea({ answer: "Voilà la vidéo." }),
        idea({ sections: [{ items: [{}] }] }),
        { sections: [{ items: [] }] },
        // A card of the library says it itself
        { waiting: true, source: "compilation" },
        { waiting: false, suggestion: { span: [0, 60] } },
      ]),
    ).toEqual({ sequence: 2, compilation: 2 });
    expect(waitingBySource([])).toEqual({});
  });
});
