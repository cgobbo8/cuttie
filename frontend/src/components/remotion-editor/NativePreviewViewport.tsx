import { useCallback, useEffect, useRef, useState } from "react";
import type { Layer, SubtitleWord } from "../../lib/editorTypes";
import { BOX_SHADOW_PRESETS } from "../../lib/editorTypes";
import TransformHandles from "../editor/TransformHandles";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

// ── Animation helpers ─────────────────────────────────────────────────────

/** Compute animated opacity from currentTime, matching Remotion's interpolate logic. */
function animatedOpacity(
  opacity: number,
  fadeIn: number,
  fadeOut: number,
  currentTime: number,
  duration: number,
): number {
  let result = opacity;
  if (fadeIn > 0 && currentTime < fadeIn) result *= currentTime / fadeIn;
  if (fadeOut > 0 && duration > 0 && currentTime > duration - fadeOut) {
    result *= Math.max(0, (duration - currentTime) / fadeOut);
  }
  return Math.max(0, result);
}

// ── Subtitle helpers ──────────────────────────────────────────────────────

function chunkWords(words: SubtitleWord[], maxWords = 4, maxDuration = 3.0): SubtitleWord[][] {
  const chunks: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      if (current.length >= maxWords || dur > maxDuration) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function tintWhite(hex: string, strength = 0.15): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${Math.round(255*(1-strength)+r*strength)},${Math.round(255*(1-strength)+g*strength)},${Math.round(255*(1-strength)+b*strength)})`;
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  layers: Layer[];
  selectedId: string | null;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  currentTime: number;
  duration: number;
  onSelect: (id: string | null) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
  onTransformStart?: () => void;
  onTimeUpdate: (t: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onDuration: (d: number) => void;
}

export default function NativePreviewViewport({
  layers,
  selectedId,
  videoRef,
  currentTime,
  duration,
  onSelect,
  onTransformChange,
  onTransformStart,
  onTimeUpdate,
  onPlay,
  onPause,
  onDuration,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const secondaryRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Scale to fit container
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

  // Primary video event handlers
  const handleTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const t = e.currentTarget.currentTime;
    onTimeUpdate(t);
    // Drift correction for secondary videos (facecam etc.)
    secondaryRefs.current.forEach((vid) => {
      if (Math.abs(vid.currentTime - t) > 0.15) vid.currentTime = t;
    });
  }, [onTimeUpdate]);

  const handlePlay = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    onPlay();
    const t = e.currentTarget.currentTime;
    secondaryRefs.current.forEach((vid) => {
      vid.currentTime = t;
      vid.play().catch(() => {});
    });
  }, [onPlay]);

  const handlePause = useCallback(() => {
    onPause();
    secondaryRefs.current.forEach((vid) => vid.pause());
  }, [onPause]);

  const handleSeeked = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const t = e.currentTarget.currentTime;
    secondaryRefs.current.forEach((vid) => { vid.currentTime = t; });
  }, []);

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    onDuration(e.currentTarget.duration);
  }, [onDuration]);

  // Click-to-select in canvas coordinates
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const cx = (e.clientX - rect.left) / scale;
    const cy = (e.clientY - rect.top) / scale;
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
  }, [layers, scale, onSelect]);

  const selectedLayer = layers.find((l) => l.id === selectedId);

  // Track whether we've attached the primary video ref (first gameplay layer)
  let primaryAttached = false;

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: "#18181b" }}
    >
      <div style={{ position: "relative", width: CANVAS_W * scale, height: CANVAS_H * scale, flexShrink: 0 }}>

        {/* Canvas in canvas-space coordinates, scaled via CSS transform */}
        <div
          style={{
            position: "absolute",
            width: CANVAS_W,
            height: CANVAS_H,
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
            background: "#000",
            overflow: "hidden",
          }}
        >
          {layers.map((layer) => {
            if (!layer.visible) return null;
            const { style } = layer;

            const effectiveOpacity = animatedOpacity(style.opacity, style.fadeIn, style.fadeOut, currentTime, duration);
            const baseStyle: React.CSSProperties = {
              position: "absolute",
              left: layer.transform.x,
              top: layer.transform.y,
              width: layer.transform.width,
              height: layer.transform.height,
              opacity: effectiveOpacity,
              borderRadius: !layer.shape && style.borderRadius > 0 ? style.borderRadius : undefined,
              overflow: !layer.shape && style.borderRadius > 0 ? "hidden" : undefined,
              filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
            };

            // ── Gameplay ──
            if (layer.type === "gameplay" && layer.video) {
              const isPrimary = !primaryAttached;
              if (isPrimary) primaryAttached = true;

              if (isPrimary) {
                return (
                  <div key={layer.id} style={baseStyle}>
                    <video
                      ref={videoRef}
                      src={layer.video.src}
                      onTimeUpdate={handleTimeUpdate}
                      onPlay={handlePlay}
                      onPause={handlePause}
                      onSeeked={handleSeeked}
                      onLoadedMetadata={handleLoadedMetadata}
                      style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }}
                      playsInline
                    />
                  </div>
                );
              }
              return (
                <div key={layer.id} style={baseStyle}>
                  <video
                    ref={(el) => {
                      if (el) secondaryRefs.current.set(layer.id, el);
                      else secondaryRefs.current.delete(layer.id);
                    }}
                    src={layer.video.src}
                    muted
                    style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }}
                    playsInline
                  />
                </div>
              );
            }

            // ── Facecam (always secondary, muted — same src as gameplay) ──
            if (layer.type === "facecam" && layer.video) {
              const crop = layer.video.crop;
              const sx = crop ? layer.transform.width / crop.w : 1;
              const sy = crop ? layer.transform.height / crop.h : 1;
              return (
                <div key={layer.id} style={{ ...baseStyle, overflow: "hidden" }}>
                  <video
                    ref={(el) => {
                      if (el) secondaryRefs.current.set(layer.id, el);
                      else secondaryRefs.current.delete(layer.id);
                    }}
                    src={layer.video.src}
                    muted
                    style={{
                      display: "block",
                      maxWidth: "none",
                      transformOrigin: "0 0",
                      ...(crop
                        ? { transform: `scale(${sx}, ${sy}) translate(${-crop.x}px, ${-crop.y}px)` }
                        : { width: "100%", height: "100%", objectFit: "fill" as const }),
                    }}
                    playsInline
                  />
                </div>
              );
            }

            // ── Subtitles ──
            if (layer.type === "subtitles" && layer.subtitle) {
              const { subtitle } = layer;
              const chunks = chunkWords(subtitle.words);
              const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;
              const highlightColor = tintWhite(baseColor);
              const activeChunk = chunks.find(
                (c) => currentTime >= c[0].start - 0.05 && currentTime <= c[c.length - 1].end + 0.05,
              );
              const showPlaceholder = subtitle.words.length === 0 || !activeChunk;
              return (
                <div key={layer.id} style={{
                  ...baseStyle,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  textAlign: "center", overflow: "hidden",
                }}>
                  <p style={{
                    fontFamily: `"${subtitle.fontFamily}", sans-serif`,
                    fontSize: subtitle.fontSize,
                    fontWeight: 700,
                    textTransform: subtitle.uppercase ? "uppercase" : "none",
                    WebkitTextStroke: `${Math.max(2, subtitle.fontSize / 25)}px black`,
                    paintOrder: "stroke fill",
                    lineHeight: 1.2,
                    margin: 0,
                    textShadow: "2px 3px 5px rgba(0,0,0,0.6)",
                    wordBreak: "break-word",
                  }}>
                    {showPlaceholder ? (
                      <span style={{ color: highlightColor, opacity: 0.5 }}>
                        {subtitle.uppercase ? "SOUS-TITRES" : "Sous-titres"}
                      </span>
                    ) : (
                      activeChunk!.map((word, i) => (
                        <span
                          key={`${word.start}-${i}`}
                          style={{ color: currentTime >= word.start ? highlightColor : baseColor }}
                        >
                          {subtitle.uppercase ? word.word.toUpperCase() : word.word}
                          {i < activeChunk!.length - 1 ? " " : ""}
                        </span>
                      ))
                    )}
                  </p>
                </div>
              );
            }

            // ── Shape ──
            if (layer.type === "shape" && layer.shape) {
              const { shape } = layer;
              const isCircle = shape.shapeType === "circle";
              const borderRadius = isCircle ? "50%" : (style.borderRadius > 0 ? style.borderRadius : undefined);
              const shadow = BOX_SHADOW_PRESETS[shape.boxShadowPreset]?.value ?? "none";
              return (
                <div key={layer.id} style={{
                  ...baseStyle,
                  backgroundColor: hexToRgba(shape.backgroundColor, shape.backgroundAlpha),
                  borderRadius,
                  backdropFilter: shape.backdropBlur > 0 ? `blur(${shape.backdropBlur}px)` : undefined,
                  WebkitBackdropFilter: shape.backdropBlur > 0 ? `blur(${shape.backdropBlur}px)` : undefined,
                  boxShadow: shadow !== "none" ? shadow : undefined,
                }} />
              );
            }

            // ── Asset ──
            if (layer.type === "asset" && layer.asset) {
              return (
                <div key={layer.id} style={baseStyle}>
                  <img
                    src={layer.asset.src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", maxWidth: "none" }}
                  />
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Interaction overlay + transform handles (screen coordinates) */}
        <div
          style={{ position: "absolute", inset: 0, cursor: "default" }}
          onClick={handleOverlayClick}
        >
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
        <div style={{ position: "absolute", inset: 0, border: "1px solid rgba(255,255,255,0.1)", pointerEvents: "none" }} />

        {layers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
            <p className="text-zinc-700 text-sm">Canvas vide — ajoute un calque</p>
          </div>
        )}
      </div>
    </div>
  );
}
