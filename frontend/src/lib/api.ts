const BASE = "/api";

// ── Auth API ────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  fullName: string | null;
  email: string;
  initials: string;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Invalid credentials");
  const json = await res.json();
  const data = json.data ?? json;
  return data.user;
}

export async function logout(): Promise<void> {
  // Intentionally silent: logout is best-effort — the token is discarded locally regardless
  await fetch(`${BASE}/auth/logout`, { method: "DELETE" }).catch(() => {});
}

export async function getMe(): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/me`);
  if (!res.ok) throw new Error("Not authenticated");
  const json = await res.json();
  const data = json.data ?? json;
  return data.user;
}

// ── Data interfaces ─────────────────────────────────────────────────────────

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
  clip_name: string;
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
  start: number;
  duration_seconds: number | null;
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
  vod_game: string | null;
  vod_duration_seconds: number | null;
  streamer: string | null;
  view_count: number | null;
  stream_date: string | null;
  chat_message_count: number | null;
  created_at: string;
  error: string | null;
}

export interface PaginationMeta {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
}

export interface PaginatedJobs {
  data: JobSummary[];
  meta: PaginationMeta;
}

// ── Adonis response mappers ──────────────────────────────────────────────────

interface ServerJobResponse {
  id: string;
  status: JobStatusType;
  progress?: string | null;
  hotPoints?: ServerHotPoint[] | null;
  error?: string | null;
  vodTitle?: string | null;
  vodGame?: string | null;
  vodDurationSeconds?: number | null;
  streamer?: string | null;
  viewCount?: number | null;
  streamDate?: string | null;
  stepTimings?: Record<string, StepTiming> | null;
}

interface ServerHotPoint {
  clip_name?: string | null;
  [key: string]: unknown;
}

interface ServerJobSummary {
  id: string;
  url: string;
  status: string;
  vodTitle?: string | null;
  vodGame?: string | null;
  vodDurationSeconds?: number | null;
  streamer?: string | null;
  viewCount?: number | null;
  streamDate?: string | null;
  chatMessageCount?: number | null;
  createdAt: string;
  error?: string | null;
}

function mapJobResponse(raw: ServerJobResponse): JobResponse {
  const hotPoints = raw.hotPoints
    ? raw.hotPoints.map((hp) => ({ ...hp, clip_name: hp.clip_name ?? "" } as HotPoint))
    : null;
  return {
    job_id: raw.id,
    status: raw.status,
    progress: raw.progress ?? null,
    hot_points: hotPoints,
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

function mapJobSummary(raw: ServerJobSummary): JobSummary {
  return {
    job_id: raw.id,
    url: raw.url,
    status: raw.status,
    vod_title: raw.vodTitle ?? null,
    vod_game: raw.vodGame ?? null,
    vod_duration_seconds: raw.vodDurationSeconds ?? null,
    streamer: raw.streamer ?? null,
    view_count: raw.viewCount ?? null,
    stream_date: raw.streamDate ?? null,
    chat_message_count: raw.chatMessageCount ?? null,
    created_at: raw.createdAt,
    error: raw.error ?? null,
  };
}

// ── Games API ───────────────────────────────────────────────────────────────

export interface GameSummary {
  name: string;
  vod_count: number;
  streamer_count: number;
  avg_views: number;
  total_views: number;
  last_stream_date: string | null;
  streamers: string[];
}

export async function listGames(): Promise<GameSummary[]> {
  const res = await fetch(`${BASE}/games`);
  if (!res.ok) throw new Error("Failed to fetch games");
  const json = await res.json();
  return json.data ?? [];
}

// ── Job API ─────────────────────────────────────────────────────────────────

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
  return mapJobResponse(await res.json());
}

export interface ListJobsParams {
  page?: number;
  per_page?: number;
  search?: string;
  status?: string;
}

export async function listJobs(params?: ListJobsParams): Promise<PaginatedJobs> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  if (params?.search) qs.set("search", params.search);
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`${BASE}/jobs${suffix}`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  const json = await res.json();
  return {
    data: ((json.data ?? []) as ServerJobSummary[]).map(mapJobSummary),
    meta: json.meta,
  };
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete job");
}

export async function deleteRender(renderId: string): Promise<void> {
  const res = await fetch(`${BASE}/renders/${renderId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete render");
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

// ── SSE (Server-Sent Events) ─────────────────────────────

export interface SSEClipReady {
  type: "clip_ready";
  job_id: string;
  rank: number;
  hot_point: HotPoint;
}

export interface SSEStatusUpdate {
  status: JobStatusType;
  progress?: string;
  error?: string | null;
  step_timings?: Record<string, StepTiming>;
  hot_points?: HotPoint[];
  vod_title?: string | null;
  vod_game?: string | null;
  vod_duration_seconds?: number | null;
  streamer?: string | null;
  view_count?: number | null;
  stream_date?: string | null;
}

export type SSEEvent = SSEClipReady | SSEStatusUpdate;

function mapSSEHotPoint(raw: ServerHotPoint): HotPoint {
  return { ...raw, clip_name: raw.clip_name ?? "" } as HotPoint;
}

export function subscribeJobSSE(
  jobId: string,
  onEvent: (event: SSEEvent) => void,
  onError?: () => void,
): () => void {
  const es = new EventSource(`${BASE}/jobs/${jobId}/sse`);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);

      if (data.type === "clip_ready") {
        onEvent({
          type: "clip_ready",
          job_id: data.job_id,
          rank: data.rank,
          hot_point: mapSSEHotPoint(data.hot_point),
        });
        return;
      }

      const update: SSEStatusUpdate = {
        status: data.status,
        progress: data.progress,
        error: data.error,
        step_timings: data.step_timings ?? data.stepTimings,
        vod_title: data.vod_title ?? data.vodTitle,
        vod_game: data.vod_game ?? data.vodGame,
        vod_duration_seconds: data.vod_duration_seconds ?? data.vodDurationSeconds,
        streamer: data.streamer,
        view_count: data.view_count ?? data.viewCount,
        stream_date: data.stream_date ?? data.streamDate,
      };
      if (data.hot_points) {
        update.hot_points = data.hot_points.map(mapSSEHotPoint);
      } else if (data.hotPoints) {
        update.hot_points = data.hotPoints.map(mapSSEHotPoint);
      }
      onEvent(update);
    } catch {
      // ignore parse errors
    }
  };

  es.onerror = () => {
    onError?.();
  };

  return () => es.close();
}

export async function renameClip(jobId: string, clipFilename: string, clipName: string): Promise<{ clip_name: string }> {
  const res = await fetch(`${BASE}/jobs/${jobId}/clips/${clipFilename}/name`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip_name: clipName }),
  });
  if (!res.ok) throw new Error("Failed to rename clip");
  return res.json();
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
  clip_name?: string;
  status: "rendering" | "done" | "error";
  progress: number;
  output_filename?: string;
  size_mb?: number;
  url?: string;
  error?: string;
  vod_title?: string;
  vod_game?: string;
  created_at: string;
}

export async function startRender(
  jobId: string,
  clipFilename: string,
  layers: unknown[],
  trim?: { trimStart: number; trimEnd: number },
  clipName?: string,
): Promise<string> {
  const res = await fetch(`${BASE}/clips/${jobId}/${clipFilename}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layers,
      ...(trim ? { trim_start: trim.trimStart, trim_end: trim.trimEnd } : {}),
      ...(clipName ? { clip_name: clipName } : {}),
    }),
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
