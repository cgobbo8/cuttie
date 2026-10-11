import { describe, expect, it } from "vitest";
import type { MachineProfile } from "./api";
import { rough, transcriptionEstimate, typicalLive } from "./machine";

const machine = (whisper_realtime: number | null): MachineProfile => ({
  backend: whisper_realtime ? "cuda" : "cpu",
  gpu: { name: "NVIDIA GeForce GTX 1650 with Max-Q Design", vram_gb: 4, tflops: 2.9 },
  cpu: "x86",
  whisper_realtime,
  voices: { seconds: 90 },
});

describe("machine estimates", () => {
  it("takes the streamer's usual live length", () => {
    expect(typicalLive([5 * 3600, 3 * 3600, 4 * 3600, 120])).toBe(4 * 3600);
    expect(typicalLive([2 * 3600, 3 * 3600])).toBe(2.5 * 3600);
    expect(typicalLive([])).toBe(4 * 3600);
  });

  it("tells whether Groq is worth it", () => {
    // The GTX 1650 of the test PC: 4.6x real time, a 4 h live in 52 min
    const slow = transcriptionEstimate(machine(4.6), 4 * 3600);
    expect(Math.round(slow.local! / 60)).toBe(52);
    expect(slow.advice).toBe("saves");
    expect(slow.groqDollars).toBeCloseTo(0.16);
    expect(transcriptionEstimate(machine(45), 4 * 3600).advice).toBe("fast");
    expect(transcriptionEstimate(machine(null), 4 * 3600)).toMatchObject({ local: null, advice: "needed" });
  });

  it("rounds durations for a quick read", () => {
    expect(rough(28)).toEqual({ h: 0, min: 0, s: 30 });
    expect(rough(4 * 60 + 20)).toEqual({ h: 0, min: 4, s: 0 });
    expect(rough(52 * 60)).toEqual({ h: 0, min: 50, s: 0 });
    expect(rough(99 * 60)).toEqual({ h: 1, min: 40, s: 0 });
  });
});
