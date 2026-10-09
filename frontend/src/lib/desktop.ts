/**
 * The desktop shell (desktop/preload.cjs) when Cuttie runs as the Windows app:
 * its version, updates from GitHub Releases, the logs folder. Absent in a browser.
 */

import { useSyncExternalStore } from "react";

export interface DesktopInfo {
  version: string;
  packaged: boolean;
  dataDir: string;
  logDir: string;
}

export type UpdateCheck =
  | { state: "dev"; current: string }
  | { state: "latest" | "available"; current: string; version: string | null; notes: string | null };

export type UpdateEvent = { state: "downloading"; percent: number } | { state: "ready"; version: string } | { state: "error"; message: string };

interface DesktopBridge {
  platform: string;
  info(): Promise<DesktopInfo>;
  openLogs(): Promise<string>;
  repairPython(): Promise<boolean>;
  checkForUpdate(): Promise<UpdateCheck>;
  downloadUpdate(): Promise<boolean>;
  installUpdate(): Promise<void>;
  onUpdate(callback: (event: UpdateEvent) => void): () => void;
}

declare global {
  interface Window {
    cuttieDesktop?: DesktopBridge;
  }
}

export const desktop: DesktopBridge | null = typeof window !== "undefined" ? (window.cuttieDesktop ?? null) : null;

// ── Update state ─────────────────────────────────────────────────────────────

export type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "dev" }
  | { phase: "latest" }
  | { phase: "available"; version: string; notes: string | null }
  | { phase: "downloading"; version: string; percent: number }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; message: string };

export function afterCheck(result: UpdateCheck): UpdateState {
  if (result.state === "dev") return { phase: "dev" };
  if (result.state === "available" && result.version) return { phase: "available", version: result.version, notes: result.notes };
  return { phase: "latest" };
}

export function afterEvent(state: UpdateState, event: UpdateEvent): UpdateState {
  const version = "version" in state ? state.version : "";
  switch (event.state) {
    case "downloading":
      // Late progress after the end, or after an error: ignored
      return state.phase === "downloading" || state.phase === "available" ? { phase: "downloading", version, percent: event.percent } : state;
    case "ready":
      return state.phase === "installing" ? state : { phase: "ready", version: event.version || version };
    case "error":
      return { phase: "error", message: event.message };
  }
}

/** Something to show in the top bar: an update waits for a click. */
export const updatePending = (state: UpdateState) => state.phase === "available" || state.phase === "downloading" || state.phase === "ready";

let state: UpdateState = { phase: "idle" };
const listeners = new Set<() => void>();
const set = (next: UpdateState) => {
  state = next;
  listeners.forEach((listener) => listener());
};
desktop?.onUpdate((event) => set(afterEvent(state, event)));

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

export const updates = {
  async check() {
    if (!desktop || state.phase === "checking" || state.phase === "downloading" || state.phase === "installing") return;
    set({ phase: "checking" });
    try {
      set(afterCheck(await desktop.checkForUpdate()));
    } catch (err) {
      set({ phase: "error", message: errorMessage(err) });
    }
  },
  async download() {
    if (!desktop || state.phase !== "available") return;
    set({ phase: "downloading", version: state.version, percent: 0 });
    try {
      await desktop.downloadUpdate();
    } catch (err) {
      set({ phase: "error", message: errorMessage(err) });
    }
  },
  async install() {
    if (!desktop || state.phase !== "ready") return;
    set({ phase: "installing", version: state.version });
    await desktop.installUpdate();
  },
};

let checkedOnce = false;
/** Once per launch, a few seconds after it: is there a new version? */
export function checkForUpdateSoon(delayMs = 8000) {
  if (!desktop || checkedOnce) return;
  checkedOnce = true;
  setTimeout(() => {
    // Quietly: a failed check here (offline...) doesn't need a message
    if (state.phase === "idle") updates.check().then(() => state.phase === "error" && set({ phase: "idle" }));
  }, delayMs);
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state
  );
}
