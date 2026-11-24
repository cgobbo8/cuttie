import type { HookChoice } from "./intro/intros";
import type { MusicTrack } from "./music/mix";
import type { AnalysisEta } from "./format";
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
  /** Screens whose first-visit explanation was seen */
  guides_seen?: Guide[];
}

/** A screen that explains itself the first time it is opened */
export type Guide = "compilation";

/** Remember that a screen's explanation was seen (kept with the app's settings, not in the browser) */
export async function setGuideSeen(guide: Guide): Promise<AppSettings> {
  const res = await fetch(`${BASE}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guide_seen: guide }),
  });
  return jsonOrThrow(res, "Failed to save settings");
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

/** The GPU and Whisper on this computer, run once (Settings > Diagnostic) */
export interface LocalTest {
  gpu: { device?: string; name?: string; vram_gb?: number; cuda?: string; cudnn?: number; matmul_ms?: number; torch?: string; error?: string };
  whisper: { backend: "mlx" | "cuda" | "cpu"; backend_after?: string; model_ready?: boolean; load_seconds?: number; seconds?: number; realtime?: number; error?: string };
  /** The model that tells speakers apart */
  voices?: { load_seconds?: number; seconds?: number; dim?: number; error?: string };
}

export async function runLocalTest(): Promise<LocalTest> {
  const res = await fetch(`${BASE}/diagnostics/local-test`, { method: "POST" });
  return jsonOrThrow(res, "The test did not run");
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
  /** The favourite background music for each kind of video (kind -> track): what the AI takes first for a video of that kind */
  musics: Record<string, string>;
  /** The preferred intro (null: none): new compilations open with it, the AI takes it when it gives a video an intro */
  intro: string | null;
  /** When that intro is the hook: the look they like it framed with, by the name of a jingle (null: the app's default one) */
  intro_look?: string | null;
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
  /** Still being recorded: the streamer is live right now */
  recording?: boolean;
  /** Existing analysis of this VOD, if any */
  job: {
    id: string;
    status: string;
    progress: string | null;
    clip_count: number;
    /** Videos the AI proposed for it that nobody has opened yet, and whether it is looking for some right now */
    suggested?: number;
    looking?: boolean;
    /** Why it stopped, when it did */
    error?: string | null;
    notices?: JobNotice[];
    /** While analyzing: when it should be done */
    eta?: AnalysisEta | null;
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

/** Still frame of a clip (extracted and cached by the API); `version` changes when the clip's file does */
export function clipThumbUrl(jobId: string, filename: string, opts: { width?: 480 | 1280; time?: number; version?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.width) params.set("w", String(opts.width));
  if (opts.time !== undefined) params.set("t", opts.time.toFixed(1));
  if (opts.version) params.set("v", opts.version);
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
  /** A few words the clip can be found by (what happens, who is in it, the tone), and what is on screen said plainly */
  tags?: string[];
  seen?: string;
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
  /** "reading": the AI found it reading the whole live, not in the sound and chat peaks */
  found_by?: string;
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
  /** Its clips were deleted to free disk space (exports kept) */
  clips_freed_at: string | null;
  /** Videos the AI proposed for this live that nobody has opened yet */
  suggested: number;
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
  /** What happens there, in a sentence (recent analyses) */
  what?: string;
}

export interface JobTimeline {
  duration?: number;
  /** Voice energy, 0-1, evenly sampled across the live */
  energy?: number[];
  /** Chat messages per slice of the live */
  chat?: number[];
  candidates?: TimelineCandidate[];
  /** When the analysis started and should be done, unix seconds (worker's estimate) */
  eta?: AnalysisEta;
}

export interface ClipSelection {
  state?: "kept" | "passed";
  /** Trim bounds in clip seconds (with `segments`: the span they cover) */
  trim?: [number, number];
  /** The clip cut in several pieces played one after the other, clip seconds */
  segments?: [number, number][];
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
  /** Videos the AI proposed for this live that nobody has opened yet */
  suggested?: number;
  /** While analyzing: when it should be done */
  eta: AnalysisEta | null;
  /** Its clips were deleted to free disk space (exports kept) */
  clips_freed_at: string | null;
  /** Bytes freeing its clips would give back */
  clips_bytes: number;
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
  clipsFreedAt?: string | null;
  suggested?: number;
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
  eta?: AnalysisEta | null;
  clipsFreedAt?: string | null;
  clipsBytes?: number;
  suggested?: number;
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
    clips_freed_at: raw.clipsFreedAt ?? null,
    suggested: raw.suggested ?? 0,
  };
}

function mapJobSummary(raw: ServerJobSummary): JobSummary {
  return {
    eta: raw.eta ?? null,
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
    clips_freed_at: raw.clipsFreedAt ?? null,
    clips_bytes: raw.clipsBytes ?? 0,
    suggested: raw.suggested ?? 0,
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
/** A chat message posted while a clip runs (t: clip seconds) */
export interface ClipChatLine {
  t: number;
  author: string;
  text: string;
}

/** When the chat spoke in each clip of an analysis, by clip filename */
export async function getJobChat(jobId: string): Promise<Record<string, ClipChatLine[]>> {
  const res = await fetch(`${BASE}/jobs/${jobId}/chat`);
  const json = await jsonOrThrow<{ clips: Record<string, ClipChatLine[]> }>(res, "Failed to load the chat");
  return json.clips;
}

export async function updateSelection(
  jobId: string,
  clipFilename: string,
  patch: { state?: ClipSelection["state"] | null; trim?: [number, number] | null; segments?: [number, number][] | null },
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

export function clipUrl(jobId: string, filename: string, version?: string): string {
  return `${BASE}/clips/${jobId}/${filename}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/** What this computer can do (first launch): its card, how fast Whisper would run, the voice model's speed */
export interface MachineProfile {
  backend: "mlx" | "cuda" | "cpu";
  gpu: { name: string | null; vram_gb: number | null; tflops: number; error?: string };
  cpu: string;
  /** Times faster than real time Whisper would run here, null when it can't run locally */
  whisper_realtime: number | null;
  /** Seconds the voice model needs for one analysis */
  voices: { seconds: number | null; error?: string };
}

export async function getMachine(): Promise<MachineProfile> {
  return jsonOrThrow(await fetch(`${BASE}/machine`), "Failed to measure this computer");
}

/** Why a clip couldn't get longer: the live starts / ends there, or it couldn't be read */
export class ExtendError extends Error {
  constructor(readonly reason: "edge" | "unreachable" | "other", message: string) {
    super(message);
  }
}

/** 30 s more cut on one side of a clip (its file grows from the live when needed): the new cut */
export async function extendClip(jobId: string, filename: string, side: "start" | "end"): Promise<{ extended: boolean; trim: [number, number] }> {
  const res = await fetch(`${BASE}/clips/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}/extend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ExtendError(res.status === 409 ? "edge" : res.status === 502 ? "unreachable" : "other", json.error ?? "extend failed");
  return json;
}

// ── Disk space ───────────────────────────────────────────

export interface DiskUsage {
  /** Bytes in Cuttie's data folder */
  total: number;
  /** Free bytes on its disk */
  free: number | null;
  clips: number;
  exports: number;
  models: number;
  logs: number;
  other: number;
}

export interface DiskSpace {
  usage: DiskUsage;
  /** Clips of projects idle for this many days are freed by themselves (0 = never) */
  cleanup_days: number;
  /** What freeing the projects idle for 7, 30 or 90 days would give back */
  cleanable: Record<string, { projects: number; bytes: number }>;
}

export async function getDiskSpace(): Promise<DiskSpace> {
  return jsonOrThrow(await fetch(`${BASE}/disk`), "Failed to read disk space");
}

/** Turn the cleanup on (days) or off (0); it runs at once: the bytes it freed */
export async function setCleanupDays(days: number): Promise<{ cleanup_days: number; freed: number }> {
  return jsonOrThrow(
    await fetch(`${BASE}/disk/cleanup`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) }),
    "Failed to save the cleanup"
  );
}

/** Free now the clips of the projects idle for `days` */
export async function freeIdleProjects(days: number): Promise<{ projects: number; bytes: number }> {
  return jsonOrThrow(
    await fetch(`${BASE}/disk/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days }) }),
    "Failed to free the clips"
  );
}

