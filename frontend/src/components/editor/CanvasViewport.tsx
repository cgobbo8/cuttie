import { useCallback, useEffect, useRef, useState } from "react";
import type { Layer } from "../../lib/editorTypes";
import VideoLayer from "./VideoLayer";
import TextLayer from "./TextLayer";
import TransformHandles from "./TransformHandles";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props {
  layers: Layer[];
  selectedId: string | null;
  currentTime: number;
  clipWidth: number;
  clipHeight: number;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
  onSelect: (id: string | null) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
}

export default function CanvasViewport({
  layers,
  selectedId,
  currentTime,
  clipWidth,
  clipHeight,
  registerVideo,
  onSelect,
  onTransformChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  // Compute scale to fit container
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      const pad = 32;
      const s = Math.min((width - pad) / CANVAS_W, (height - pad) / CANVAS_H);
      setScale(Math.max(0.1, s));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onSelect(null);
    },
    [onSelect],
  );

  return (
    <div ref={containerRef} className="flex-1 flex items-center justify-center bg-zinc-950/50 overflow-hidden">
      {/* Scaled canvas wrapper */}
      <div
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          position: "relative",
          background: "#000",
          borderRadius: 8 / scale,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
        onClick={handleCanvasClick}
      >
        {/* Render layers bottom to top */}
        {layers.map((layer) => {
          if (!layer.visible) return null;

          const isSelected = layer.id === selectedId;

          return (
            <div
              key={layer.id}
              style={{
                position: "absolute",
                left: layer.transform.x,
                top: layer.transform.y,
                width: layer.transform.width,
                height: layer.transform.height,
                overflow: layer.type === "video" ? "hidden" : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!layer.locked) onSelect(layer.id);
              }}
            >
              {/* Layer content */}
              {layer.type === "video" && (
                <VideoLayer
                  layer={layer}
                  clipWidth={clipWidth}
                  clipHeight={clipHeight}
                  registerVideo={registerVideo}
                />
              )}
              {layer.type === "text" && (
                <TextLayer layer={layer} currentTime={currentTime} />
              )}

              {/* Transform handles if selected */}
              {isSelected && (
                <TransformHandles
                  transform={layer.transform}
                  scale={scale}
                  locked={layer.locked}
                  onTransformChange={(patch) => onTransformChange(layer.id, patch)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
