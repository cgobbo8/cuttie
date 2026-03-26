import { useCallback, useEffect, useState } from "react";
import type { LayerTransform } from "../../lib/editorTypes";

interface Props {
  transform: LayerTransform;
  scale: number; // viewport scale factor (canvas px → screen px)
  locked: boolean;
  onTransformChange: (t: Partial<LayerTransform>) => void;
}

type HandleType = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

export default function TransformHandles({ transform, scale, locked, onTransformChange }: Props) {
  const [dragging, setDragging] = useState<{
    type: HandleType;
    startX: number;
    startY: number;
    startTransform: LayerTransform;
  } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, type: HandleType) => {
      if (locked) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragging({
        type,
        startX: e.clientX,
        startY: e.clientY,
        startTransform: { ...transform },
      });
    },
    [transform, locked],
  );

  useEffect(() => {
    if (!dragging) return;
    const { type, startX, startY, startTransform } = dragging;

    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;

      if (type === "move") {
        onTransformChange({ x: startTransform.x + dx, y: startTransform.y + dy });
        return;
      }

      let { x, y, width, height } = startTransform;

      // Resize logic
      if (type.includes("e")) width = Math.max(40, width + dx);
      if (type.includes("w")) { width = Math.max(40, width - dx); x = startTransform.x + dx; }
      if (type.includes("s")) height = Math.max(40, height + dy);
      if (type.includes("n")) { height = Math.max(40, height - dy); y = startTransform.y + dy; }

      onTransformChange({ x, y, width, height });
    };

    const onUp = () => setDragging(null);

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

      {/* Move area (the full layer) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          cursor: locked ? "default" : "move",
        }}
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