/** Delete a project's clips to free disk space; its exports stay */
export async function freeProject(jobId: string): Promise<{ freed: number }> {
  return jsonOrThrow(await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}/free`, { method: "POST" }), "Failed to free the clips");
}

/** Why the clips couldn't come back: the live is gone from Twitch, or it couldn't be read */
export class RestoreError extends Error {
  constructor(readonly reason: "gone" | "failed", message: string) {
    super(message);
  }
}

/** Cut a freed project's clips again from the live (a minute or so) */
export async function restoreProject(jobId: string): Promise<{ restored: number; failed: number }> {
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}/restore`, { method: "POST" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RestoreError(res.status === 410 ? "gone" : "failed", json.error ?? "restore failed");
  return json;
}

// ── Journal (help from afar) ─────────────────────────────

export async function getLogsSize(): Promise<number> {
  return (await jsonOrThrow<{ bytes: number }>(await fetch(`${BASE}/logs`), "Failed to read the journal")).bytes;
}

export async function clearLogs(): Promise<{ freed: number; bytes: number }> {
  return jsonOrThrow(await fetch(`${BASE}/logs`, { method: "DELETE" }), "Failed to empty the journal");
}

/** The journal of the last `hours` (0 = all) as a .zip to send to whoever helps */
export async function exportLogs(hours: number, now = new Date()): Promise<{ blob: Blob; filename: string }> {
  // The journal's times are UTC: its zone tells what they were here
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await fetch(`${BASE}/logs/export?hours=${hours}&tz=${encodeURIComponent(zone)}`);
  if (!res.ok) throw new Error("Failed to export the journal");
  // Named at this computer's time (the API runs in UTC)
  const pad = (n: number) => String(n).padStart(2, "0");
  const filename = `cuttie-journal-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}h${pad(now.getMinutes())}.zip`;
  return { blob: await res.blob(), filename };
}

/** An error of this page, into the journal (never throws) */
export function reportClientError(entry: { kind: string; message: string; stack?: string; page?: string }): void {
  fetch(`${BASE}/client-log`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry), keepalive: true }).catch(() => {});
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

