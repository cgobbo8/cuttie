import { useCallback, useEffect, useState } from "react";
import type { LayerTransform } from "../../lib/editorTypes";

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const SNAP_THRESHOLD = 12; // px in canvas space

interface Props {
  transform: LayerTransform;
  scale: number;
  locked: boolean;
  onTransformChange: (t: Partial<LayerTransform>) => void;
  /** Called on pointer down — snapshot for undo before mutation starts */
  onTransformStart?: () => void;
}

type HandleType = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/** Snap a value to targets within threshold. Returns [snapped value, guide position or null]. */
function snap(val: number, targets: number[]): [number, number | null] {
  for (const t of targets) {
    if (Math.abs(val - t) < SNAP_THRESHOLD) return [t, t];
  }
  return [val, null];
}

export interface SnapGuides {
  x: number | null;
  y: number | null;
}

export default function TransformHandles({
  transform,
  scale,
  locked,
  onTransformChange,
  onTransformStart,
}: Props) {
  const [dragging, setDragging] = useState<{
    type: HandleType;
    startX: number;
    startY: number;
    startTransform: LayerTransform;
  } | null>(null);
  const [guides, setGuides] = useState<SnapGuides>({ x: null, y: null });

  const onPointerDown = useCallback(
    (e: React.PointerEvent, type: HandleType) => {
      if (locked) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onTransformStart?.();
      setDragging({
        type,
        startX: e.clientX,
        startY: e.clientY,
        startTransform: { ...transform },
      });
    },
    [transform, locked, onTransformStart],
  );

  useEffect(() => {
    if (!dragging) return;
    const { type, startX, startY, startTransform } = dragging;
    const aspect = startTransform.width / startTransform.height;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;
      const freeDistort = e.shiftKey;

      if (type === "move") {
        let nx = startTransform.x + dx;
        let ny = startTransform.y + dy;
        const w = startTransform.width;
        const h = startTransform.height;

        // Snap edges and center to canvas bounds / center
        const xTargets = [0, (CANVAS_W - w) / 2, CANVAS_W - w];
        const yTargets = [0, (CANVAS_H - h) / 2, CANVAS_H - h];

        const [sx, gx] = snap(nx, xTargets);
        const [sy, gy] = snap(ny, yTargets);
        nx = sx;
        ny = sy;

        // Also snap right/bottom edges
        const [, gxr] = snap(nx + w, [CANVAS_W, CANVAS_W / 2]);
        const [, gyl] = snap(ny + h, [CANVAS_H, CANVAS_H / 2]);
        if (gxr !== null && gx === null) nx = gxr - w;
        if (gyl !== null && gy === null) ny = gyl - h;

        setGuides({
          x: gx !== null ? gx : (gxr !== null ? gxr - w : null),
          y: gy !== null ? gy : (gyl !== null ? gyl - h : null),
        });

        onTransformChange({ x: nx, y: ny });
        return;
      }

      // --- Resize ---
      let { x, y, width, height } = startTransform;

      // Raw resize per axis
      if (type.includes("e")) width = Math.max(40, width + dx);
      if (type.includes("w")) { width = Math.max(40, width - dx); x = startTransform.x + (startTransform.width - width); }
      if (type.includes("s")) height = Math.max(40, height + dy);
      if (type.includes("n")) { height = Math.max(40, height - dy); y = startTransform.y + (startTransform.height - height); }

      // Lock aspect ratio (unless Shift)
      if (!freeDistort) {
        const isHorizontal = type === "e" || type === "w";
        const isVertical = type === "n" || type === "s";

        if (isHorizontal) {
          height = Math.max(40, width / aspect);
        } else if (isVertical) {
          width = Math.max(40, height * aspect);
        } else {
          // Corner: use dominant axis
          const dxAbs = Math.abs(width - startTransform.width);
          const dyAbs = Math.abs(height - startTransform.height);
          if (dxAbs >= dyAbs) {
            height = Math.max(40, width / aspect);
          } else {
            width = Math.max(40, height * aspect);
          }
        }

        // Recompute anchored position
        if (type.includes("w")) x = startTransform.x + startTransform.width - width;
        if (type.includes("n")) y = startTransform.y + startTransform.height - height;
      }

      setGuides({ x: null, y: null });
      onTransformChange({ x, y, width, height });
    };

    const onUp = () => {
      setDragging(null);
      setGuides({ x: null, y: null });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, scale, onTransformChange]);

  const handleSize = Math.max(8, 8 / scale);
  const halfHandle = handleSize / 2;
  const border = Math.max(1, 1 / scale);

  const handles: { type: HandleType; x: number; y: number; cursor: string }[] = [
    { type: "nw", x: -halfHandle, y: -halfHandle, cursor: "nwse-resize" },
    { type: "ne", x: transform.width - halfHandle, y: -halfHandle, cursor: "nesw-resize" },
    { type: "sw", x: -halfHandle, y: transform.height - halfHandle, cursor: "nesw-resize" },
    { type: "se", x: transform.width - halfHandle, y: transform.height - halfHandle, cursor: "nwse-resize" },
    { type: "n", x: transform.width / 2 - halfHandle, y: -halfHandle, cursor: "ns-resize" },
    { type: "s", x: transform.width / 2 - halfHandle, y: transform.height - halfHandle, cursor: "ns-resize" },
    { type: "w", x: -halfHandle, y: transform.height / 2 - halfHandle, cursor: "ew-resize" },
    { type: "e", x: transform.width - halfHandle, y: transform.height / 2 - halfHandle, cursor: "ew-resize" },
  ];

  return (
    <>
      {/* Selection border */}
      <div
        style={{
          position: "absolute",
          inset: -border,
          border: `${border * 2}px solid #a855f7`,
          pointerEvents: "none",
        }}
      />

      {/* Snap guides */}
      {guides.x !== null && (
        <div style={{
          position: "absolute",
          left: -transform.x,
          top: -9999, width: 1, height: 99999,
          background: "#a855f7",
          opacity: 0.5,
          pointerEvents: "none",
          zIndex: 20,
          transform: `translateX(${guides.x + transform.width / 2}px)`,
        }} />
      )}
      {guides.y !== null && (
        <div style={{
          position: "absolute",
          top: -transform.y,
          left: -9999, height: 1, width: 99999,
          background: "#a855f7",
          opacity: 0.5,
          pointerEvents: "none",
          zIndex: 20,
          transform: `translateY(${guides.y + transform.height / 2}px)`,
        }} />
      )}

      {/* Move area */}
      <div
        style={{ position: "absolute", inset: 0, cursor: locked ? "default" : "move" }}
        onPointerDown={(e) => onPointerDown(e, "move")}
      />

      {/* Resize handles */}
      {!locked &&
        handles.map((h) => (
          <div
            key={h.type}
            style={{
              position: "absolute",
              left: h.x,
              top: h.y,
              width: handleSize,
              height: handleSize,
              background: "#a855f7",
              border: `${border}px solid #fff`,
              cursor: h.cursor,
              zIndex: 10,
            }}
            onPointerDown={(e) => onPointerDown(e, h.type)}
          />
        ))}
    </>
  );
}
