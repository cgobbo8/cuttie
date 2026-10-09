import type { CustomTemplate } from "./templates";
import type { TemplateSpec } from "./templateSpec";

const BASE = "/api";

// ── Auth API ────────────────────────────────────────────────────────────────

export interface UserQuota {
  key: string;
  limit: number;
  period: "daily" | "monthly" | "yearly" | "lifetime";
}

export interface AuthUser {
  id: number;
  fullName: string | null;
  email: string;
  initials: string;
  permissions: string[];
  quotas: UserQuota[];
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

// ── Local app (settings, diagnostics) ───────────────────────────────────────

export interface AppInfo {
  mode: "local";
  auto_login: boolean;
}

export async function getAppInfo(): Promise<AppInfo> {
  const res = await fetch(`${BASE}/app/info`);
  if (!res.ok) throw new Error("Failed to load app info");
  return res.json();
}

export type ApiKeyName = "groq_api_key" | "openrouter_api_key" | "openai_api_key";

/** Speech to text: "auto" = Groq when its key is set, else OpenRouter */
export type TranscriptionEngine = "auto" | "groq" | "openrouter" | "local";

export interface AppSettings {
  keys: Record<ApiKeyName, { configured: boolean; preview: string | null }>;
  /** First launch done (channel, keys, webcam) */
  onboarded: boolean;
  transcription: TranscriptionEngine;
}

export async function getSettings(): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`);
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

/** Save API keys — an empty string removes a key. */
export async function updateSettings(keys: Partial<Record<ApiKeyName, string>>): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error("Failed to save settings");
  return res.json();
}

export async function updateTranscription(transcription: TranscriptionEngine): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcription }),
  });
  if (!res.ok) throw new Error("Failed to save settings");
  return res.json();
}

/** Mark the first launch as done */
export async function setOnboarded(onboarded: boolean): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboarded }),
  });
  return jsonOrThrow(res, "Failed to save settings");
}

export type KeyCheck = { ok: true } | { ok: false; reason: "missing" | "invalid" | "unreachable" };

/** Ask the provider whether a saved key works */
export async function verifyApiKey(name: "groq_api_key" | "openrouter_api_key"): Promise<KeyCheck> {
  const res = await fetch(`${BASE}/settings/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return jsonOrThrow(res, "Failed to check the key");
}

export interface WorkerDiagnostics {
  python?: string;
  platform?: string;
  data_dir?: string;
  ffmpeg?: string | null;
  yt_dlp?: string | null;
  keys?: { groq: boolean; openrouter: boolean };
  /** OpenRouter answering ("ok"), out of credits, or refusing the key */
  openrouter?: "ok" | "credits" | "key";
  /** Dollars left on the OpenRouter key, when it has a spending limit */
  openrouter_credit?: { remaining: number; limit: number } | null;
  disk_free_gb?: number;
  busy?: string | null;
  torch?: string;
  device?: "cuda" | "mps" | "cpu" | "error";
  gpu?: string;
  device_error?: string;
  transcription?: {
    engine?: "groq" | "openrouter" | "local";
    /** Whisper on this computer: "mlx" = Apple chip, "cuda" = NVIDIA GPU (both fast), "cpu" (slow) */
    local_device?: "mlx" | "cuda" | "cpu";
    local_model_ready?: boolean;
    error?: string;
  };
}

export interface Diagnostics {
  api: { node: string; platform: string; data_dir: string; disk_free_gb: number | null };
  worker: WorkerDiagnostics | null;
  worker_error: string | null;
}

export async function getDiagnostics(): Promise<Diagnostics> {
  const res = await fetch(`${BASE}/diagnostics`);
  if (!res.ok) throw new Error("Failed to load diagnostics");
  return res.json();
}

// ── Brand kit + Twitch channel ──────────────────────────────────────────────

export interface FacecamRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Size of the stream the rectangle was measured on */
  ref_w?: number;
  ref_h?: number;
}