/** The words said in a clip, clip seconds (empty when it wasn't transcribed yet): cuts land between them */
export async function getClipWords(jobId: string, filename: string): Promise<TranscriptWord[]> {
  const res = await fetch(`${BASE}/clips/${jobId}/${encodeURIComponent(filename)}/words`);
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  return Array.isArray(json?.words) ? json.words : [];
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
    /** Somebody is in the cam in the part of this clip that gets exported */
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
  /** `emotes`: the emote names in a message (chats downloaded since they are kept) */
  chat_messages: { author: string; text: string; timestamp: number; emotes?: string[] }[];
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

/** A piece of a montage as the renderer takes it: `duration` seconds of `clip` from `from`, with its layers */
export interface MontageRenderPiece {
  clip: string;
  from: number;
  duration: number;
  layers: { layer: unknown; z: number }[];
  /** The live the clip is in, when it isn't the one the export is kept with */
  job?: string;
}

/**
 * Renders several pieces one after the other in one video (a clip cut in
 * pieces, a compilation). `key`: what the export stands for, a clip's filename
 * or comp_<id>.mp4.
 */
export async function startMontageRender(
  jobId: string,
  montage: { key: string; name?: string; pieces: MontageRenderPiece[]; overlays: { layer: unknown; z: number }[]; intro?: { style: string; title: string; name: string; logo: string | null; colors: BrandColors; font: string; sound?: string }; music?: { track: string; curve: { start: number; ramps: [number, number, number][] } } },
  renderOptions?: { width?: number; height?: number; fps?: number },
): Promise<string> {
  const res = await fetch(`${BASE}/jobs/${jobId}/montage-render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...montage, ...(renderOptions ? { render_options: renderOptions } : {}) }),
  });
  const json = await jsonOrThrow<{ render_id: string }>(res, "Render failed");
  return json.render_id;
}

/** What the AI chose for the sound of a video: its kind, its music and its intro (null: none), and why */
export interface SoundChoice {
  kind: string | null;
  music: string | null;
  intro: string | null;
  /** The passage the video could open on as a teaser: its place among the passages the AI was told (`said`), from 1 */
  teaser?: number | null;
  /** How its passages follow each other: a ready-made transition, or "cut" (null: it did not say) */
  transition?: string | null;
  /** When the intro is the hook: the look that frames it, by the name of a jingle */
  look?: string | null;
  why: string;
  cost: number;
}

/** The AI says what kind of video this is and chooses its music and its intro, starting from the streamer's favourites */
export async function chooseSound(
  jobId: string,
  // `compilation`: the video being decided (its own intro doesn't count among those the streamer's last videos open with)
  // `universe`: the look of a game the video is dressed in (null: the channel's own: the AI is not told about that game's graphics)
  body: { title: string; parts: string[]; seconds: number; passages: number; said: string[]; lengths?: number[]; asked?: string; language?: string; compilation?: string; universe?: string | null },
): Promise<SoundChoice> {
  return liveJson(await postJson(`${BASE}/jobs/${jobId}/sound`, body));
}

/**
 * A note the streamer wrote for the AI (Ma chaîne): what it should know about them, the people around them and
 * their games. The AI reads the notes whenever it analyses a live, searches it or builds a video.
 */
export interface AiNote {
  id: string;
  title: string;
  /** The games it is about, as Twitch names them (none: it is given for every live) */
  games: string[];
  body: string;
  updated_at: string;
}

type AiNoteFields = Pick<AiNote, "title" | "games" | "body">;

/** Every note, and how much can be written (how many notes, how long each) */
export async function listNotes(): Promise<{ notes: AiNote[]; max: number; max_chars: number }> {
  return jsonOrThrow(await fetch(`${BASE}/notes`), "Failed to load the notes");
}

export async function createNote(fields: AiNoteFields): Promise<AiNote> {
  const res = await fetch(`${BASE}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  return (await jsonOrThrow<{ note: AiNote }>(res, "Failed to save the note")).note;
}

export async function saveNote(id: string, fields: AiNoteFields): Promise<AiNote> {
  const res = await fetch(`${BASE}/notes/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
  return (await jsonOrThrow<{ note: AiNote }>(res, "Failed to save the note")).note;
}

export async function deleteNote(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/notes/${encodeURIComponent(id)}`, { method: "DELETE" }), "Failed to remove the note");
}

/** The sections of what the AI remembers of the streamer (written by the AI after each live, see `getMemory`) */
export const MEMORY_SECTIONS = ["who", "games", "people", "stories", "tastes"] as const;
export type MemorySection = (typeof MEMORY_SECTIONS)[number];

/** What the AI noted of one live it read */
export interface MemoryLive {
  job: string;
  title: string;
  game: string;
  /** The day of the live, YYYY-MM-DD */
  date: string;
  duration: number;
  summary: string;
  /** What happened that matters later, in the order of the live (each may start with its time) */
  events: string[];
  people: { name: string; who: string }[];
  /** What the streamer said about themselves */
  said: string[];
  games: string[];
  /** Read from its transcript, or only from what the analysis kept of it */
  source: "transcript" | "analysis";
  read_at: string;
  cost: number;
}

/** A sentence of one of the streamer's notes that their lives contradict, and what the AI would write instead */
export interface NoteProposal {
  id: string;
  note: string;
  note_title: string;
  before: string;
  after: string;
  /** What the AI saw, said to the streamer */
  why: string;
  job: string;
  at: string;
}

/** The lives analysed before being read into the memory, one after the other */
export interface MemoryReading {
  total: number;
  done: number;
  /** The live being read */
  title: string;
  cost: number;
  failed: number;
  stopping: boolean;
}

/** How the last such reading ended */
export interface MemoryReadingResult {
  read: number;
  failed: number;
  cost: number;
  /** What stopped it before the end */
  stopped?: "credits" | "key" | "unreachable" | "asked";
  at: string;
}

/**
 * What the AI remembers of the streamer from one live to the next (Ma chaîne, « Mémoire »): it writes it itself
 * after each analysis, and the streamer may correct it. With the lives it read, those that wait, and the
 * corrections it proposes for the streamer's own notes.
 */
export interface AiMemory {
  sections: Record<MemorySection, string>;
  updated_at: string | null;
  /** The streamer stopped the AI from reading each live once analysed */
  paused: boolean;
  /** The lives read, the latest first */
  lives: MemoryLive[];
  /** Analysed lives not read yet, the oldest first, and about what reading them costs (dollars) */
  unread: { id: string; title: string; date: string | null; game: string | null; duration: number }[];
  cost: number;
  reading: MemoryReading | null;
  last: MemoryReadingResult | null;
  proposals: NoteProposal[];
}

export async function getMemory(): Promise<AiMemory> {
  return jsonOrThrow(await fetch(`${BASE}/memory`), "Failed to load the memory");
}

/** The streamer corrects sections of the memory, or pauses it */
export async function saveMemory(patch: { sections?: Partial<Record<MemorySection, string>>; paused?: boolean }): Promise<Pick<AiMemory, "sections" | "updated_at" | "paused">> {
  const res = await fetch(`${BASE}/memory`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  return jsonOrThrow(res, "Failed to save the memory");
}

/** Everything the AI remembers is thrown away */
export async function clearMemory(): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/memory`, { method: "DELETE" }), "Failed to clear the memory");
}

/** The AI reads the lives analysed before, the oldest first (about a cent each): what it is at */
export async function readLivesIntoMemory(): Promise<MemoryReading> {
  return (await jsonOrThrow<{ reading: MemoryReading }>(await fetch(`${BASE}/memory/read`, { method: "POST" }), "Failed to read the lives")).reading;
}

/** Stop after the live being read */
export async function stopReadingLives(): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/memory/read`, { method: "DELETE" }), "Failed to stop");
}

