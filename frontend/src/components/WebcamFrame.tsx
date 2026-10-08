import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import type { FacecamRect } from "../lib/api";

type Handle = "move" | "nw" | "ne" | "sw" | "se";

interface Props {
  frameUrl: string | null;
  rect: FacecamRect | null;
  editing?: boolean;
  onChange?: (rect: FacecamRect) => void;
  className?: string;
}

const MIN_SIZE = 60;

/**
 * A frame of the stream with the webcam rectangle on top. In edit mode the
 * rectangle can be dragged and resized by its corners (stream pixels).
 */
export default function WebcamFrame({ frameUrl, rect, editing = false, onChange, className = "" }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const refW = rect?.ref_w || 1920;
  const refH = rect?.ref_h || 1080;

  const startDrag = (handle: Handle) => (e: ReactPointerEvent) => {
    if (!editing || !rect || !onChange || !boxRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = boxRef.current.getBoundingClientRect();
    const scale = refW / box.width;
    const start = { x: e.clientX, y: e.clientY, rect };

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) * scale;
      const dy = (ev.clientY - start.y) * scale;
      let { x, y, w, h } = start.rect;
      if (handle === "move") {
        x = Math.min(Math.max(0, x + dx), refW - w);
        y = Math.min(Math.max(0, y + dy), refH - h);
      } else {
        if (handle.includes("w")) {
          const nx = Math.min(Math.max(0, x + dx), x + w - MIN_SIZE);
          w += x - nx;
          x = nx;
        }
        if (handle.includes("e")) w = Math.min(Math.max(MIN_SIZE, w + dx), refW - x);
        if (handle.includes("n")) {
          const ny = Math.min(Math.max(0, y + dy), y + h - MIN_SIZE);
          h += y - ny;
          y = ny;
        }
        if (handle.includes("s")) h = Math.min(Math.max(MIN_SIZE, h + dy), refH - y);
      }
      onChange({ ...start.rect, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
    };
    // Listen on the window so the drag survives leaving the frame
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div ref={boxRef} className={`relative aspect-video overflow-hidden rounded-[12px] border border-white/[0.08] bg-white/[0.04] select-none ${className}`}>
      {frameUrl ? <img src={frameUrl} alt="" draggable={false} className="w-full h-full object-cover" /> : <div className="w-full h-full skeleton" />}
      {rect && (
        <div
          onPointerDown={startDrag("move")}
          className={`absolute rounded-[4px] border-2 border-accent shadow-[0_0_0_9999px_rgba(11,11,12,0.5),0_0_24px_var(--color-accent-glow)] ${editing ? "cursor-move" : ""}`}
          style={{
            left: `${(rect.x / refW) * 100}%`,
            top: `${(rect.y / refH) * 100}%`,
            width: `${(rect.w / refW) * 100}%`,
            height: `${(rect.h / refH) * 100}%`,
          }}
        >
          {editing &&
            (["nw", "ne", "sw", "se"] as const).map((corner) => (
              <span
                key={corner}
                onPointerDown={startDrag(corner)}
                className="absolute w-3.5 h-3.5 rounded-[4px] bg-ink border-2 border-accent"
                style={{
                  [corner.includes("n") ? "top" : "bottom"]: -7,
                  [corner.includes("w") ? "left" : "right"]: -7,
                  cursor: corner === "nw" || corner === "se" ? "nwse-resize" : "nesw-resize",
                }}
              />
            ))}
        </div>
      )}
    </div>
  );
}