export interface BrandColors {
  /** Main brand color: app accent, widget ring, speaker labels */
  accent: string;
  /** The word being spoken in subtitles */
  highlight: string;
  /** Widget text */
  dark: string;
  /** Logo background */
  light: string;
}

export type WidgetTiming = "start" | "always" | "end";
export type SubtitleStyle = "bold" | "karaoke" | "minimal";

export interface BrandKit {
  twitch_login: string | null;
  colors: BrandColors;
  /** Swatches detected on the logo and banner */
  palette: string[];
  palette_source: string | null;
  /**
   * Where the webcam usually sits (false = no webcam, null = not confirmed
   * yet). Every analysis checks it again on its own clips.
   */
  facecam: FacecamRect | false | null;
  /** Storage key of the live frame the webcam was confirmed on */
  facecam_frame: string | null;
  widget: { enabled: boolean; timing: WidgetTiming };
  subtitles: { style: SubtitleStyle };
  /** Templates made in the simple template editor (first-version ones are upgraded on read) */
  templates: (TemplateSpec | CustomTemplate)[];
  /** Template applied to new projects (a built-in id or a custom template id) */
  default_template: string | null;
}

export type BrandKitPatch = Partial<Omit<BrandKit, "colors" | "widget">> & {
  colors?: Partial<BrandColors>;
  widget?: Partial<BrandKit["widget"]>;
};

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json as T;
}

export async function getBrandKit(): Promise<BrandKit> {
  return jsonOrThrow(await fetch(`${BASE}/brand-kit`), "Failed to load brand kit");
}

