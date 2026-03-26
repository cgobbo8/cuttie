const BASE = "http://localhost:8000/api";

export interface SignalBreakdown {
  rms: number;
  spectral_flux: number;
  pitch_variance: number;
  spectral_centroid: number;
  zcr: number;
  chat_speed: number;
}

export interface KeyMoment {
  time: number;
  label: string;
  description: string;
}

export interface LlmAnalysis {
  transcript: string;
  speech_rate: number;
  category: string;
  virality_score: number;
  summary: string;
  is_clipable: boolean;
  key_moments: KeyMoment[];
  narrative: string;
}

export interface HotPoint {
  timestamp_seconds: number;
  timestamp_display: string;
  score: number;
  final_score: number | null;
  signals: SignalBreakdown;
  clip_filename: string | null;
  vertical_filename: string | null;
  llm: LlmAnalysis | null;
  chat_mood: string | null;
}

export type JobStatusType =
  | "PENDING"
  | "DOWNLOADING_AUDIO"
  | "DOWNLOADING_CHAT"
  | "ANALYZING_AUDIO"
  | "ANALYZING_CHAT"
  | "SCORING"
  | "TRIAGE"
  | "CLIPPING"
  | "VERTICAL"
  | "TRANSCRIBING"
  | "LLM_ANALYSIS"
  | "DONE"
  | "ERROR";

export interface JobResponse {
  job_id: string;
  status: JobStatusType;
  progress: string | null;
  hot_points: HotPoint[] | null;
  error: string | null;
  vod_title: string | null;
  vod_game: string | null;
  vod_duration_seconds: number | null;
  streamer: string | null;
  view_count: number | null;
  stream_date: string | null;
}

export interface JobSummary {
  job_id: string;
  url: string;
  status: string;
  vod_title: string | null;
  vod_duration_seconds: number | null;
  created_at: string;
  error: string | null;
}

export async function submitVod(url: string): Promise<{ job_id: string }> {
  const res = await fetch(`${BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Request failed" }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job status");
  return res.json();
}

export async function listJobs(): Promise<JobSummary[]> {
  const res = await fetch(`${BASE}/jobs`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function retryJob(
  jobId: string,
): Promise<{ job_id: string; resume_from: string | null }> {
  const res = await fetch(`${BASE}/jobs/${jobId}/retry`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Retry failed" }));
    throw new Error(err.detail || "Retry failed");
  }
  return res.json();
}

export function clipUrl(jobId: string, filename: string): string {
  return `${BASE}/clips/${jobId}/${filename}`;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export async function getClipWords(jobId: string, filename: string): Promise<TranscriptWord[]> {
  const res = await fetch(`${BASE}/clips/${jobId}/${filename}/words`);
  if (!res.ok) return [];
  return res.json();
}

export interface EditEnvironment {
  clip_width: number;
  clip_height: number;
  facecam: { x: number; y: number; w: number; h: number } | null;
  dominant_color: { r: number; g: number; b: number } | null;
  game_crop: { x: number; y: number; w: number; h: number };
  layout: {
    canvas_w: number;
    canvas_h: number;
    game_h: number;
    game_y: number;
    cam_size: number;
    cam_margin_top: number;
    cam_border_radius: number;
    blur_sigma: number;
    game_margin_bottom: number;
  };
  words: TranscriptWord[];
}

export async function getEditEnvironment(jobId: string, clipFilename: string): Promise<EditEnvironment> {
  const res = await fetch(`${BASE}/clips/${jobId}/${clipFilename}/edit-env`);
  if (!res.ok) throw new Error("Failed to load edit environment");
  return res.json();
}

// ── Assets ──────────────────────────────────────────────

export interface AssetInfo {
  filename: string;
  url: string;
}

export async function uploadAsset(file: File): Promise<AssetInfo & { id: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/assets/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function listAssets(): Promise<AssetInfo[]> {
  const res = await fetch(`${BASE}/assets`);
  if (!res.ok) return [];
  return res.json();
}

export function assetUrl(filename: string): string {
  return `${BASE}/assets/${filename}`;
}
