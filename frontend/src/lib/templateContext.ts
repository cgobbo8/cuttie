import { clipBackgroundUrl, clipUrl, type BrandKit, type EditEnvironment } from "./api";
import type { Rect, TemplateContext } from "./templates";

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
