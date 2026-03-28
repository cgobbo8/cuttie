import { useCallback, useEffect, useRef, useState } from "react";
import type { Layer } from "../../lib/editorTypes";
import { resolveKeyframes } from "../../lib/animations";
import VideoLayer from "./VideoLayer";
import SubtitleLayer from "./SubtitleLayer";
import ChatLayer from "./ChatLayer";
import AssetLayer from "./AssetLayer";
import ShapeLayer from "./ShapeLayer";
import TextLayer from "./TextLayer";
import TransformHandles from "./TransformHandles";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props {
  layers: Layer[];
  selectedId: string | null;
  currentTime: number;
  registerVideo: (id: string, el: HTMLVideoElement | null) => void;
  onSelect: (id: string | null) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
  onTransformStart?: () => void;
}

export default function CanvasViewport({
  layers,
  selectedId,
  currentTime,
  registerVideo,
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

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onSelect(null);
    },
    [onSelect],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: "#18181b", isolation: "isolate" }}
    >
      {/* Scaled canvas */}
      {/* Outer wrapper: allows overflow to be visible but dimmed */}
      <div
        style={{
          position: "relative",
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          flexShrink: 0,
        }}
        onClick={handleCanvasClick}
      >
        {/* Canvas area (black background) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
            zIndex: 0,
          }}
        />

        {/* Layers — can overflow the canvas */}
        {layers.map((layer) => {
          if (!layer.visible) return null;
          const isSelected = layer.id === selectedId;

          const { style } = layer;

          // Resolve keyframe overrides at current time
          const kfOverrides = resolveKeyframes(layer.keyframes, currentTime);
          const kfX = kfOverrides.x ?? layer.transform.x;
          const kfY = kfOverrides.y ?? layer.transform.y;
          const kfW = kfOverrides.width ?? layer.transform.width;
          const kfH = kfOverrides.height ?? layer.transform.height;
          const kfRotation = kfOverrides.rotation ?? (layer.transform.rotation ?? 0);
          const kfOpacity = kfOverrides.opacity ?? style.opacity;
          const kfScale = kfOverrides.scale ?? 1;

          const transformParts: string[] = [];
          if (kfRotation) transformParts.push(`rotate(${kfRotation}deg)`);
          if (kfScale !== 1) transformParts.push(`scale(${kfScale})`);

          return (
            <div
              key={layer.id}
              data-transform-root
              style={{
                position: "absolute",
                left: kfX,
                top: kfY,
                width: kfW,
                height: kfH,
                transform: transformParts.length > 0 ? transformParts.join(" ") : undefined,
                transformOrigin: "center center",
                zIndex: 1,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(layer.id);
              }}
            >
              {/* Content wrapper — receives visual styles (blur, opacity, radius) */}
              {/* Shape layers handle their own borderRadius and backdrop-filter,
                  so we skip overflow:hidden to let backdrop-filter work. */}
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  opacity: kfOpacity,
                  borderRadius: !layer.shape && style.borderRadius > 0 ? style.borderRadius : undefined,
                  overflow: !layer.shape && style.borderRadius > 0 ? "hidden" : undefined,
                  filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
                }}
              >
                {layer.video && (
                  <VideoLayer layer={layer} registerVideo={registerVideo} />
                )}
                {layer.subtitle && (
                  <SubtitleLayer layer={layer} currentTime={currentTime} />
                )}
                {layer.asset && (
                  <AssetLayer layer={layer} />
                )}
                {layer.shape && (
                  <ShapeLayer layer={layer} />
                )}
                {layer.chat && (
                  <ChatLayer layer={layer} currentTime={currentTime} />
                )}
                {layer.text && (
                  <TextLayer layer={layer} />
                )}
              </div>

              {/* Handles stay outside the styled wrapper — never blurred */}
              {isSelected && (
                <TransformHandles
                  transform={layer.transform}
                  scale={scale}
                  locked={layer.locked}
                  onTransformChange={(patch) => onTransformChange(layer.id, patch)}
                  onTransformStart={onTransformStart}
                />
              )}
            </div>
          );
        })}

        {/* Overflow mask: dims content outside the canvas bounds */}
        {/* Top */}
        <div style={{ position: "absolute", left: -9999, right: -9999, top: -9999, height: 9999, background: "rgba(24,24,27,0.75)", zIndex: 2, pointerEvents: "none" }} />
        {/* Bottom */}
        <div style={{ position: "absolute", left: -9999, right: -9999, bottom: -9999, height: 9999, background: "rgba(24,24,27,0.75)", zIndex: 2, pointerEvents: "none" }} />
        {/* Left */}
        <div style={{ position: "absolute", left: -9999, top: 0, width: 9999, height: CANVAS_H, background: "rgba(24,24,27,0.75)", zIndex: 2, pointerEvents: "none" }} />
        {/* Right */}
        <div style={{ position: "absolute", right: -9999, top: 0, width: 9999, height: CANVAS_H, background: "rgba(24,24,27,0.75)", zIndex: 2, pointerEvents: "none" }} />

        {/* Canvas border (on top of masks) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(255,255,255,0.1)",
            zIndex: 3,
            pointerEvents: "none",
          }}
        />

        {/* Empty state */}
        {layers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
            <p className="text-zinc-700 text-sm">Canvas vide — ajoute un calque</p>
          </div>
        )}
      </div>
    </div>
  );
}
