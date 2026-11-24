import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Compilation, LiveHit } from "./api";

const api = vi.hoisted(() => ({
  planLiveVideo: vi.fn(),
  saveCompilation: vi.fn(),
  ensurePieces: vi.fn(),
  chooseSound: vi.fn(),
  getLiveSearchProgress: vi.fn(),
}));
vi.mock("./api", async (original) => ({ ...(await original<typeof import("./api")>()), ...api }));

import { LiveError } from "./api";
import { allItems } from "./compilation";
import { building, onBuildEnd, resetBuilds, startBuild, type Build } from "./backgroundBuild";

const hit = (start: number, end: number, text: string): LiveHit => ({ start, end, sources: ["ai"], text, before: "", after: "", chat: [], why: "", score: 0.8, spoken: true });
const idea = (id: string): Compilation =>
  ({
    id,
    name: "La malédiction du calme",
    sections: [{ id: "s0", title: "", query: "", items: [] }],
    template: null,
    titles: true,
    hook: "",
    target: 60,
    brief: "Toutes les fois où quelqu'un dit que c'est calme.",
    suggestion: { key: id, pitch: "Dit 25 fois", tags: [], score: 84, moments: [100, 200] },
    created_at: "",
    updated_at: "",
  }) as Compilation;
const using = { duration: 15000, language: "fr", tracks: ["drift"] };
/** Waits for the build of this video to end */
const ended = (id: string) =>
  new Promise<Build>((resolve) => {
    const stop = onBuildEnd((build) => {
      if (build.id !== id) return;
      stop();
      resolve(build);
    });
  });

describe("an idea built behind the page", () => {
  beforeEach(() => {
    resetBuilds();
    for (const mock of Object.values(api)) mock.mockReset();
    api.getLiveSearchProgress.mockResolvedValue(null);
    api.saveCompilation.mockImplementation(async (_job: string, video: Compilation) => video);
    api.ensurePieces.mockImplementation(async (_job: string, pieces: { id: string; start: number; fit?: [number, number] }[]) => ({
      // Each clip says where its words really are: two seconds after what the transcript gave
      pieces: pieces.map((piece) => ({ id: piece.id, ready: true, file: `piece_${piece.id}.mp4`, file_start: piece.start - 1, file_end: piece.start + 20, ...(piece.fit ? { tight: [piece.fit[0] + 2, piece.fit[1] + 2] as [number, number] } : {}) })),
      failed: [],
    }));
    api.chooseSound.mockResolvedValue({ kind: "funny", music: "drift", intro: "news", look: null, why: "", teaser: 2, transition: "pop", cost: 0.0005 });
  });

  it("is planned, cut on its words, dressed and kept, without its montage", async () => {
    api.planLiveVideo.mockResolvedValue({ title: "Calme", hook: "Trop calme ?", note: "Deux parties.", sections: [{ title: "C'est calme", hits: [hit(100, 104, "C'est calme ce soir"), hit(200, 203, "Franchement c'est calme")] }, { title: "Et puis non", hits: [hit(900, 905, "Ah non c'est la merde")] }] });
    const done = ended("idea1");
    startBuild("live", idea("idea1"), using);
    // Asked twice while it is being built: built once
    startBuild("live", idea("idea1"), using);
    const build = await done;

    expect(build.state).toBe("done");
    expect(api.planLiveVideo).toHaveBeenCalledTimes(1);
    // Planned from the request the AI wrote and the moments it had spotted, as the video it is
    expect(api.planLiveVideo.mock.calls[0].slice(0, 3)).toEqual(["live", "Toutes les fois où quelqu'un dit que c'est calme.", 60]);
    expect(api.planLiveVideo.mock.calls[0][5]).toEqual([100, 200]);
    const video = build.video!;
    // It keeps the name it was proposed under, takes the AI's hook and its parts
    expect(video).toMatchObject({ name: "La malédiction du calme", hook: "Trop calme ?", answer: "Deux parties.", titles: true });
    expect(video.sections.map((section) => [section.title, section.items.length])).toEqual([["C'est calme", 2], ["Et puis non", 1]]);
    // Every passage sits where its words are really said, and no longer waits for them
    const first = allItems(video)[0];
    expect(first.fit).toBeUndefined();
    expect(first.start).toBeGreaterThanOrEqual(101.5);
    // Its music (one that can be played here), its opening and its transition were chosen
    expect(video.music).toEqual({ track: "drift" });
    expect(video.intro).toMatchObject({ style: "news" });
    expect(video.transition).toBe("pop");
    // Saved as planned, then as finished
    expect(api.saveCompilation).toHaveBeenCalledTimes(2);
    expect(building([build], "live", "idea1")).toBeUndefined();
  });

  it("says why when nothing came of it, and the next one goes on", async () => {
    api.planLiveVideo.mockRejectedValueOnce(new LiveError("credits")).mockResolvedValueOnce({ title: "", sections: [{ title: "", hits: [] }] });
    const first = ended("idea1");
    const second = ended("idea2");
    startBuild("live", idea("idea1"), using);
    startBuild("live", idea("idea2"), using);
    expect((await first).why).toBe("credits");
    // Nothing in the live matched: nothing is saved
    expect(await second).toMatchObject({ state: "failed", why: "empty" });
    expect(api.saveCompilation).not.toHaveBeenCalled();
  });

  it("does without a music when choosing one fails, or when its file is not here", async () => {
    api.planLiveVideo.mockResolvedValue({ title: "Calme", sections: [{ title: "", hits: [hit(100, 104, "C'est calme ce soir")] }] });
    api.chooseSound.mockRejectedValueOnce(new LiveError("failed"));
    const done = ended("idea1");
    startBuild("live", idea("idea1"), using);
    expect((await done).video).toMatchObject({ sections: [{ items: [{ text: "C'est calme ce soir" }] }] });
    api.chooseSound.mockResolvedValueOnce({ kind: "funny", music: "elsewhere", intro: null, look: null, why: "", teaser: null, transition: null, cost: 0 });
    const again = ended("idea3");
    startBuild("live", idea("idea3"), using);
    expect((await again).video!.music).toBeUndefined();
  });
});