/** The corrections of the streamer's notes that wait for their answer */
export async function listNoteProposals(): Promise<NoteProposal[]> {
  return (await jsonOrThrow<{ proposals: NoteProposal[] }>(await fetch(`${BASE}/memory/proposals`), "Failed to load the proposals")).proposals;
}

/** The note is changed as proposed (throws "note_changed" when it no longer says that) */
export async function applyNoteProposal(id: string): Promise<AiNote> {
  const res = await fetch(`${BASE}/memory/proposals/${encodeURIComponent(id)}/apply`, { method: "POST" });
  return (await jsonOrThrow<{ note: AiNote }>(res, "Failed to change the note")).note;
}

/** Refused: that sentence is not brought up again */
export async function ignoreNoteProposal(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/memory/proposals/${encodeURIComponent(id)}`, { method: "DELETE" }), "Failed to ignore the proposal");
}

/** The background musics that can be played on this machine: those that ship (whose file is there), then the streamer's own */
export async function listMusics(): Promise<MusicTrack[]> {
  const json = await jsonOrThrow<{ musics: (MusicTrack & { available: boolean })[] }>(await fetch(`${BASE}/musics`), "Failed to load the musics");
  return json.musics.filter((music) => music.available).map(({ available: _available, ...track }) => track);
}

/**
 * The streamer adds a track of their own: the AI listens to it and says what it is for
 * (`heard` false: it could not; `why`: "credits", "key" or "failed"). The track is there either way.
 */
export async function addMusic(file: File, language: string): Promise<{ music: MusicTrack; heard: boolean; why: string | null }> {
  const body = new FormData();
  body.append("file", file);
  body.append("language", language);
  return liveJson(await fetch(`${BASE}/musics`, { method: "POST", body }));
}

/**
 * The streamer corrects what one of their tracks is. `start`: about where its strong moment is
 * (seconds, by ear): the attack nearest to it is kept; `build`: the track builds up to that moment.
 */
export async function updateMusic(id: string, patch: { name?: string; kinds?: string[]; description?: string; start?: number; build?: boolean; universes?: string[] }): Promise<MusicTrack> {
  const res = await fetch(`${BASE}/musics/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  return (await jsonOrThrow<{ music: MusicTrack }>(res, "Failed to save the music")).music;
}

export async function deleteMusic(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/musics/${encodeURIComponent(id)}`, { method: "DELETE" }), "Failed to remove the music");
}

/**
 * A video of the streamer's media library: a short video of their own (an outro, a meme, something
 * filmed on a phone) that a video can take as a passage, like a moment of a live.
 */
export interface MediaItem {
  id: string;
  name: string;
  seconds: number;
  width: number;
  height: number;
  size: number;
  added_at: string;
  /** Somebody speaks in it (null: nobody listened to it yet) */
  spoken: boolean | null;
}

/** Why a file was not taken into the library */
export type MediaRefusal = "not_video" | "too_long" | "full" | "failed";
export class MediaError extends Error {
  constructor(
    readonly reason: MediaRefusal,
    /** The longest a video can be, seconds (said with "too_long") */
    readonly longest?: number,
  ) {
    super(reason);
  }
}

/** The videos of the library, the newest first, and the longest one it takes (seconds) */
export async function listMedia(): Promise<{ media: MediaItem[]; longest: number; max: number }> {
  return jsonOrThrow(await fetch(`${BASE}/media`), "Failed to load the media library");
}

/** A video joins the library: brought to what the montage plays, then listened to (MediaError when it is refused) */
export async function addMedia(file: File): Promise<MediaItem> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(`${BASE}/media`, { method: "POST", body });
  if (res.ok) return ((await res.json()) as { media: MediaItem }).media;
  const said = await res.json().catch(() => null);
  throw new MediaError(["not_video", "too_long", "full"].includes(said?.error) ? said.error : "failed", typeof said?.longest === "number" ? said.longest : undefined);
}

export async function renameMedia(id: string, name: string): Promise<MediaItem> {
  const res = await fetch(`${BASE}/media/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  return (await jsonOrThrow<{ media: MediaItem }>(res, "Failed to rename the video")).media;
}