export async function updateBrandKit(patch: BrandKitPatch): Promise<BrandKit> {
  const res = await fetch(`${BASE}/brand-kit`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow(res, "Failed to save brand kit");
}

/** Detect the brand colors on the channel's logo and banner (saved in the kit) */
export async function detectBrandColors(): Promise<BrandKit> {
  return jsonOrThrow(await fetch(`${BASE}/brand-kit/detect-colors`, { method: "POST" }), "Failed to detect colors");
}

export interface DetectedFacecam {
  facecam: FacecamRect | null;
  /** Frame of the live the webcam was looked for on */
  frame_url: string;
  /** Storage key of that frame, to save with the confirmed webcam */
  frame_key: string | null;
  vod: { id: string; title: string } | null;
}

/** The live frame the brand kit's webcam was confirmed on (404 when none) */
export const brandFrameUrl = `${BASE}/brand-kit/frame`;

/** Find the webcam on the latest live (not saved until confirmed) */
export async function detectBrandFacecam(): Promise<DetectedFacecam> {
  return jsonOrThrow(await fetch(`${BASE}/brand-kit/detect-facecam`, { method: "POST" }), "Failed to detect the webcam");
}

export interface TwitchVod {
  id: string;
  title: string;
  duration_seconds: number;
  published_at: string;
  view_count: number;
  /** 640x360 */
  thumbnail_url: string | null;
  /** 1280x720 */
  thumbnail_large_url: string | null;
  game: string | null;
  url: string;
  /** Existing analysis of this VOD, if any */
  job: {
    id: string;
    status: string;
    progress: string | null;
    clip_count: number;
    /** Why it stopped, when it did */
    error?: string | null;
    notices?: JobNotice[];
  } | null;
}

export interface TwitchChannel {
  login: string;
  display_name: string;
  avatar_url: string | null;
  banner_url: string | null;
  description: string | null;
  followers: number | null;
  primary_color: string | null;
  vods: TwitchVod[];
}

/** A channel as Twitch shows it, before it is saved (no analyses linked) */
export type LookedUpChannel = Omit<TwitchChannel, "vods"> & { vods: Omit<TwitchVod, "job">[] };

/** A channel's public info, without saving it (first launch) */
export async function lookupChannel(login: string): Promise<LookedUpChannel | null> {
  const json = await jsonOrThrow<{ channel: LookedUpChannel | null }>(
    await fetch(`${BASE}/twitch/lookup?login=${encodeURIComponent(login)}`),
    "Twitch ne répond pas",
  );
  return json.channel;
}

/** The colors of a channel's logo and banner, without saving them */
export async function lookupChannelColors(login: string): Promise<{ palette: string[]; roles: BrandColors }> {
  return jsonOrThrow(await fetch(`${BASE}/twitch/lookup/colors?login=${encodeURIComponent(login)}`), "Couleurs indisponibles");
}

export async function getTwitchChannel(): Promise<TwitchChannel | null> {
  const json = await jsonOrThrow<{ channel: TwitchChannel | null }>(await fetch(`${BASE}/twitch/channel`), "Failed to load Twitch channel");
  return json.channel ?? null;
}

/** Seek-preview sprite sheets of a VOD: `count` frames, one every `interval` s */
export interface TwitchStoryboard {
  images: string[];
  cols: number;
  rows: number;
  count: number;
  width: number;
  height: number;
  interval: number;
}

export async function getStoryboard(vodId: string): Promise<TwitchStoryboard | null> {
  const json = await jsonOrThrow<{ storyboard: TwitchStoryboard | null }>(
    await fetch(`${BASE}/twitch/vods/${encodeURIComponent(vodId)}/storyboard`),
    "Failed to load the storyboard",
  );
  return json.storyboard;
}

/** The clip cropped to 9:16, small and blurred: backdrop of the vertical templates */
export function clipBackgroundUrl(jobId: string, filename: string): string {
  return `${BASE}/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}/background`;
}

/** Still frame of a clip (extracted and cached by the API) */
export function clipThumbUrl(jobId: string, filename: string, opts: { width?: 480 | 1280; time?: number } = {}): string {
  const params = new URLSearchParams();
  if (opts.width) params.set("w", String(opts.width));
  if (opts.time !== undefined) params.set("t", opts.time.toFixed(1));
  const query = params.toString();
  return `${BASE}/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}/thumb${query ? `?${query}` : ""}`;
}

// ── Data interfaces ─────────────────────────────────────────────────────────

export interface SignalBreakdown {
  rms: number;
  spectral_flux: number;
  pitch_variance: number;
  spectral_centroid: number;
  zcr: number;
  chat_speed: number;
  vocal_excitement: number;
  speech_presence: number;
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
  /** On-screen hook line for the first seconds of the short */
  hook?: string;
  /** Tightest standalone cut suggested by the AI, clip seconds (the clip keeps its margins) */
  cut_start?: number | null;
  cut_end?: number | null;
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
  clip_source: "auto" | "manual" | "detected";
  /** Bounds of the clip in the VOD (seconds) */
  clip_start?: number;
  clip_end?: number;
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
  | "ANALYZING_CLIPS"
  | "CLIPPING"
  | "LLM_ANALYSIS"
  | "DONE"
  | "ERROR";

export interface StepTiming {
  start: number;
  duration_seconds: number | null;
}

export interface VodPhase {
  start: string;
  end: string;
  description: string;
}

export interface VodProtagonist {
  name: string;
  role: string;
}

export interface VodContext {
  summary: string;
  phases: VodPhase[];
  protagonists: VodProtagonist[];
  recurring_themes: string[];
  language: string;
  mood_arc: string;
}

export interface JobResponse {
  job_id: string;
  url: string | null;
  status: JobStatusType;
  progress: string | null;
  hot_points: HotPoint[] | null;
  error: string | null;
  vod_title: string | null;
  custom_title: string | null;
  vod_game: string | null;
  vod_duration_seconds: number | null;
  streamer: string | null;
  view_count: number | null;
  stream_date: string | null;
  step_timings: Record<string, StepTiming> | null;
  vod_context: VodContext | null;
  /** The streamer's choices per clip filename */
  selection: Record<string, ClipSelection>;
  /** Live view of the analysis */
  timeline: JobTimeline | null;
  /** Things that degraded the analysis without failing it */
  notices?: JobNotice[] | null;
}

/** e.g. segments Whisper could not transcribe (rate limits), or the AI provider refusing every call */
export interface JobNotice {
  kind: "transcription" | "provider" | string;
  failed?: number;
  total?: number;
  /** "provider": who refuses and why */
  provider?: string;
  reason?: "credits" | "key";
}

export interface TimelineCandidate {
  /** Position in the VOD, seconds */
  t: number;
  state: "pending" | "rated" | "kept" | "dropped" | "clip";
  /** 0-1 once rated */
  score?: number;
  name?: string;
  category?: string;
}

export interface JobTimeline {
  duration?: number;
  /** Voice energy, 0-1, evenly sampled across the live */
  energy?: number[];
  /** Chat messages per slice of the live */
  chat?: number[];
  candidates?: TimelineCandidate[];
}

export interface ClipSelection {
  state?: "kept" | "passed";
  /** Trim bounds in clip seconds */
  trim?: [number, number];
}

export interface JobSummary {
  job_id: string;
  url: string;
  status: string;
  vod_title: string | null;
  custom_title: string | null;
  vod_game: string | null;
  vod_duration_seconds: number | null;
  streamer: string | null;
  streamer_thumbnail: string | null;
  view_count: number | null;
  stream_date: string | null;
  chat_message_count: number | null;
  created_at: string;
  error: string | null;
  progress: string | null;
  /** Twitch VOD id, from the url */
  vod_id: string | null;
  /** The best moment's clip: its frame stands for the project */
  cover_clip: string | null;
  clip_count: number;
  kept_count: number;
  export_count: number;
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
  url?: string | null;
  status: JobStatusType;
  progress?: string | null;
  hotPoints?: ServerHotPoint[] | null;
  error?: string | null;
  vodTitle?: string | null;
  customTitle?: string | null;
  vodGame?: string | null;
  vodDurationSeconds?: number | null;
  streamer?: string | null;
  viewCount?: number | null;
  streamDate?: string | null;
  stepTimings?: Record<string, StepTiming> | null;
  vodContext?: VodContext | null;
  selection?: Record<string, ClipSelection> | null;
  timeline?: JobTimeline | null;
  notices?: JobNotice[] | null;
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
  customTitle?: string | null;
  vodGame?: string | null;
  vodDurationSeconds?: number | null;
  streamer?: string | null;
  streamerThumbnail?: string | null;
  viewCount?: number | null;
  streamDate?: string | null;
  chatMessageCount?: number | null;
  createdAt: string;
  error?: string | null;
  progress?: string | null;
  vodId?: string | null;
  coverClip?: string | null;
  clipCount?: number;
  keptCount?: number;
  exportCount?: number;
}

function mapJobResponse(raw: ServerJobResponse): JobResponse {
  const hotPoints = raw.hotPoints
    ? raw.hotPoints.map((hp) => ({ ...hp, clip_name: hp.clip_name ?? "", clip_source: (hp as any).clip_source ?? "auto" } as HotPoint))
    : null;
  return {
    job_id: raw.id,
    url: raw.url ?? null,
    status: raw.status,
    progress: raw.progress ?? null,
    hot_points: hotPoints,
    error: raw.error ?? null,
    vod_title: raw.vodTitle ?? null,
    custom_title: raw.customTitle ?? null,
    vod_game: raw.vodGame ?? null,
    vod_duration_seconds: raw.vodDurationSeconds ?? null,
    streamer: raw.streamer ?? null,
    view_count: raw.viewCount ?? null,
    stream_date: raw.streamDate ?? null,
    step_timings: raw.stepTimings ?? null,
    vod_context: raw.vodContext ?? null,
    selection: raw.selection ?? {},
    timeline: raw.timeline ?? null,
    notices: raw.notices ?? null,
  };
}

function mapJobSummary(raw: ServerJobSummary): JobSummary {
  return {
    job_id: raw.id,
    url: raw.url,
    status: raw.status,
    vod_title: raw.vodTitle ?? null,
    custom_title: raw.customTitle ?? null,
    vod_game: raw.vodGame ?? null,
    vod_duration_seconds: raw.vodDurationSeconds ?? null,
    streamer: raw.streamer ?? null,
    streamer_thumbnail: raw.streamerThumbnail ?? null,
    view_count: raw.viewCount ?? null,
    stream_date: raw.streamDate ?? null,
    chat_message_count: raw.chatMessageCount ?? null,
    created_at: raw.createdAt,
    error: raw.error ?? null,
    progress: raw.progress ?? null,
    vod_id: raw.vodId ?? null,
    cover_clip: raw.coverClip ?? null,
    clip_count: raw.clipCount ?? 0,
    kept_count: raw.keptCount ?? 0,
    export_count: raw.exportCount ?? 0,
  };
}

// ── Games API ───────────────────────────────────────────────────────────────

export interface GameSummary {
  name: string;
  game_id: string | null;
  thumbnail: string | null;
  vod_count: number;
  streamer_count: number;
  avg_views: number;
  total_views: number;
  last_stream_date: string | null;
  streamers: string[];
}

export interface StreamerSummary {
  name: string;
  thumbnail: string | null;
  vod_count: number;
}

export interface GamesResponse {
  games: GameSummary[];
  streamers: StreamerSummary[];
}

export async function listGamesAndStreamers(creatorId?: number): Promise<GamesResponse> {
  const qs = creatorId ? `?creator_id=${creatorId}` : "";
  const res = await fetch(`${BASE}/games${qs}`);
  if (!res.ok) throw new Error("Failed to fetch games");
  const json = await res.json();
  return {
    games: json.data ?? [],
    streamers: json.streamers ?? [],
  };
}

export async function listGames(creatorId?: number): Promise<GameSummary[]> {
  const { games } = await listGamesAndStreamers(creatorId);
  return games;
}

// ── Creators API ────────────────────────────────────────────────────────────

export interface CreatorSummary {
  id: number;
  twitch_id: string | null;
  login: string;
  display_name: string;
  thumbnail: string | null;
  vod_count: number;
  avg_views: number;
  total_views: number;
  last_stream_date: string | null;
  games: string[];
}

export async function listCreators(): Promise<CreatorSummary[]> {
  const res = await fetch(`${BASE}/creators`);
  if (!res.ok) throw new Error("Failed to fetch creators");
  const json = await res.json();
  return json.data ?? [];
}

// ── Dashboard API ───────────────────────────────────────────────────────────

export interface DashboardProject {
  id: string;
  vod_title: string | null;
  custom_title: string | null;
  streamer: string | null;
  streamer_thumbnail: string | null;
  vod_game: string | null;
  created_at: string;
}

export interface DashboardExport {
  render_id: string;
  clip_name: string | null;
  status: string;
  vod_title: string | null;
  vod_game: string | null;
  created_at: string;
}

export interface DashboardCreator {
  id: number;
  display_name: string;
  thumbnail: string | null;
  login: string;
  vod_count: number;
}

export interface DashboardGame {
  name: string;
  thumbnail: string | null;
  vod_count: number;
  avg_views: number;
}

export interface DashboardData {
  stats: Record<string, number>;
  top_creators?: DashboardCreator[];
  creator?: { id: number; display_name: string; thumbnail: string | null; login: string; twitch_id: string | null };
  top_games?: DashboardGame[];
  latest_projects: DashboardProject[];
  latest_exports: DashboardExport[];
}

export async function getDashboard(creatorId?: number): Promise<DashboardData> {
  const qs = creatorId ? `?creator_id=${creatorId}` : "";
  const res = await fetch(`${BASE}/dashboard${qs}`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
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

export async function addClipToJob(jobId: string, file: File): Promise<{ clip_filename: string; clip_name: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/jobs/${jobId}/add-clip`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error || "Upload failed");
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
  game?: string;
  streamer?: string;
  creator_id?: number;
}

export async function listJobs(params?: ListJobsParams): Promise<PaginatedJobs> {
  const qs = new URLSearchParams();
  if (params?.page) qs.set("page", String(params.page));
  if (params?.per_page) qs.set("per_page", String(params.per_page));
  if (params?.search) qs.set("search", params.search);
  if (params?.status) qs.set("status", params.status);
  if (params?.game) qs.set("game", params.game);
  if (params?.streamer) qs.set("streamer", params.streamer);
  if (params?.creator_id) qs.set("creator_id", String(params.creator_id));
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await fetch(`${BASE}/jobs${suffix}`);
  if (!res.ok) throw new Error("Failed to fetch jobs");
  const json = await res.json();
  return {
    data: ((json.data ?? []) as ServerJobSummary[]).map(mapJobSummary),
    meta: json.meta,
  };
}

export async function renameJob(jobId: string, customTitle: string): Promise<{ custom_title: string }> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custom_title: customTitle }),
  });
  if (!res.ok) throw new Error("Failed to rename job");
  return res.json();
}

/** Keep / pass a clip, or set its trim (null clears) */
export async function updateSelection(
  jobId: string,
  clipFilename: string,
  patch: { state?: ClipSelection["state"] | null; trim?: [number, number] | null },
): Promise<Record<string, ClipSelection>> {
  const res = await fetch(`${BASE}/jobs/${jobId}/selection`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clip_filename: clipFilename, ...patch }),
  });
  const json = await jsonOrThrow<{ selection: Record<string, ClipSelection> }>(res, "Failed to save the choice");
  return json.selection;
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

// ── Hot point mapping ────────────────────────────────────

export function mapSSEHotPoint(raw: ServerHotPoint): HotPoint {
  return { ...raw, clip_name: raw.clip_name ?? "", clip_source: (raw as any).clip_source ?? "auto" } as HotPoint;
}

export async function deleteClip(jobId: string, clipFilename: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${jobId}/clips/${clipFilename}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete clip");
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
  speaker?: string;
}

export async function getClipWords(jobId: string, filename: string): Promise<TranscriptWord[]> {
  const res = await fetch(`${BASE}/clips/${jobId}/${filename}/words`);
  if (!res.ok) return [];
  return res.json();
}

export interface EditEnvironment {
  clip_width: number;
  clip_height: number;
  /** Webcam for this clip: null when there is none or it doesn't show in this clip */
  facecam: { x: number; y: number; w: number; h: number } | null;
  /** This live's webcam: set by hand ("live"), the usual one ("brand") or found on its clips ("detected") */
  cam?: {
    rect: { x: number; y: number; w: number; h: number } | null;
    source: "live" | "brand" | "detected" | null;
    /** Not where it usually is on this live */
    moved: boolean;
    /** Somebody is in the cam in this clip */
    visible: boolean;
  };
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

/** Webcam framing for one live: a rectangle, false (no cam on this live) or null (automatic) */
export async function setLiveFacecam(jobId: string, facecam: FacecamRect | false | null, remember = false): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}/facecam`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facecam, remember }),
  });
  await jsonOrThrow(res, "Failed to save the webcam");
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
  status: "pending" | "rendering" | "done" | "error";
  progress: number;
  output_filename?: string;
  size_mb?: number;
  url?: string;
  error?: string;
  batch_group_id?: string;
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
  renderOptions?: { width?: number; height?: number; fps?: number },
): Promise<string> {
  const res = await fetch(`${BASE}/clips/${jobId}/${clipFilename}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      layers,
      ...(trim ? { trim_start: trim.trimStart, trim_end: trim.trimEnd } : {}),
      ...(clipName ? { clip_name: clipName } : {}),
      ...(renderOptions ? { render_options: renderOptions } : {}),
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

export async function listRenders(creatorId?: number): Promise<RenderStatus[]> {
  const qs = creatorId ? `?creator_id=${creatorId}` : "";
  const res = await fetch(`${BASE}/renders${qs}`);
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

// ── Themes ─────────────────────────────────────────────

export interface ThemeResponse {
  id: number;
  name: string;
  layers: unknown[];
  is_default: boolean;
  created_at: string;
}

export async function listThemes(): Promise<ThemeResponse[]> {
  const res = await fetch(`${BASE}/themes`);
  if (!res.ok) throw new Error("Failed to fetch themes");
  return res.json();
}

export async function createTheme(name: string, layers: unknown[], isDefault?: boolean): Promise<ThemeResponse> {
  const res = await fetch(`${BASE}/themes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, layers, is_default: isDefault }),
  });
  if (!res.ok) throw new Error("Failed to create theme");
  return res.json();
}

