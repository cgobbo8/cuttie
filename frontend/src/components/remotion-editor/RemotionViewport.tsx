import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { Layer } from "../../lib/editorTypes";
import CuttieComposition from "./CuttieComposition";
import TransformHandles from "../editor/TransformHandles";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props {
  layers: Layer[];
  selectedId: string | null;
  playerRef: React.RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
  onSelect: (id: string | null) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
  onTransformStart?: () => void;
}

export default function RemotionViewport({
  layers,
  selectedId,
  playerRef,
  durationInFrames,
  fps,
  onSelect,
  onTransformChange,
  onTransformStart,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  // Compute scale to fit container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const pad = 40;
      const s = Math.min((width - pad) / CANVAS_W, (height - pad) / CANVAS_H);
      setScale(Math.max(0.1, s));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // If clicking directly on overlay (not a handle), find which layer was hit
      if (e.target !== e.currentTarget) return;

      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const cx = (e.clientX - rect.left) / scale;
      const cy = (e.clientY - rect.top) / scale;

      // Hit test in reverse z-order (top layer first)
      for (let i = layers.length - 1; i >= 0; i--) {
        const l = layers[i];
        if (!l.visible) continue;
        const t = l.transform;
        if (cx >= t.x && cx <= t.x + t.width && cy >= t.y && cy <= t.y + t.height) {
          onSelect(l.id);
          return;
        }
      }
      onSelect(null);
    },
    [layers, scale, onSelect],
  );

  const selectedLayer = layers.find((l) => l.id === selectedId);

  const scaledW = CANVAS_W * scale;
  const scaledH = CANVAS_H * scale;

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: "#18181b" }}
    >
      <div style={{ position: "relative", width: scaledW, height: scaledH, flexShrink: 0 }}>
        {/* Remotion Player */}
        <Player
          ref={playerRef}
          component={CuttieComposition}
          inputProps={{ layers }}
          compositionWidth={CANVAS_W}
          compositionHeight={CANVAS_H}
          fps={fps}
          durationInFrames={Math.max(1, durationInFrames)}
          controls={false}
          loop
          style={{ width: scaledW, height: scaledH }}
        />

        {/* Interactive overlay for selection + transform handles */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            cursor: "default",
          }}
          onClick={handleOverlayClick}
        >
          {/* Transform handles for selected layer */}
          {selectedLayer && (
            <div
              style={{
                position: "absolute",
                left: selectedLayer.transform.x * scale,
                top: selectedLayer.transform.y * scale,
                width: selectedLayer.transform.width * scale,
                height: selectedLayer.transform.height * scale,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <TransformHandles
                transform={selectedLayer.transform}
                scale={scale}
                locked={selectedLayer.locked}
                onTransformChange={(patch) => onTransformChange(selectedLayer.id, patch)}
                onTransformStart={onTransformStart}
              />
            </div>
          )}
        </div>

        {/* Canvas border */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(255,255,255,0.1)",
            pointerEvents: "none",
          }}
        />

        {/* Empty state */}
        {layers.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ pointerEvents: "none" }}
          >
            <p className="text-zinc-700 text-sm">Canvas vide — ajoute un calque</p>
          </div>
        )}
      </div>
    </div>
  );
}
