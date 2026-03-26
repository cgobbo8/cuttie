import { useCallback, useRef, useState } from "react";
import type { Layer, EditEnvironment, VideoCrop } from "../../lib/editorTypes";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

let _nextId = 0;
function uid() {
  return `layer_${++_nextId}_${Date.now().toString(36)}`;
}

/* ── Build default layers from edit-env ──────────────────── */

export function buildDefaultLayers(env: EditEnvironment, clipUrl: string): Layer[] {
  const { layout, facecam, game_crop, words } = env;
  const layers: Layer[] = [];

  // L0: Blurred background
  layers.push({
    id: uid(),
    name: "Fond flou",
    type: "video",
    visible: true,
    locked: true,
    transform: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H },
    video: { src: clipUrl, blur: layout.blur_sigma, brightness: 0.9 },
  });

  // L1: Game footage
  layers.push({
    id: uid(),
    name: "Gameplay",
    type: "video",
    visible: true,
    locked: false,
    transform: { x: 0, y: layout.game_y, width: CANVAS_W, height: layout.game_h },
    video: { src: clipUrl, crop: game_crop },
  });

  // L2: Facecam
  if (facecam) {
    const camW = layout.cam_size;
    // Maintain facecam aspect ratio
    const camH = Math.round(camW * (facecam.h / facecam.w));
    layers.push({
      id: uid(),
      name: "Facecam",
      type: "video",
      visible: true,
      locked: false,
      transform: {
        x: (CANVAS_W - camW) / 2,
        y: layout.cam_margin_top,
        width: camW,
        height: camH,
      },
      video: {
        src: clipUrl,
        crop: facecam as VideoCrop,
        borderRadius: layout.cam_border_radius,
      },
    });
  }

  // L3: Subtitles
  if (words.length > 0) {
    layers.push({
      id: uid(),
      name: "Sous-titres",
      type: "text",
      visible: true,
      locked: false,
      transform: { x: 40, y: CANVAS_H - 400, width: CANVAS_W - 80, height: 180 },
      text: {
        words,
        fontSize: 72,
        fontFamily: "Luckiest Guy",
        color: "#ffffff",
        outlineColor: "#000000",
        outlineWidth: 4,
        uppercase: true,
      },
    });
  }

  return layers;
}

/* ── Editor state hook ───────────────────────────────────── */

export function useEditorState() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Video refs for sync — first registered video is the master clock
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const masterIdRef = useRef<string | null>(null);

  const registerVideo = useCallback((id: string, el: HTMLVideoElement | null) => {
    if (el) {
      videoRefs.current.set(id, el);
      // First registered video becomes the master
      if (!masterIdRef.current) {
        masterIdRef.current = id;
        el.addEventListener("timeupdate", () => {
          setCurrentTime(el.currentTime);
        });
        el.addEventListener("loadedmetadata", () => {
          if (el.duration && !isNaN(el.duration)) setDuration(el.duration);
        });
        // If already loaded
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

  const pause = useCallback(() => {
    setPlaying(false);
    videoRefs.current.forEach((v) => v.pause());
  }, []);

  // Layer CRUD
  const updateLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const updateTransform = useCallback((id: string, patch: Partial<Layer["transform"]>) => {
    setLayers((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, transform: { ...l.transform, ...patch } } : l,
      ),
    );
  }, []);

  const moveLayer = useCallback((id: string, direction: "up" | "down") => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === "up" ? idx + 1 : idx - 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const duplicateLayer = useCallback((id: string) => {
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
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  const renameLayer = useCallback((id: string, name: string) => {
    updateLayer(id, { name });
  }, [updateLayer]);

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
    setCurrentTime,
    duration,
    setDuration,
    playing,
    setPlaying,
    registerVideo,
    seek,
    togglePlay,
    pause,
    updateLayer,
    updateTransform,
    moveLayer,
    duplicateLayer,
    removeLayer,
    renameLayer,
    toggleVisibility,
    toggleLock,
  };
}
