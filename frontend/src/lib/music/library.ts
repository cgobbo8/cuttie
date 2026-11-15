/**
 * The background musics this machine can play: those that ship with the app (the ones whose
 * file is there) and those the streamer added. The API says what each one is; every screen
 * reads the same list, loaded once and reloaded when a track is added, corrected or removed.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { TFunction } from "i18next";
import { listMusics } from "../api";
import type { MusicTrack } from "./mix";

let tracks: MusicTrack[] = [];
let asked: Promise<MusicTrack[]> | null = null;
const listeners = new Set<() => void>();

/** Reads the list again (after a change), and tells every screen that shows it */
export function loadMusics(): Promise<MusicTrack[]> {
  asked = listMusics().then((next) => {
    tracks = next;
    listeners.forEach((listener) => listener());
    return next;
  });
  return asked;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tracks that can be played here (empty until the list has come) */
export function useMusics(): MusicTrack[] {
  const list = useSyncExternalStore(
    subscribe,
    () => tracks,
    () => tracks,
  );
  useEffect(() => {
    if (!asked) loadMusics().catch(() => {});
  }, []);
  return list;
}

export const trackOf = (list: MusicTrack[], id: string | null | undefined): MusicTrack | undefined => (id ? list.find((track) => track.id === id) : undefined);

/** What a track is, in the streamer's words when it is theirs, in the app's language when it ships */
export function musicAbout(track: MusicTrack, t: TFunction): string {
  if (track.own) return track.description?.trim() ?? "";
  return t(`compilation.music.about.${track.id}`, { defaultValue: track.description ?? "" });
}

/** For tests: the list as if the API had answered */
export function setMusics(next: MusicTrack[]): void {
  tracks = next;
  asked = Promise.resolve(next);
  listeners.forEach((listener) => listener());
}
