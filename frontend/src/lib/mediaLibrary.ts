/**
 * The streamer's media library: short videos of their own (an outro, a meme, something filmed on
 * a phone) that a video can take as a passage. The API keeps them; every screen reads the same
 * list, loaded once and read again when a video is imported, renamed or removed.
 */
import { useEffect, useSyncExternalStore } from "react";
import { addMedia, listMedia, MediaError, type MediaItem } from "./api";

/** The longest video the library takes, seconds, until the API says (a passage's longest) */
const LONGEST = 180;

interface Library {
  media: MediaItem[];
  /** The longest video it takes, seconds */
  longest: number;
  /** The list has come */
  loaded: boolean;
}

let library: Library = { media: [], longest: LONGEST, loaded: false };
let asked: Promise<Library> | null = null;
const listeners = new Set<() => void>();

function set(next: Library): Library {
  library = next;
  listeners.forEach((listener) => listener());
  return next;
}

/** Reads the library again (after a change), and tells every screen that shows it */
export function loadMedia(): Promise<Library> {
  asked = listMedia().then(({ media, longest }) => set({ media, longest: longest || LONGEST, loaded: true }));
  return asked;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The videos of the library, the newest first (empty until the list has come) */
export function useMedia(): Library {
  const now = useSyncExternalStore(
    subscribe,
    () => library,
    () => library,
  );
  useEffect(() => {
    if (!asked) loadMedia().catch(() => {});
  }, []);
  return now;
}

export const mediaOf = (list: MediaItem[], id: string | null | undefined): MediaItem | undefined => (id ? list.find((one) => one.id === id) : undefined);

/** What a file picker offers, and what a dropped file must be to be tried */
export const MEDIA_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,.mp4,.mov,.m4v,.webm,.mkv,.avi";
export const isVideoFile = (file: File): boolean => file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name);

/**
 * Files imported one after the other (each is converted, then listened to: a few seconds). The
 * library every screen shows is read again at the end. `added`: those now in it; `refused`: each
 * file that was not taken and why.
 */
export async function importMedia(files: File[], onProgress?: (done: number, of: number) => void): Promise<{ added: MediaItem[]; refused: { name: string; reason: MediaError["reason"]; longest?: number }[] }> {
  const added: MediaItem[] = [];
  const refused: { name: string; reason: MediaError["reason"]; longest?: number }[] = [];
  let done = 0;
  for (const file of files) {
    onProgress?.(done, files.length);
    try {
      if (!isVideoFile(file)) throw new MediaError("not_video");
      added.push(await addMedia(file));
    } catch (err) {
      refused.push({ name: file.name, reason: err instanceof MediaError ? err.reason : "failed", ...(err instanceof MediaError && err.longest ? { longest: err.longest } : {}) });
    }
    done++;
  }
  onProgress?.(done, files.length);
  if (added.length > 0) await loadMedia().catch(() => {});
  return { added, refused };
}

/** "0:12" for a short video, "1:05" past the minute */
export function mediaClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** For tests: the library as if the API had answered */
export function setMedia(media: MediaItem[], longest = LONGEST): void {
  asked = Promise.resolve(set({ media, longest, loaded: true }));
}
