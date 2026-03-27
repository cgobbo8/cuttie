const BASE = "http://localhost:3333/api";

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
  chat_message_count: number | null;
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
  | "TRANSCRIBING"
  | "LLM_ANALYSIS"
  | "DONE"
  | "ERROR";

export interface StepTiming {
  start: number; // unix timestamp (seconds)
  duration_seconds: number | null; // null while step is running
}

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
  step_timings: Record<string, StepTiming> | null;
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

// ── Adonis response mappers ──────────────────────────────────────────────────
// Adonis returns camelCase; frontend interfaces use snake_case from old FastAPI.

function mapJobResponse(raw: any): JobResponse {
  return {
    job_id: raw.id,
    status: raw.status,
    progress: raw.progress ?? null,
    hot_points: raw.hotPoints ?? null,
    error: raw.error ?? null,
    vod_title: raw.vodTitle ?? null,
    vod_game: raw.vodGame ?? null,
    vod_duration_seconds: raw.vodDurationSeconds ?? null,
    streamer: raw.streamer ?? null,
    view_count: raw.viewCount ?? null,
    stream_date: raw.streamDate ?? null,
    step_timings: raw.stepTimings ?? null,
  };
}

function mapJobSummary(raw: any): JobSummary {
  return {
    job_id: raw.id,
    url: raw.url,
    status: raw.status,
    vod_title: raw.vodTitle ?? null,
    vod_duration_seconds: null,
    created_at: raw.createdAt,
    error: raw.error ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

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
  return res.json(); // Adonis returns { job_id } directly
}

export async function getJobStatus(jobId: string): Promise<JobResponse> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error("Failed to fetch job status");
  return mapJobResponse(await res.json());
}

export async function listJobs(): Promise<JobSummary[]> {
  const res = await fetch(`${BASE}/jobs`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  const data = await res.json();
  return (Array.isArray(data) ? data : data.data ?? []).map(mapJobSummary);
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

export async function trimClip(jobId: string, filename: string, startSeconds: number, endSeconds: number): Promise<Response> {
  return fetch(`${BASE}/clips/${jobId}/${filename}/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_seconds: startSeconds, end_seconds: endSeconds }),
  });
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
  chat_messages: { author: string; text: string; timestamp: number }[];
}

export async function getEditEnvironment(jobId: string, clipFilename: string): Promise<EditEnvironment> {
  const res = await fetch(`${BASE}/clips/${jobId}/${clipFilename}/edit-env`);
  if (!res.ok) throw new Error("Failed to load edit environment");
  return res.json();
}

// ── Render (editor export) ───────────────────────────────

export interface RenderResult {
  filename: string;
  size_mb: number;
  url: string;
}

export interface RenderStatus {
  render_id: string;
  job_id: string;
  clip_filename: string;
  status: "rendering" | "done" | "error";
  progress: number;
  output_filename?: string;
  size_mb?: number;
  url?: string;
  error?: string;
  vod_title?: string;
  created_at: string;
}

export async function startRender(
  jobId: string,
  clipFilename: string,
  layers: unknown[],
): Promise<string> {
  const res = await fetch(`${BASE}/clips/${jobId}/${clipFilename}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layers }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Render failed" }));
    throw new Error(err.detail || "Render failed");
  }
  const data = await res.json();
  return data.render_id;
}

export async function getRenderStatus(renderId: string): Promise<RenderStatus> {
  const res = await fetch(`${BASE}/renders/${renderId}`);
  if (!res.ok) throw new Error("Failed to fetch render status");
  return res.json();
}

export async function listRenders(): Promise<RenderStatus[]> {
  const res = await fetch(`${BASE}/renders`);
  if (!res.ok) throw new Error("Failed to fetch renders");
  return res.json();
}

export async function renderClip(
  jobId: string,
  clipFilename: string,
  layers: unknown[],
  onProgress?: (pct: number) => void,
): Promise<RenderResult> {
  const renderId = await startRender(jobId, clipFilename, layers);

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const status = await getRenderStatus(renderId);
        if (onProgress) onProgress(status.progress);

        if (status.status === "done") {
          resolve({
            filename: status.output_filename!,
            size_mb: status.size_mb!,
            url: status.url!,
          });
        } else if (status.status === "error") {
          reject(new Error(status.error || "Render failed"));
        } else {
          setTimeout(poll, 1000);
        }
      } catch (err) {
        reject(err);
      }
    };
    poll();
  });
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
