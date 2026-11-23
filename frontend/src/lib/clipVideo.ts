import { openClipVideo, saveCompilation, type Compilation } from "./api";

/**
 * A kept clip opened as a video (its montage, its export). The first time, what the montage
 * screen of before had set for it — kept in the browser, by live — goes on the video once: its
 * template, the line written on it, its music and its intro.
 */

/** A video made this long ago was made by this call, not opened again */
const JUST_MADE_MS = 15_000;

interface OldPrefs {
  template?: string | null;
  perClip?: Record<string, string>;
  hooks?: Record<string, string>;
  applyAll?: boolean;
  music?: { track: string; volume?: number } | "none";
  musicPerClip?: Record<string, { track: string; volume?: number } | "none">;
  intro?: Compilation["intro"];
}

function oldPrefs(jobId: string): OldPrefs | null {
  try {
    const raw = localStorage.getItem(`cuttie_montage_${jobId}`);
    return raw ? (JSON.parse(raw) as OldPrefs) : null;
  } catch {
    return null;
  }
}

/** What the old screen had set for a clip, as a video keeps it (nothing when it had set nothing) */
export function fromOldPrefs(prefs: OldPrefs | null, filename: string): Partial<Pick<Compilation, "template" | "hook" | "music" | "intro">> {
  if (!prefs) return {};
  const own = prefs.applyAll === false;
  const template = (own ? prefs.perClip?.[filename] : null) ?? prefs.template;
  const hook = prefs.hooks?.[filename]?.trim();
  const music = (own ? prefs.musicPerClip?.[filename] : undefined) ?? prefs.music;
  return {
    ...(template ? { template } : {}),
    ...(hook ? { hook: hook.slice(0, 120) } : {}),
    ...(music && music !== "none" && typeof music.track === "string" ? { music } : {}),
    ...(prefs.intro && typeof prefs.intro.style === "string" ? { intro: prefs.intro } : {}),
  };
}

export async function openKeptClip(jobId: string, filename: string): Promise<Compilation> {
  const video = await openClipVideo(jobId, filename);
  if (Date.now() - Date.parse(video.created_at) > JUST_MADE_MS) return video;
  const kept = fromOldPrefs(oldPrefs(jobId), filename);
  if (Object.keys(kept).length === 0) return video;
  return saveCompilation(jobId, { ...video, ...kept }).catch(() => video);
}
