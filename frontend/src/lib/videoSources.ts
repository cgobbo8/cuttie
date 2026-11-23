/**
 * What a video is made from. There are three sources, at the same level:
 * - a clip: one moment of a live, about a minute;
 * - a sequence: a stretch of a live in a row (a mission, a situation that lasts), retold as one video;
 * - a compilation: passages from all over a live, or from several lives.
 * After its source a video is the same thing whatever it is made from: passages, a dressing
 * (layout, titles, effects, intro, music), an export. Only a compilation takes from several lives.
 * (The server knows the same three: api/app/services/compilations.ts, VIDEO_SOURCES.)
 */
export type VideoSource = "clip" | "sequence" | "compilation";
export const VIDEO_SOURCES: VideoSource[] = ["clip", "sequence", "compilation"];
export const isVideoSource = (value: unknown): value is VideoSource => typeof value === "string" && (VIDEO_SOURCES as string[]).includes(value);

/** What a video is made from: said on it, else a stretch of the live the AI proposed is a sequence, anything else a compilation */
export const sourceOf = (video: { source?: string | null; suggestion?: { span?: unknown } | null } | null | undefined): VideoSource =>
  isVideoSource(video?.source) ? video.source : video?.suggestion?.span ? "sequence" : "compilation";

/** The length a new video aims for when nothing is said (seconds): a clip is a moment, a sequence a short story */
export const SOURCE_TARGET: Record<VideoSource, number> = { clip: 45, sequence: 75, compilation: 90 };
