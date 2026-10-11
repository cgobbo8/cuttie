/** Display helpers shared by the home, project and channel screens. */

/** "(FlashFA) Maurice va passer un bon mercredi" -> { tag: "FlashFA", title: "Maurice va passer un bon mercredi" } */
export function splitVodTitle(raw: string | null | undefined): { tag: string | null; title: string } {
  const text = (raw ?? "").trim();
  const m = /^[([]([^)\]]{1,24})[)\]]\s*(.+)$/.exec(text);
  return m ? { tag: m[1].trim(), title: m[2].trim() } : { tag: null, title: text };
}

/** 22921 -> "6:22:01" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 22921 -> "6 h 22", 600 -> "10 min" */
export function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** "mercredi 7 octobre · 21:03" with a capital first letter */
export function liveDate(iso: string, lang: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
  const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
  const text = `${day} · ${time}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Vendredi 2 octobre"; a bare "2026-10-02" is that day wherever we are */
export function dayDate(iso: string, lang: string): string {
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso);
  const text = d.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "mar. 6 oct." */
export function shortDate(iso: string, lang: string): string {
  const text = new Date(iso).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A few spoken words of a moment, split on two lines, for template previews */
export function sampleSubtitle(transcript: string | null | undefined): { lines: string[][]; highlight: [number, number] } {
  const sentences = (transcript ?? "").split(/(?<=[.!?…])\s+/).map((s) => s.trim().split(/\s+/).filter(Boolean));
  const words = sentences.find((s) => s.length >= 3 && s.length <= 7) ?? sentences.flat().slice(0, 6);
  if (words.length === 0) return { lines: [["C'est", "pas"], ["possible"]], highlight: [1, 0] };
  const cut = Math.ceil(words.length / 2);
  const lines = [words.slice(0, cut), words.slice(cut)].filter((l) => l.length > 0);
  return { lines, highlight: [lines.length - 1, lines[lines.length - 1].length - 1] };
}

/** Analysis pipeline steps in order, with rough durations (minutes) measured on a 5 h VOD */
export const PIPELINE_STEPS = [
  { status: "DOWNLOADING_AUDIO", minutes: 1.2 },
  { status: "ANALYZING_AUDIO", minutes: 0.9 },
  { status: "SCORING", minutes: 0.1 },
  { status: "ANALYZING_CLIPS", minutes: 3.1 },
  { status: "CLIPPING", minutes: 0.7 },
] as const;

export const ACTIVE_STATUSES = new Set([
  "PENDING",
  "DOWNLOADING_AUDIO",
  "DOWNLOADING_CHAT",
  "ANALYZING_AUDIO",
  "ANALYZING_CHAT",
  "SCORING",
  "ANALYZING_CLIPS",
  "CLIPPING",
  "LLM_ANALYSIS",
]);

function stepIndex(status: string): number {
  if (status === "DOWNLOADING_CHAT" || status === "PENDING") return 0;
  if (status === "ANALYZING_CHAT") return 1;
  if (status === "LLM_ANALYSIS") return 3;
  const i = PIPELINE_STEPS.findIndex((s) => s.status === status);
  return i === -1 ? 0 : i;
}

/** When an analysis started and should be done, unix seconds (the worker's estimate) */
export interface AnalysisEta {
  start: number;
  end: number;
}

/**
 * Progress of an analysis: from the worker's estimate when there is one (it knows
 * the live's length, the transcription engine and this computer's speed), else
 * roughly from its status and progress text ("Extraction clips (16/20)...").
 */
export function analysisProgress(
  status: string,
  progress?: string | null,
  eta?: AnalysisEta | null,
  now = Date.now() / 1000,
): { percent: number; minutesLeft: number } {
  if (eta && eta.end > eta.start) {
    return {
      percent: Math.max(2, Math.min(99, Math.round(((now - eta.start) / (eta.end - eta.start)) * 100))),
      minutesLeft: Math.max(1, Math.round((eta.end - now) / 60)),
    };
  }
  const total = PIPELINE_STEPS.reduce((sum, s) => sum + s.minutes, 0);
  const i = stepIndex(status);
  const ratio = /\((\d+)\s*\/\s*(\d+)\)/.exec(progress ?? "");
  const within = ratio ? Math.min(1, Number(ratio[1]) / Math.max(1, Number(ratio[2]))) : 0.15;
  const done = PIPELINE_STEPS.slice(0, i).reduce((sum, s) => sum + s.minutes, 0) + PIPELINE_STEPS[i].minutes * within;
  return {
    percent: Math.max(2, Math.min(99, Math.round((done / total) * 100))),
    minutesLeft: Math.max(1, Math.round(total - done)),
  };
}

/** What's left of an analysis: "12 min", "1 h 50" */
export function timeLeft(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
