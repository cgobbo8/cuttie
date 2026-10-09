import { clipBackgroundUrl, clipUrl, type BrandKit, type EditEnvironment } from "./api";
import type { ChatMessage } from "./editorTypes";
import type { Rect, TemplateContext } from "./templates";

/** Chat bots that would only add noise on screen */
const BOTS = new Set([
  "nightbot",
  "streamelements",
  "streamlabs",
  "moobot",
  "fossabot",
  "wizebot",
  "sery_bot",
  "soundalerts",
  "kofistreambot",
  "botrixoficial",
  "pokemoncommunitygame",
  "streamstickers",
]);
const MAX_CHARS = 90;

/** The chat worth showing in a clip: no commands (!clip), bots or links, long messages cut */
export function chatForClip(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((m) => ({ ...m, text: m.text.trim() }))
    .filter((m) => m.text && !/^[!/]/.test(m.text) && !BOTS.has(m.author.toLowerCase()) && !/https?:\/\/|www\./i.test(m.text))
    .map((m) => (m.text.length > MAX_CHARS ? { ...m, text: `${m.text.slice(0, MAX_CHARS - 1).trimEnd()}…` } : m));
}

/** Everything a template needs to lay out one clip in the streamer's style */
export function clipTemplateContext({
  jobId,
  filename,
  env,
  kit,
  login,
  avatarUrl,
  facecam,
  startAt,
  endAt,
  hook,
}: {
  jobId: string;
  filename: string;
  env: EditEnvironment | undefined;
  kit: BrandKit;
  login: string | null;
  avatarUrl: string | null;
  /** The webcam to show (Montage can force it on clips where nobody is in it) */
  facecam: Rect | null;
  startAt: number;
  endAt: number;
  hook: string;
}): TemplateContext {
  return {
    src: clipUrl(jobId, filename),
    backgroundSrc: clipBackgroundUrl(jobId, filename),
    frameW: env?.clip_width ?? 1920,
    frameH: env?.clip_height ?? 1080,
    facecam,
    words: env?.words ?? [],
    chat: chatForClip(env?.chat_messages ?? []),
    startAt,
    endAt,
    colors: kit.colors,
    subtitleStyle: kit.subtitles.style,
    widget: kit.widget,
    login,
    avatarUrl,
    hook,
  };
}
