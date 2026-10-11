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
/** A channel emote, its prefix then a capital (falkarCry, xotrixPedro): chats saved before emotes were kept */
const CHANNEL_EMOTE = /^[a-z][a-z0-9]{2,}[A-Z][A-Za-z0-9]*$/;

/** A chat bot (alerts, commands' answers), not a viewer */
export function isChatBot(author: string): boolean {
  return BOTS.has(author.toLowerCase());
}

/** Twitch shows emotes as images: their names would only be noise in a clip */
function withoutEmotes(text: string, emotes: string[] = []): string {
  const names = new Set(emotes);
  return text
    .split(/\s+/)
    .filter((word) => word && !names.has(word) && !CHANNEL_EMOTE.test(word))
    .join(" ");
}

/** The chat worth showing in a clip: no emotes, commands (!clip), bots or links, long messages cut */
export function chatForClip(messages: (ChatMessage & { emotes?: string[] })[]): ChatMessage[] {
  return messages
    .map(({ emotes, ...m }) => ({ ...m, text: withoutEmotes(m.text, emotes) }))
    // Not a single letter left (<3, ??, 1): nothing to read
    .filter((m) => /\p{L}/u.test(m.text) && !/^[!/]/.test(m.text) && !isChatBot(m.author) && !/https?:\/\/|www\./i.test(m.text))
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
