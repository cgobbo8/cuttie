import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  videoSrc: string;
  initialCrop: CropRect;
  onConfirm: (crop: CropRect) => void;
  onCancel: () => void;
}

type DragMode = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

const HANDLE_SIZE = 12;
const MIN_CROP = 20;

export default function CropEditor({ videoSrc, initialCrop, onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nativeSize, setNativeSize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect>(initialCrop);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startCrop: CropRect } | null>(null);

  const handleMeta = useCallback(() => {
    const el = videoRef.current;
    if (el && el.videoWidth > 0) setNativeSize({ w: el.videoWidth, h: el.videoHeight });
  }, []);

  // Display scale to fit in viewport
  const scale = useMemo(() => {
    if (!nativeSize) return 1;
    const maxW = window.innerWidth * 0.75;
    const maxH = window.innerHeight * 0.65;
    return Math.min(maxW / nativeSize.w, maxH / nativeSize.h, 1);
  }, [nativeSize]);

  const toDisplay = useCallback((v: number) => v * scale, [scale]);
  const toSource = useCallback((v: number) => v / scale, [scale]);

  // Drag handlers
  const startDrag = useCallback((e: React.PointerEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startCrop: { ...crop } };
  }, [crop]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !nativeSize) return;
    const dx = toSource(e.clientX - d.startX);
    const dy = toSource(e.clientY - d.startY);
    const sc = d.startCrop;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

    if (d.mode === "move") {
      setCrop({
        ...sc,
        x: Math.round(clamp(sc.x + dx, 0, nativeSize.w - sc.w)),
        y: Math.round(clamp(sc.y + dy, 0, nativeSize.h - sc.h)),
      });
      return;
    }

    let { x, y, w, h } = sc;
    if (d.mode.includes("e")) {
      w = clamp(sc.w + dx, MIN_CROP, nativeSize.w - x);
    }
    if (d.mode.includes("w")) {
      const nx = clamp(sc.x + dx, 0, sc.x + sc.w - MIN_CROP);
      w = sc.w - (nx - sc.x);
      x = nx;
    }
    if (d.mode.includes("s")) {
      h = clamp(sc.h + dy, MIN_CROP, nativeSize.h - y);
    }
    if (d.mode.includes("n")) {
      const ny = clamp(sc.y + dy, 0, sc.y + sc.h - MIN_CROP);
      h = sc.h - (ny - sc.y);
      y = ny;
    }
    setCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }, [nativeSize, toSource]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Keyboard — stopImmediatePropagation prevents parent handlers (CanvasEditor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
      if (e.key === "Enter") {
        e.stopImmediatePropagation();
        onConfirm(crop);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, onConfirm, crop]);

  // Loading state
  if (!nativeSize) {
    return (
      <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center">
        <video
          ref={videoRef}
          src={videoSrc}
          onLoadedMetadata={handleMeta}
          preload="auto"
          className="hidden"
        />
        <p className="text-zinc-500 text-sm">{t("editor.cropLoading")}</p>
      </div>
    );
  }

  const displayW = nativeSize.w * scale;
  const displayH = nativeSize.h * scale;

  const corners: DragMode[] = ["nw", "ne", "sw", "se"];

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center gap-5">
      {/* Header */}
      <p className="text-sm text-zinc-300">
        {t("editor.cropHint")}
      </p>

      {/* Video + crop overlay */}
      <div
        className="relative select-none"
        style={{ width: displayW, height: displayH }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Video frame */}
        <video
          ref={videoRef}
          src={videoSrc}
          preload="auto"
          playsInline
          onLoadedMetadata={handleMeta}
          style={{ width: displayW, height: displayH, display: "block", maxWidth: "none" }}
        />

        {/* Dark overlay with crop hole */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: toDisplay(crop.x),
            top: toDisplay(crop.y),
            width: toDisplay(crop.w),
            height: toDisplay(crop.h),
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />

        {/* Crop border — draggable */}
        <div
          style={{
            position: "absolute",
            left: toDisplay(crop.x),
            top: toDisplay(crop.y),
            width: toDisplay(crop.w),
            height: toDisplay(crop.h),
            border: "2px solid rgba(255,255,255,0.9)",
            cursor: "move",
            zIndex: 1,
          }}
          onPointerDown={(e) => startDrag(e, "move")}
        />

        {/* Corner handles */}
        {corners.map((corner) => {
          const isRight = corner.includes("e");
          const isBottom = corner.includes("s");
          return (
            <div
              key={corner}
              style={{
                position: "absolute",
                left: toDisplay(crop.x + (isRight ? crop.w : 0)) - HANDLE_SIZE / 2,
                top: toDisplay(crop.y + (isBottom ? crop.h : 0)) - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: "rgb(255,255,255)",
                border: "2px solid white",
                borderRadius: 3,
                cursor: `${corner}-resize`,
                zIndex: 2,
              }}
              onPointerDown={(e) => startDrag(e, corner)}
            />
          );
        })}

        {/* Edge handles (mid-point of each side) */}
        {(["n", "s", "e", "w"] as DragMode[]).map((edge) => {
          const isHoriz = edge === "n" || edge === "s";
          const handleW = isHoriz ? 24 : 8;
          const handleH = isHoriz ? 8 : 24;
          let left: number, top: number;
          if (edge === "n") {
            left = toDisplay(crop.x + crop.w / 2) - handleW / 2;
            top = toDisplay(crop.y) - handleH / 2;
          } else if (edge === "s") {
            left = toDisplay(crop.x + crop.w / 2) - handleW / 2;
            top = toDisplay(crop.y + crop.h) - handleH / 2;
          } else if (edge === "e") {
            left = toDisplay(crop.x + crop.w) - handleW / 2;
            top = toDisplay(crop.y + crop.h / 2) - handleH / 2;
          } else {
            left = toDisplay(crop.x) - handleW / 2;
            top = toDisplay(crop.y + crop.h / 2) - handleH / 2;
          }
          return (
            <div
              key={edge}
              style={{
                position: "absolute",
                left,
                top,
                width: handleW,
                height: handleH,
                background: "rgb(255,255,255)",
                border: "2px solid white",
                borderRadius: 3,
                cursor: `${edge}-resize`,
                zIndex: 2,
              }}
              onPointerDown={(e) => startDrag(e, edge)}
            />
          );
        })}

        {/* Crop size label */}
        <div
          className="absolute text-[11px] text-white bg-black/60 px-2 py-0.5 rounded font-mono"
          style={{
            left: toDisplay(crop.x),
            top: toDisplay(crop.y) - 24,
            zIndex: 3,
          }}
        >
          {crop.w}×{crop.h}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="px-5 py-2 text-xs rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors"
        >
          {t("editor.cropCancel")}
        </button>
        <button
          onClick={() => onConfirm(crop)}
          className="px-5 py-2 text-xs rounded-lg bg-white hover:bg-zinc-200 text-black transition-colors font-medium"
        >
          {t("editor.cropApply")}
        </button>
      </div>
    </div>
  );
}