export async function updateTheme(id: number, data: { name?: string; layers?: unknown[]; is_default?: boolean }): Promise<ThemeResponse> {
  const res = await fetch(`${BASE}/themes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update theme");
  return res.json();
}

export async function deleteTheme(id: number): Promise<void> {
  const res = await fetch(`${BASE}/themes/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete theme");
}

export async function toggleThemeDefault(id: number): Promise<{ is_default: boolean }> {
  const res = await fetch(`${BASE}/themes/${id}/default`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to toggle default");
  return res.json();
}

// ── Batch Render ───────────────────────────────────────

export interface BatchRenderResponse {
  batch_group_id: string;
  render_ids: string[];
}

export async function startBatchRender(
  jobId: string,
  clipFilenames: string[],
  themeLayers: unknown[],
  renderOptions?: { width?: number; height?: number; fps?: number },
): Promise<BatchRenderResponse> {
  const res = await fetch(`${BASE}/jobs/${jobId}/batch-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clip_filenames: clipFilenames,
      theme_layers: themeLayers,
      render_options: renderOptions,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Batch render failed" }));
    throw new Error(err.error || "Batch render failed");
  }
  return res.json();
}

// ── Workers API ──────────────────────────────────────────────────────────────

export interface ActiveJob {
  id: string;
  url: string;
  status: string;
  progress: string | null;
  streamer: string | null;
  vod_title: string | null;
  vod_game: string | null;
  step_timings: Record<string, { start: number; duration_seconds: number | null }> | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface QueueItem {
  job_id?: string;
  url?: string;
  type?: string;
  raw?: string;
}

export interface ActiveRender {
  id: string;
  job_id: string;
  clip_filename: string;
  clip_name: string | null;
  status: string;
  progress: number;
  batch_group_id: string | null;
  created_at: string | null;
}

export interface WorkersStatus {
  active_jobs: ActiveJob[];
  active_renders: ActiveRender[];
  queue: {
    length: number;
    items: QueueItem[];
  };
}

export interface FlushResult {
  flushed_queue: number;
  cancelled_jobs: number;
  cancelled_renders: number;
}

export async function getWorkersStatus(): Promise<WorkersStatus> {
  const res = await fetch(`${BASE}/workers`);
  if (!res.ok) throw new Error("Failed to fetch workers status");
  return res.json();
}

export async function flushWorkers(): Promise<FlushResult> {
  const res = await fetch(`${BASE}/workers/flush`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to flush workers");
  return res.json();
}

export async function cancelWorkerJob(jobId: string): Promise<void> {
  const res = await fetch(`${BASE}/workers/cancel/${jobId}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Cancel failed" }));
    throw new Error(err.error || "Cancel failed");
  }
}

export async function cancelWorkerRender(renderId: string): Promise<void> {
  const res = await fetch(`${BASE}/workers/cancel-render/${renderId}`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Cancel failed" }));
    throw new Error(err.error || "Cancel failed");
  }
}
