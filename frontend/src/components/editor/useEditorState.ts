import { useCallback, useEffect, useRef, useState } from "react";
import type { Layer, LayerType, SubtitleData, VideoLayerData } from "../../lib/editorTypes";
import { DEFAULT_STYLE } from "../../lib/editorTypes";

const MAX_HISTORY = 50;

let _nextId = 0;
function uid() {
  return `layer_${++_nextId}_${Date.now().toString(36)}`;
}

function storageKey(clipKey: string) {
  return `cuttie_editor_${clipKey}`;
}

function loadLayers(clipKey: string): Layer[] | null {
  try {
    const raw = localStorage.getItem(storageKey(clipKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Layer[];
    // Migration from older saves
    return parsed.map((l) => ({
      ...l,
      style: l.style ?? { ...DEFAULT_STYLE },
      type: l.type === ("video" as string) ? "gameplay" : l.type, // old "video" → "gameplay"
    }));
  } catch { return null; }
}

function saveLayers(clipKey: string, layers: Layer[]) {
  try {
    localStorage.setItem(storageKey(clipKey), JSON.stringify(layers));
  } catch { /* quota exceeded — ignore */ }
}

/* ── Editor state hook ───────────────────────────────────── */

export function useEditorState(clipKey: string) {
  const [layers, setLayers] = useState<Layer[]>(() => loadLayers(clipKey) ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  // ── Undo / Redo ──
  const historyRef = useRef<Layer[][]>([]);
  const futureRef = useRef<Layer[][]>([]);

  /** Push current layers onto the undo stack (call BEFORE mutating). */
  const pushHistory = useCallback(() => {
    setLayers((cur) => {
      historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), cur.map((l) => ({ ...l, transform: { ...l.transform }, style: { ...l.style }, subtitle: l.subtitle ? { ...l.subtitle } : undefined }))];
      futureRef.current = [];
      return cur; // no mutation — just capture snapshot
    });
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    setLayers((cur) => {
      futureRef.current.push(cur.map((l) => ({ ...l, transform: { ...l.transform }, style: { ...l.style }, subtitle: l.subtitle ? { ...l.subtitle } : undefined })));
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    setLayers((cur) => {
      historyRef.current.push(cur.map((l) => ({ ...l, transform: { ...l.transform }, style: { ...l.style }, subtitle: l.subtitle ? { ...l.subtitle } : undefined })));
      return next;
    });
  }, []);

  // ── Persist to localStorage ──
  useEffect(() => {
    saveLayers(clipKey, layers);
  }, [clipKey, layers]);

  // Video refs for sync — first registered becomes master clock
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const masterIdRef = useRef<string | null>(null);

  const registerVideo = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(id, el);
      if (!masterIdRef.current) {
        masterIdRef.current = id;
        el.muted = false; // master plays audio
        el.addEventListener("timeupdate", () => setCurrentTime(el.currentTime));
        el.addEventListener("loadedmetadata", () => {
          if (el.duration && !isNaN(el.duration)) setDuration(el.duration);
        });
        if (el.duration && !isNaN(el.duration)) setDuration(el.duration);
      }
    } else {
      videoRefs.current.delete(id);
      if (masterIdRef.current === id) masterIdRef.current = null;
    }
  }, [setCurrentTime, setDuration]);

  const syncAllVideos = useCallback((time: number) => {
    videoRefs.current.forEach((v) => {
      if (Math.abs(v.currentTime - time) > 0.15) v.currentTime = time;
    });
  }, []);

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, duration));
    setCurrentTime(clamped);
    syncAllVideos(clamped);
  }, [duration, syncAllVideos, setCurrentTime]);

  const togglePlay = useCallback(() => {
    setPlaying((prev) => {
      const next = !prev;
      videoRefs.current.forEach((v) => {
        if (next) v.play().catch(() => {});
        else v.pause();
      });
      return next;
    });
  }, []);

  /** Generic layer factory — type is the category, name is user-facing. */
  const addLayer = useCallback((opts: {
    type: LayerType;
    name: string;
    clipUrl?: string;
    transform: Layer["transform"];
    style?: Partial<Layer["style"]>;
    video?: VideoLayerData;
    subtitle?: SubtitleData;
  }) => {
    pushHistory();
    const id = uid();
    const layer: Layer = {
      id,
      name: opts.name,
      type: opts.type,
      visible: true,
      locked: false,
      transform: opts.transform,
      style: { ...DEFAULT_STYLE, ...opts.style },
      video: opts.video ?? (opts.clipUrl ? { src: opts.clipUrl } : undefined),
      subtitle: opts.subtitle,
    };
    setLayers((prev) => [...prev, layer]);
    setSelectedId(id);
  }, [pushHistory]);

  // Layer CRUD — live transform updates (no history push, called every pointer move)
  const updateTransform = useCallback((id: string, patch: Partial<Layer["transform"]>) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, transform: { ...l.transform, ...patch } } : l,
      ),
    );
  }, []);

  /** Called on pointer-up to snapshot the pre-drag state into undo history. */
  const commitTransform = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  /** Live style update (no history push — call commitTransform before starting a slider drag). */
  const updateStyle = useCallback((id: string, patch: Partial<Layer["style"]>) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, style: { ...l.style, ...patch } } : l,
      ),
    );
  }, []);

  /** Update video crop (pushes history). */
  const updateVideoCrop = useCallback((id: string, crop: { x: number; y: number; w: number; h: number }) => {
    pushHistory();
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id && l.video ? { ...l, video: { ...l.video, crop } } : l,
      ),
    );
  }, [pushHistory]);

  /** Live subtitle property update (no history push). */
  const updateSubtitle = useCallback((id: string, patch: Partial<SubtitleData>) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id && l.subtitle ? { ...l, subtitle: { ...l.subtitle, ...patch } } : l,
      ),
    );
  }, []);

  const moveLayer = useCallback((id: string, direction: "up" | "down") => {
    pushHistory();
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, [pushHistory]);

  const duplicateLayer = useCallback((id: string) => {
    pushHistory();
    setLayers((prev) => {
      const src = prev.find((l) => l.id === id);
      if (!src) return prev;
      const clone: Layer = {
        ...structuredClone(src),
        id: uid(),
        name: `${src.name} (copie)`,
        transform: { ...src.transform, x: src.transform.x + 20, y: src.transform.y + 20 },
      };
      const idx = prev.indexOf(src);
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  }, [pushHistory]);

  const removeLayer = useCallback((id: string) => {
    pushHistory();
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, [pushHistory]);

  const renameLayer = useCallback((id: string, name: string) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }, []);

  const toggleVisibility = useCallback((id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l)),
    );
  }, []);

  const toggleLock = useCallback((id: string) => {
    setLayers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l)),
    );
  }, []);

  const selected = layers.find((l) => l.id === selectedId) ?? null;

  return {
    layers,
    setLayers,
    selectedId,
    setSelectedId,
    selected,
    currentTime,
    duration,
    playing,
    registerVideo,
    seek,
    togglePlay,
    addLayer,
    updateTransform,
    commitTransform,
    updateStyle,
    updateVideoCrop,
    updateSubtitle,
    moveLayer,
    duplicateLayer,
    removeLayer,
    renameLayer,
    toggleVisibility,
    toggleLock,
    undo,
    redo,
  };
}
