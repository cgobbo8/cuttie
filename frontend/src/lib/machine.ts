import type { MachineProfile } from "./api";

/** Groq's Whisper: a 7 h 39 live in 25 s; kept modest for the network and the files to send */
export const GROQ_REALTIME = 500;
/** Groq's price for Whisper large-v3 turbo, per hour of audio */
export const GROQ_DOLLARS_PER_HOUR = 0.04;
const DEFAULT_LIVE = 4 * 3600;

/** A usual live of the streamer: the median length of their recent ones, else 4 h */
export function typicalLive(durations: number[]): number {
  const lives = durations.filter((d) => d > 600).sort((a, b) => a - b);
  if (lives.length === 0) return DEFAULT_LIVE;
  const mid = Math.floor(lives.length / 2);
  return lives.length % 2 ? lives[mid] : (lives[mid - 1] + lives[mid]) / 2;
}

export interface TranscriptionEstimate {
  /** Seconds on this computer, null when it can't (no suitable card) */
  local: number | null;
  /** Seconds with Groq, and what it costs */
  groq: number;
  groqDollars: number;
  /** What to tell the streamer about a Groq key */
  advice: "fast" | "saves" | "needed";
}

/** Transcribing a live of `liveSeconds` here, and with Groq */
export function transcriptionEstimate(machine: MachineProfile, liveSeconds: number): TranscriptionEstimate {
  const local = machine.whisper_realtime ? liveSeconds / machine.whisper_realtime : null;
  const groq = Math.max(20, liveSeconds / GROQ_REALTIME);
  const advice = local === null ? "needed" : local <= 10 * 60 ? "fast" : "saves";
  return { local, groq, groqDollars: (liveSeconds / 3600) * GROQ_DOLLARS_PER_HOUR, advice };
}

/** A duration read at a glance: [amount, unit] with unit "s", "min" or "h" (and minutes after hours) */
export function rough(seconds: number): { h: number; min: number; s: number } {
  if (seconds < 60) return { h: 0, min: 0, s: Math.max(5, Math.round(seconds / 5) * 5) };
  const minutes = seconds < 10 * 60 ? Math.round(seconds / 60) : Math.round(seconds / 300) * 5;
  return { h: Math.floor(minutes / 60), min: minutes % 60, s: 0 };
}