export async function deleteMedia(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/media/${encodeURIComponent(id)}`, { method: "DELETE" }), "Failed to remove the video");
}

export const mediaFileUrl = (id: string) => `${BASE}/media/${encodeURIComponent(id)}/file`;
export const mediaThumbUrl = (id: string) => `${BASE}/media/${encodeURIComponent(id)}/thumb`;

/** How loud a live's clips are (LUFS), null when nothing could be measured: what the preview sets the music against */
export async function liveLoudness(jobId: string): Promise<number | null> {
  const json = await jsonOrThrow<{ lufs: number | null }>(await fetch(`${BASE}/jobs/${jobId}/loudness`), "Failed to measure the live");
  return json.lufs;
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

// ── Searching the live, compilations ─────────────────────

/** A moment of the live that matches a search, live seconds */
export interface LiveHit {
  start: number;
  end: number;
  /** "voice" (said), "chat" (written), "ai" (the AI read it) */
  sources: string[];
  /** What is said there, and just before / after */
  text: string;
  before: string;
  after: string;
  /** Chat messages that match, "author: text" */
  chat: string[];
  /** The AI's reason, and how sure it is (0-1) */
  why: string;
  score: number;
  /**
   * Words that are said, at the times the live's transcript gives them (rough when it has lines
   * only): once the moment has its clip, it is cut on where they really are
   */
  spoken?: boolean;
  /** A change asked to the AI: this moment is one of the video's, given back with other lines (tighter, longer) */
  recut?: boolean;
  /** The live it is in, when several are worked on at once and it isn't the compilation's own */
  job?: string;
  /** A planned video: the moment the AI would open it on, as a teaser of what is coming */
  opening?: boolean;
}

export interface LiveSearchResult {
  hits: LiveHit[];
  total: number;
  /** The live was transcribed (else only the chat is searched) */
  transcript: boolean;
  /** AI searches: answered from the disk (free), dollars spent otherwise */
  cached?: boolean;
  cost?: number;
  /** AI searches: what it looked for and how sure it is, in its words */
  note?: string;
}

export interface LiveSearchInfo {
  transcript: boolean;
  chat: number;
  /** About what asking the AI costs, dollars (null: nothing to read), and a whole video planned */
  ai_cost: number | null;
  plan_cost?: number | null;
  /** The most a question can cost: the AI stops there and answers with what it has */
  max_cost?: number | null;
  /** The live was listened to: its sounds can be searched (else the first question does it, a few minutes) */
  sounds?: boolean;
  /** Development: another model answers, nothing is billed */
  dev?: boolean;
}

/** What the AI searching the live is doing: the tool it called (`step`), on what (`detail`: words, a kind of sound, a time) */
export interface LiveSearchStep {
  step: string;
  detail: string;
  /** How many steps it has made */
  count: number;
}

export type LiveFailure = "no_transcript" | "credits" | "key" | "live_gone" | "unreachable" | "failed";

/** A search, a plan or a cut from the live that couldn't be done, and why */
export class LiveError extends Error {
  constructor(readonly reason: LiveFailure) {
    super(reason);
  }
}

const LIVE_FAILURES: LiveFailure[] = ["no_transcript", "credits", "key", "live_gone", "unreachable", "failed"];

async function liveJson<T>(res: Response): Promise<T> {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => null);
  throw new LiveError(LIVE_FAILURES.includes(body?.error) ? body.error : "failed");
}

const postJson = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export async function getLiveSearchInfo(jobId: string): Promise<LiveSearchInfo> {
  return liveJson(await fetch(`${BASE}/jobs/${jobId}/search/info`));
}

/** What the AI is doing while a search or a plan is awaited (null: nothing being searched, or the engine is away) */
export async function getLiveSearchProgress(jobId: string): Promise<LiveSearchStep | null> {
  try {
    const res = await fetch(`${BASE}/jobs/${jobId}/search/progress`);
    return res.ok ? ((await res.json()).doing ?? null) : null;
  } catch {
    return null;
  }
}

/** Moments of the live that match: "words" looks for what is said or written (free), "ai" has the AI search the live and check what it finds */
export async function searchLive(jobId: string, query: string, mode: "words" | "ai", fresh = false): Promise<LiveSearchResult> {
  // `fresh`: asked again on purpose, the AI searches anew instead of giving the answer it kept
  return liveJson(await postJson(`${BASE}/jobs/${jobId}/search`, { query, mode, ...(fresh ? { fresh: true } : {}) }));
}

export interface VideoPlan {
  title: string;
  sections: { title: string; hits: LiveHit[] }[];
  cached?: boolean;
  cost?: number;
  /** What the AI found for each part and what is missing, in its words */
  note?: string;
  /** What the description asks about the look (layout, webcam, captions), in the streamer's words; empty when nothing */
  look?: string;
  /** What is written on screen over the first seconds of the video, as the AI wrote it */
  hook?: string;
  /** Lasting tastes the streamer stated while asking, that the AI just noted in its memory for their next videos */
  remembered?: string[];
}

/** A whole video planned by the AI from a description, `target` seconds long */
export async function planLiveVideo(jobId: string, brief: string, target: number, change?: PlanChange, lives: string[] = [], leads: number[] = [], fresh = false, source?: string): Promise<VideoPlan> {
  // `lives`: other lives the video may take passages from (the AI works on all of them at once)
  // `leads`: the moments already spotted for it (live seconds), when the video is one the AI proposed
  // `fresh`: the same description asked again on purpose: the AI plans anew instead of giving the plan it kept
  // `source`: what is being built (a clip, a sequence, a compilation: see lib/videoSources.ts), told to the AI before the streamer's words
  const body = { brief, target, ...(change ?? {}), ...(lives.length > 0 ? { lives } : {}), ...(leads.length > 0 ? { leads } : {}), ...(fresh ? { fresh: true } : {}), ...(source ? { source } : {}) };
  const plan = await liveJson<VideoPlan>(await postJson(`${BASE}/jobs/${jobId}/plan`, body));
  // A passage says its live only when it isn't this one
  return { ...plan, sections: plan.sections.map((s) => ({ ...s, hits: s.hits.map(({ job, ...hit }) => (job && job !== jobId ? { ...hit, job } : hit)) })) };
}

/** Where a moment's clip stands: cut from the live (with room around the moment) or not yet */
export interface PieceState {
  ready: boolean;
  file: string;
  /** Where the clip sits in the live, seconds (null: not cut yet) */
  file_start: number | null;
  file_end: number | null;
}

/** A moment of the live in a compilation, [start, end] in live seconds */
export interface CompilationItem extends Partial<PieceState> {
  id: string;
  start: number;
  end: number;
  text: string;
  why: string;
  sources: string[];
  /** Its own template key, when it isn't shown like the rest of the video */
  template?: string | null;
  /**
   * The lines of the live's transcript it is made of (live seconds), while it still has their rough
   * times: once its clip is cut, the moment is set on where those words are really said
   */
  fit?: [number, number];
  /** How well it matches what was asked, when the AI found it (0-1) */
  score?: number;
  /** The live it is cut from, when it isn't the compilation's own (one of its `lives`): its times and its clip are that live's */
  job?: string;
  /** How it comes in when that isn't as the rest of the video does: a ready-made transition (see transitions.ts), or "cut" (none) */
  transition?: string;
  /** The AI named it as the moment the video can open on (what a "hook" intro plays first unless the streamer chose another) */
  opening?: boolean;
  /** The passage it was made out of (cut in two, its silences taken out): that one's clip does for it until it has its own (not kept by the server) */
  like?: string;
  /**
   * A video of the streamer's media library (see MediaItem), not a moment of a live: its times are
   * that video's own seconds, its clip is that video's file. Never with `job`.
   */
  media?: string;
}

/** A template as the AI is told about it (see templateGuide.ts) */
export interface LookTemplate {
  key: string;
  name: string;
  description: string;
  needs_cam: boolean;
}

/** The templates the AI chose for the passages of a video */
export interface LooksChoice {
  /** The template most passages use */
  main: string;
  /** Each passage's template, by passage id */
  looks: Record<string, string>;
  /** Why, in a few words, by passage id */
  reasons: Record<string, string>;
  note: string;
  cost: number;
}

/** The AI looks at each passage (its clip must be cut) and chooses its template among `templates` */
export async function chooseLooks(
  jobId: string,
  body: {
    items: Pick<CompilationItem, "id" | "start" | "end" | "text" | "job">[];
    templates: LookTemplate[];
    /** What the streamer asked about the look, in their words */
    wish?: string;
    /** The template they use when they ask for nothing */
    usual?: string;
    language?: string;
  },
): Promise<LooksChoice> {
  return liveJson(await postJson(`${BASE}/jobs/${jobId}/looks`, body));
}

/** What a template of the streamer's own is good for, written by the AI from the description the app makes of it */
export async function writeTemplateUsage(body: { name: string; description: string; language?: string }): Promise<{ usage: string; cost: number }> {
  return liveJson(await postJson(`${BASE}/brand-kit/template-usage`, body));
}

export interface CompilationSection {
  id: string;
  /** Shown on screen when the section starts */
  title: string;
  /** Its title is only a name for the streamer: not written in the video */
  hidden?: boolean;
  /** The search its moments came from */
  query: string;
  items: CompilationItem[];
}

/** A video made of pieces of the live */
export interface Compilation {
  id: string;
  name: string;
  sections: CompilationSection[];
  /** Template key (null: the channel's default) */
  template: string | null;
  /** Each section's title on screen when it starts (else the hook line, once) */
  titles: boolean;
  hook: string;
  /** Length aimed for, seconds */
  target: number | null;
  /** The ready-made transition between its passages (absent: plain cuts) */
  transition?: string;
  /** The jingle it opens with (absent: none): its style, its own title (else the video's name), its sound (else its style's; "none": silent) */
  intro?: { style: string; title?: string; sound?: string; follow?: boolean; by?: "ai"; hook?: HookChoice; look?: string };
  /** The music it plays in the background (absent: none): a track of the catalogue, and how present it is (1: as Cuttie sets it) */
  music?: { track: string; volume?: number };
  /** Described to the AI: what was first asked for, then each change asked and what the AI answered */
  brief?: string;
  /** What the AI answered to the description: what it built and why */
  answer?: string;
  asks?: { ask: string; note: string; added?: number; removed?: number; recut?: number; remembered?: string[] }[];
  /** Other lives it takes passages from, besides the one it is kept with (job ids) */
  lives?: string[];
  /** How much its picture moves on what is said: "light" or "strong" (see lib/effects.ts; absent: it plays plain) */
  effects?: string;
  /** The Twitch chat written over its passages: "on" (every passage), "off" (none); absent: as each template does */
  chat?: string;
  /** What it is made from: a clip, a sequence or a compilation (see lib/videoSources.ts; absent: a compilation) */
  source?: string;
  /** The clip of the analysis it was opened from (a clip video only) */
  clip?: string;
  /** The look of a game it is dressed in instead of the channel's own (see lib/universes.ts; absent: the channel's) */
  universe?: string;
  /** How its titles are written (the titles of its parts, its hook line): one of the template editor's ways (absent: as its template writes them) */
  titleStyle?: string;
  /** The AI proposed this video on its own once the live was analysed: `brief` is the request it wrote in the streamer's place */
  suggestion?: CompilationSuggestion;
  /** An idea of the AI the streamer passed on: it stays in the live's list, dimmed, and can be taken back */
  passed?: boolean;
  created_at: string;
  updated_at: string;
}

/** What the AI saw in a live that makes a video it proposes */
export interface CompilationSuggestion {
  key: string;
  /** One sentence said to the streamer: what it noticed */
  pitch: string;
  tags: string[];
  /** The kind of video: funny, skill, suspense, chill, hype */
  kind?: string;
  /** 0-100: how well it should do as a short */
  score: number;
  /** The moments it spotted for it (live seconds): where the video is built from */
  moments: number[];
  /** A sequence (a stretch of the live in a row, retold as one video): where it starts and ends, live seconds */
  span?: [number, number];
}

/** What the AI looking through a live for videos to propose gave */
export interface SuggestionsFound {
  /** The videos just proposed, waiting to be built (none: nothing new) */
  compilations: Compilation[];
  /** Ideas it had in all, those already proposed included */
  found: number;
  note: string;
  cost: number;
  cached: boolean;
}

/** Has the AI look through an analysed live for compilations worth making (under a cent; asked again, it costs nothing) */
export async function findSuggestions(jobId: string): Promise<SuggestionsFound> {
  return liveJson<SuggestionsFound>(await postJson(`${BASE}/jobs/${jobId}/suggestions`, {}));
}

/** How many proposed videos of a live wait to be opened, and whether the AI is looking for some right now */
export async function getSuggestions(jobId: string): Promise<{ suggested: number; looking: boolean; looked_at: string | null }> {
  return jsonOrThrow(await fetch(`${BASE}/jobs/${jobId}/suggestions`), "Failed to load the suggestions");
}

export type CompilationDraft = Pick<Compilation, "name" | "sections" | "template" | "titles" | "hook" | "target" | "brief" | "answer" | "asks" | "lives" | "source">;

/** A change asked on a video the AI planned: what is asked now, the video as it is (live seconds), what was asked before */
export interface PlanChange {
  request: string;
  current: { title: string; items: { start: number; end: number; job?: string }[] }[];
  asks: string[];
}

export async function listCompilations(jobId: string): Promise<Compilation[]> {
  const json = await jsonOrThrow<{ compilations: Compilation[] }>(await fetch(`${BASE}/jobs/${jobId}/compilations`), "Failed to load the compilations");
  return json.compilations;
}

export async function createCompilation(jobId: string, draft: Partial<CompilationDraft> = {}): Promise<Compilation> {
  const json = await jsonOrThrow<{ compilation: Compilation }>(await postJson(`${BASE}/jobs/${jobId}/compilations`, draft), "Failed to create the compilation");
  return json.compilation;
}

/** A clip of the analysis opened as a video like any other (the same one comes back when it was opened before) */
export async function openClipVideo(jobId: string, clip: string): Promise<Compilation> {
  const json = await jsonOrThrow<{ compilation: Compilation }>(await postJson(`${BASE}/jobs/${jobId}/compilations/from-clip`, { clip }), "Failed to open the clip");
  return json.compilation;
}

export async function saveCompilation(jobId: string, compilation: Compilation): Promise<Compilation> {
  const res = await postJson(`${BASE}/jobs/${jobId}/compilations/${compilation.id}`, compilation, "PUT");
  const json = await jsonOrThrow<{ compilation: Compilation }>(res, "Failed to save the compilation");
  return json.compilation;
}

/** A compilation joined into one clip, to open it in the layer editor: the clip, its length, where each passage starts in it (seconds) */
export interface FlatCompilation {
  clip: string;
  duration: number;
  /** Just made (false: the compilation had not changed since it was) */
  fresh: boolean;
  starts: number[];
}

/** Joins the passages of a compilation, as it is saved, into one clip with their words and chat (a few seconds for a minute of video) */
export async function flattenCompilation(jobId: string, compilationId: string): Promise<FlatCompilation> {
  const res = await postJson(`${BASE}/jobs/${jobId}/compilations/${compilationId}/flatten`, {});
  return jsonOrThrow<FlatCompilation>(res, "Failed to prepare the video for the editor");
}

/** The clip a compilation was joined into: flat_<compilation>_<signature>.mp4 */
export const flatCompilationId = (clip: string): string | null => clip.match(/^flat_([a-z0-9]{10})_[a-f0-9]{8}\.mp4$/)?.[1] ?? null;

/** A compilation as a card shows it */
/** A clip the analysis found that nobody opened as a video yet: what the library shows of it */
export interface LiveClip {
  filename: string;
  name: string;
  /** 0-100 */
  score: number;
  /** Where it is in the live, seconds */
  at: number;
  /** Seconds of its advised cut */
  length: number;
  /** Its title, what is on screen said plainly, the words to find it by */
  pitch: string;
  seen: string;
  tags: string[];
  category: string | null;
  /** "reading" / "watching": how the analysis came to it, when not by the sound and the chat */
  found_by: string | null;
  /** Kept or passed in Choisir, when the streamer said */
  state: "kept" | "passed" | null;
}

export interface CompilationSummary {
  id: string;
  name: string;
  /** What it is made from: "clip", "sequence" or "compilation" */
  source?: string;
  /** Seconds */
  length: number;
  passages: number;
  parts: number;
  /** Built by describing it to the AI */
  described: boolean;
  /** Proposed by the AI: what it saw in the live (how many moments), null when the streamer made it */
  suggestion?: { pitch: string; tags: string[]; kind: string | null; score: number; moments: number; span?: [number, number] | null } | null;
  /** Proposed and not built yet: opening it builds it */
  waiting?: boolean;
  /** An idea the streamer passed on */
  passed?: boolean;
  /** Length aimed for, seconds */
  target?: number | null;
  /** A passage's clip that stands for it (null: none is cut yet), and the live that clip is in */
  cover: string | null;
  cover_job: string | null;
  /** The live it is kept with: where it opens, is saved, exported */
  home: string;
  /** Every live it takes passages from, that one first: the library lists it with each of them */
  lives: string[];
  created_at: string;
  updated_at: string;
  /** Its last finished export */
  exported_at: string | null;
  render_id: string | null;
}

/** An analysed live and its compilations */
export interface LiveCompilations {
  job_id: string;
  title: string | null;
  streamer: string | null;
  game: string | null;
  duration: number | null;
  stream_date: string | null;
  created_at: string | null;
  vod_id: string | null;
  cover_clip: string | null;
  clips_freed: boolean;
  /** When the AI looked through it for videos to propose (null: never), and whether it is doing so now */
  looked_at?: string | null;
  looking?: boolean;
  compilations: CompilationSummary[];
  /** The analysis' clips not opened as a video yet, the best first */
  clips?: LiveClip[];
}

/** Every analysed live with its compilations (`jobId`: that live only) */
export async function listAllCompilations(jobId?: string): Promise<LiveCompilations[]> {
  const json = await jsonOrThrow<{ lives: LiveCompilations[] }>(await fetch(`${BASE}/compilations${jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""}`), "Failed to load the compilations");
  return json.lives;
}

/** A copy of a compilation, with clips of its own */
export async function duplicateCompilation(jobId: string, compilationId: string, name: string): Promise<Compilation> {
  const json = await jsonOrThrow<{ compilation: Compilation }>(await postJson(`${BASE}/jobs/${jobId}/compilations/${compilationId}/duplicate`, { name }), "Failed to duplicate the compilation");
  return json.compilation;
}

export async function deleteCompilation(jobId: string, compilationId: string): Promise<void> {
  await jsonOrThrow(await fetch(`${BASE}/jobs/${jobId}/compilations/${compilationId}`, { method: "DELETE" }), "Failed to delete the compilation");
}

/**
 * Makes sure each moment (live seconds) has its clip, cutting it from the live when needed. A
 * moment sent with `fit` (the lines of the transcript it is made of) comes back with `tight`:
 * where those words are really said, null when they are not found in the clip.
 */
export async function ensurePieces(
  jobId: string,
  // (`like`: the passage it was made out of — cut in two, its silences taken out: the same file does when it covers it;
  // `media`: a video of the media library: its file is put there, nothing is cut from the live)
  pieces: { id: string; start: number; end: number; fit?: [number, number]; like?: string; media?: string }[],
): Promise<{ pieces: (PieceState & { id: string; tight?: [number, number] | null })[]; failed: string[] }> {
  return liveJson(await postJson(`${BASE}/jobs/${jobId}/pieces`, { pieces }));
}

/** The parts of a clip the AI would keep for a tight video (clip seconds); nothing is saved */
/** `target`: the length aimed for, seconds (none: left to the AI, which keeps 45 s to 1 min 30) */
export async function suggestClipCut(
  jobId: string,
  filename: string,
  // (for a passage of a video — `filename` is then its piece — `within`: the part of its file it plays, clip seconds,
  // the only one the AI cuts; `summary`: what is said in it)
  { wish = "", target = null, within, summary }: { wish?: string; target?: number | null; within?: [number, number]; summary?: string } = {},
): Promise<{ parts: [number, number][]; note: string; cost: number; origin?: number }> {
  // (`origin`: where the clip's file starts in the live, seconds: what places its parts in the live)
  return liveJson(await postJson(`${BASE}/clips/${jobId}/${encodeURIComponent(filename)}/suggest-cut`, { wish, ...(target ? { target } : {}), ...(within ? { within } : {}), ...(summary ? { summary } : {}) }));
}

// ── The assistant ───────────────────────────────────────

/** A video the assistant shows: what its card draws */
export interface AssistantVideo {
  id: string;
  job: string;
  name: string;
  source: "clip" | "sequence" | "compilation";
  seconds: number;
  passages: number;
  /** An idea of the AI nobody built, a video in the making, or one that was exported */
  state: "idea" | "draft" | "exported";
  score?: number;
  pitch?: string;
  /** One of its passages' clip, for its picture */
  cover?: string;
  cover_job?: string;
}
export interface AssistantClip {
  job: string;
  filename: string;
  name: string;
  score: number;
  /** Where it is in the live, and how long its cut is (seconds) */
  at: number;
  length: number;
  seen: string;
  tags: string[];
  state: "kept" | "passed" | null;
}
export interface AssistantLive {
  job?: string;
  analysed: boolean;
  title: string;
  date: string | null;
  vod?: string;
  game?: string;
}
/** A passage of a live the assistant found: a search's hit, with its live */
export type AssistantPassage = Partial<LiveHit> & { job: string; start: number; end: number; text: string; id?: string; vod_id?: string | null };

export type AssistantBlock =
  | { type: "text"; text: string }
  | { type: "widget"; kind: "videos"; items: AssistantVideo[] }
  | { type: "widget"; kind: "clips"; items: AssistantClip[] }
  | { type: "widget"; kind: "lives"; items: AssistantLive[] }
  | { type: "widget"; kind: "passages"; items: AssistantPassage[] };

/** What the assistant waits for: something the page does (`app`), or the streamer's yes (`approval`) */
export interface AssistantAction {
  call: string;
  name: string;
  args: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  needs: "app" | "approval";
}

export type AssistantFailure = "credits" | "key" | "unreachable" | "dev" | "nothing_waiting" | "failed";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  at: string;
  /** What the streamer said, and where they were in the app */
  text?: string;
  where?: string[];
  reply?: AssistantBlock[];
  /** What it did to answer, a line each */
  steps?: string[];
  cost?: number;
  action?: AssistantAction | null;
  failed?: AssistantFailure;
}

/** Where the streamer is in the app when they speak to the assistant */
export interface AssistantPlace {
  page: string;
  job?: string;
  title?: string;
  video?: { id: string; name: string; source: string };
  clip?: { filename: string; name: string };
  passage?: { id: string; start: number; end: number; text: string };
  /** What stands on that page, in a few numbers and words (clips left to sort, ideas that wait, what a video lacks): what it offers to do is read from them */
  facts?: Record<string, string | number | boolean | null>;
}

export async function getAssistant(): Promise<{ messages: AssistantMessage[]; busy: boolean }> {
  return jsonOrThrow(await fetch(`${BASE}/assistant`), "Failed to load the conversation");
}

/** The assistant is already answering (another request of this conversation is on its way) */
export class AssistantBusy extends Error {}

/**
 * One request of the conversation: what the streamer says (`text`), or the answer to what the
 * assistant waits for (`resume`). Answers once it is done or waits again; `changed`: the lives
 * its work changed on the app's side.
 */
export async function assistantTurn(body: { text?: string; resume?: { call: string; result: unknown }; context: AssistantPlace | null; language: string }): Promise<{ message: AssistantMessage; said?: AssistantMessage; changed: string[] }> {
  const res = await postJson(`${BASE}/assistant/turn`, body);
  if (res.status === 409) {
    const why = (await res.json().catch(() => null))?.error;
    if (why === "busy") throw new AssistantBusy();
    throw new Error("nothing_waiting");
  }
  return jsonOrThrow(res, "The assistant did not answer");
}

export async function assistantProgress(): Promise<{ steps: string[]; running: boolean; sub?: LiveSearchStep | null }> {
  const res = await fetch(`${BASE}/assistant/progress`);
  return res.ok ? res.json() : { steps: [], running: false };
}

/** A new conversation: what was said is forgotten */
export async function resetAssistant(): Promise<void> {
  const res = await fetch(`${BASE}/assistant`, { method: "DELETE" });
  if (res.status === 409) throw new AssistantBusy();
  await jsonOrThrow(res, "Failed to start a new conversation");
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
