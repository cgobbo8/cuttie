import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { Layer, SubtitleWord, ChatMessage, SpeakerStyle } from "../../lib/editorTypes";
import { BOX_SHADOW_PRESETS, SPEAKER_COLORS } from "../../lib/editorTypes";
import { evaluateAnimations, resolveKeyframes } from "../../lib/animations";
import { getWidgetDef } from "../editor/widgets/registry";
import TransformHandles from "../editor/TransformHandles";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

// ── Subtitle helpers ──────────────────────────────────────────────────────

function chunkWords(words: SubtitleWord[], maxWords = 4, maxDuration = 3.0, splitOnSpeaker = false): SubtitleWord[][] {
  const chunks: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      const speakerChanged = splitOnSpeaker && w.speaker !== current[current.length - 1].speaker;
      if (current.length >= maxWords || dur > maxDuration || speakerChanged) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildFallbackMap(words: SubtitleWord[], baseColor: string): Map<string, SpeakerStyle> {
  const map = new Map<string, SpeakerStyle>();
  let idx = 0;
  for (const w of words) {
    if (w.speaker && !map.has(w.speaker)) {
      map.set(w.speaker, {
        color: idx === 0 ? baseColor : SPEAKER_COLORS[(idx - 1) % SPEAKER_COLORS.length],
        textColor: "#FFFFFF",
      });
      idx++;
    }
  }
  return map;
}

function getSpeakerStyle(
  speaker: string | undefined,
  speakerStyles: Record<string, SpeakerStyle> | undefined,
  fallback: Map<string, SpeakerStyle>,
): SpeakerStyle | null {
  if (!speaker) return null;
  if (speakerStyles?.[speaker]) return speakerStyles[speaker];
  return fallback.get(speaker) ?? null;
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

// ── Chat helpers ──────────────────────────────────────────────────────────

function chatAuthorColor(name: string): string {
  const COLORS = [
    "#FF4A4A", "#FF7F50", "#FFD700", "#7CFC00", "#00CED1",
    "#1E90FF", "#DA70D6", "#FF69B4", "#00FA9A", "#FFA500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  layers: Layer[];
  selectedId: string | null;
  showSafeZones?: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
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
  showSafeZones,
  videoRef,
  duration,
  onSelect,
  onTransformChange,
  onTransformStart,
  onTimeUpdate,
  onPlay,
  onPause,
  onDuration,
}: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const secondaryRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  // Video loading state — show spinner until primary video has data
  const [videoReady, setVideoReady] = useState(false);
  const hasVideoLayer = useMemo(() => layers.some((l) => l.type === "gameplay" && l.video), [layers]);

  // Reset videoReady when the video src changes
  const videoSrc = useMemo(() => layers.find((l) => l.type === "gameplay" && l.video)?.video?.src, [layers]);
  const prevSrcRef = useRef(videoSrc);
  useEffect(() => {
    if (videoSrc !== prevSrcRef.current) {
      setVideoReady(false);
      prevSrcRef.current = videoSrc;
    }
  }, [videoSrc]);

  // High-frequency time for smooth animations (60 Hz via rAF when playing)
  const [animTime, setAnimTime] = useState(0);
  const rafRef = useRef<number>(0);

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
    // Low-frequency update (4 Hz) — only for PlaybackBar in parent
    onTimeUpdate(e.currentTarget.currentTime);
    // Drift correction for secondary videos
    secondaryRefs.current.forEach((vid) => {
      if (Math.abs(vid.currentTime - e.currentTarget.currentTime) > 0.15) {
        vid.currentTime = e.currentTarget.currentTime;
      }
    });
  }, [onTimeUpdate]);

  const handlePlay = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    onPlay();
    const t = e.currentTarget.currentTime;
    secondaryRefs.current.forEach((vid) => { vid.currentTime = t; vid.play().catch(() => {}); });
    // Start 60 Hz rAF loop for smooth animation rendering
    const video = e.currentTarget;
    const tick = () => {
      setAnimTime(video.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [onPlay]);

  const handlePause = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    onPause();
    cancelAnimationFrame(rafRef.current);
    setAnimTime(e.currentTarget.currentTime);
    secondaryRefs.current.forEach((vid) => vid.pause());
  }, [onPause]);

  const handleSeeked = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const t = e.currentTarget.currentTime;
    setAnimTime(t);
    secondaryRefs.current.forEach((vid) => { vid.currentTime = t; });
  }, []);

  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    onDuration(e.currentTarget.duration);
    setVideoReady(true);
  }, [onDuration]);

  // Click-to-select — only fire on real clicks (not after a drag).
  // TransformHandles calls stopPropagation+preventDefault on pointerdown, so the
  // overlay's pointerdown won't fire when interacting with handles. If
  // pointerStartRef is null at click time, the click came after a handle drag → skip.
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleOverlayPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;

    // If overlay tracked a pointerdown and it moved > 5px, it was a drag on empty space
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;

    // If TransformHandles was dragging (pointer actually moved), don't change selection
    if (document.documentElement.dataset.transformDragging === "moved") return;

    const rect = e.currentTarget.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / scale;
    const cy = (e.clientY - rect.top) / scale;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      const kf = resolveKeyframes(l.keyframes, animTime);
      const lx = kf.x ?? l.transform.x;
      const ly = kf.y ?? l.transform.y;
      const lw = kf.width ?? l.transform.width;
      const lh = kf.height ?? l.transform.height;
      if (cx >= lx && cx <= lx + lw && cy >= ly && cy <= ly + lh) {
        onSelect(l.id);
        return;
      }
    }
    onSelect(null);
  }, [layers, scale, onSelect, animTime]);

  const selectedLayer = layers.find((l) => l.id === selectedId);

  // Track whether we've attached the primary video ref (first gameplay layer)
  let primaryAttached = false;

  // Click outside canvas → deselect
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onSelect(null);
  }, [onSelect]);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: "#18181b" }}
      onClick={handleContainerClick}
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

            // Resolve keyframe overrides at current time
            const kf = resolveKeyframes(layer.keyframes, animTime);
            const kfX = kf.x ?? layer.transform.x;
            const kfY = kf.y ?? layer.transform.y;
            const kfW = kf.width ?? layer.transform.width;
            const kfH = kf.height ?? layer.transform.height;
            const kfRotation = kf.rotation ?? (layer.transform.rotation ?? 0);
            const kfOpacity = kf.opacity ?? style.opacity;
            const kfScale = kf.scale ?? 1;
            const kfBorderRadius = kf.borderRadius ?? style.borderRadius;
            const kfBlur = kf.blur ?? style.blur;

            const animResult = evaluateAnimations(layer, animTime, duration);
            const transformParts: string[] = [];
            if (kfRotation) transformParts.push(`rotate(${kfRotation}deg)`);
            if (kfScale !== 1) transformParts.push(`scale(${kfScale})`);
            if (animResult.transform) transformParts.push(animResult.transform);
            const combinedTransform = transformParts.join(" ") || undefined;

            const baseStyle: React.CSSProperties = {
              position: "absolute",
              left: kfX,
              top: kfY,
              width: kfW,
              height: kfH,
              opacity: animResult.opacity * kfOpacity,
              transform: combinedTransform,
              transformOrigin: "center center",
              borderRadius: !layer.shape && kfBorderRadius > 0 ? kfBorderRadius : undefined,
              overflow: !layer.shape && kfBorderRadius > 0 ? "hidden" : undefined,
              filter: kfBlur > 0 ? `blur(${kfBlur}px)` : undefined,
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
              const showSpk = subtitle.showSpeaker ?? false;
              const chunks = chunkWords(subtitle.words, 4, 3.0, showSpk);
              const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;
              const highlightColor = tintWhite(baseColor);
              const spkFallback = showSpk ? buildFallbackMap(subtitle.words, baseColor) : new Map<string, SpeakerStyle>();
              const activeChunk = chunks.find(
                (c) => animTime >= c[0].start - 0.05 && animTime <= c[c.length - 1].end + 0.05,
              );
              const showPlaceholder = subtitle.words.length === 0 || !activeChunk;
              const chunkSpk = showSpk && activeChunk?.[0]?.speaker
                ? getSpeakerStyle(activeChunk[0].speaker, subtitle.speakerStyles, spkFallback)
                : null;
              const fs = subtitle.fontSize;
              return (
                <div key={layer.id} style={{
                  ...baseStyle,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  textAlign: "center", overflow: "hidden",
                }}>
                  <p style={{
                    fontFamily: `"${subtitle.fontFamily}", sans-serif`,
                    fontSize: fs,
                    fontWeight: 700,
                    textTransform: subtitle.uppercase ? "uppercase" : "none",
                    WebkitTextStroke: chunkSpk ? undefined : `${Math.max(2, fs / 25)}px black`,
                    paintOrder: "stroke fill",
                    lineHeight: 1.2,
                    margin: 0,
                    textShadow: chunkSpk ? undefined : "2px 3px 5px rgba(0,0,0,0.6)",
                    wordBreak: "break-word",
                    ...(chunkSpk ? {
                      backgroundColor: chunkSpk.color,
                      color: chunkSpk.textColor,
                      padding: `${Math.round(fs * 0.08)}px ${Math.round(fs * 0.2)}px`,
                      borderRadius: Math.round(fs * 0.15),
                    } : {}),
                  }}>
                    {showPlaceholder ? (
                      <span style={{ color: chunkSpk ? chunkSpk.textColor : highlightColor, opacity: 0.5 }}>
                        {subtitle.uppercase ? t("editor.subtitles").toUpperCase() : t("editor.subtitles")}
                      </span>
                    ) : (
                      activeChunk!.map((word, i) => {
                        const isFilled = animTime >= word.start;
                        const color = chunkSpk
                          ? (isFilled ? chunkSpk.textColor : chunkSpk.textColor + "99")
                          : (isFilled ? highlightColor : baseColor);
                        return (
                          <span key={`${word.start}-${i}`} style={{ color }}>
                            {subtitle.uppercase ? word.word.toUpperCase() : word.word}
                            {i < activeChunk!.length - 1 ? " " : ""}
                          </span>
                        );
                      })
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

            // ── Chat ──
            if (layer.type === "chat" && layer.chat) {
              const { chat } = layer;
              const visible = chat.messages
                .filter((m: ChatMessage) => m.timestamp <= animTime && m.timestamp + chat.showDuration > animTime)
                .slice(-chat.maxVisible);
              return (
                <div key={layer.id} style={{
                  ...baseStyle,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  gap: Math.max(2, chat.fontSize * 0.3),
                  overflow: "hidden",
                  pointerEvents: "none",
                }}>
                  {visible.map((msg: ChatMessage, i: number) => (
                    <div key={`${msg.timestamp}-${i}`} style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: "0.4em",
                      fontFamily: `"${chat.fontFamily}", sans-serif`,
                      fontSize: chat.fontSize,
                      lineHeight: 1.3,
                      textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
                      opacity: 0.95,
                    }}>
                      <span style={{ color: chatAuthorColor(msg.author), fontWeight: 700, whiteSpace: "nowrap" }}>
                        {msg.author}
                      </span>
                      <span style={{ color: "#ffffff", fontWeight: 500, wordBreak: "break-word" as const }}>
                        {msg.text}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }

            // ── Text ──
            if (layer.type === "text" && layer.text) {
              const { text } = layer;
              return (
                <div key={layer.id} style={{
                  ...baseStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: text.textAlign === "center" ? "center" : text.textAlign === "right" ? "flex-end" : "flex-start",
                  padding: "8px 12px",
                }}>
                  <span style={{
                    fontFamily: text.fontFamily,
                    fontSize: text.fontSize,
                    fontWeight: text.fontWeight,
                    color: text.color,
                    textAlign: text.textAlign,
                    textTransform: text.uppercase ? "uppercase" : undefined,
                    lineHeight: text.lineHeight,
                    width: "100%",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                  }}>
                    {text.content || t("editor.text")}
                  </span>
                </div>
              );
            }

            // ── Widget ──
            if (layer.type === "widget" && layer.widget) {
              const def = getWidgetDef(layer.widget.widgetId);
              if (def) {
                const WidgetComponent = def.Component;
                return (
                  <div key={layer.id} style={baseStyle}>
                    <WidgetComponent props={layer.widget.props} width={kfW} height={kfH} currentTime={animTime} />
                  </div>
                );
              }
            }

            return null;
          })}

          {/* Safe zones overlay — shows areas covered by TikTok/Reels/Shorts UI */}
          {showSafeZones && (
            <>
              {/* Bottom-left: username, description, music */}
              <div style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: 860,
                height: 520,
                background: "rgba(239,68,68,0.25)",
                pointerEvents: "none",
                borderTopRightRadius: 12,
              }} />
              {/* Right side: like, comment, share, bookmark */}
              <div style={{
                position: "absolute",
                right: 0,
                top: 830,
                width: 200,
                bottom: 0,
                background: "rgba(239,68,68,0.25)",
                pointerEvents: "none",
                borderTopLeftRadius: 12,
              }} />
            </>
          )}
        </div>

        {/* Interaction overlay + transform handles (screen coordinates) */}
        <div
          style={{ position: "absolute", inset: 0, cursor: "default" }}
          onPointerDown={handleOverlayPointerDown}
          onClick={handleOverlayClick}
        >
          {selectedLayer && (() => {
            const selKf = resolveKeyframes(selectedLayer.keyframes, animTime);
            const selX = selKf.x ?? selectedLayer.transform.x;
            const selY = selKf.y ?? selectedLayer.transform.y;
            const selW = selKf.width ?? selectedLayer.transform.width;
            const selH = selKf.height ?? selectedLayer.transform.height;
            const selR = selKf.rotation ?? (selectedLayer.transform.rotation ?? 0);
            return (
            <div
              data-transform-root
              style={{
                position: "absolute",
                left: selX * scale,
                top: selY * scale,
                width: selW * scale,
                height: selH * scale,
                transform: selR ? `rotate(${selR}deg)` : undefined,
                transformOrigin: "center center",
              }}
            >
              <TransformHandles
                transform={{ x: selX, y: selY, width: selW, height: selH, rotation: selR }}
                scale={scale}
                locked={selectedLayer.locked}
                onTransformChange={(patch) => onTransformChange(selectedLayer.id, patch)}
                onTransformStart={onTransformStart}
              />
            </div>
            );
          })()}
        </div>

        {/* Canvas border */}
        <div style={{ position: "absolute", inset: 0, border: "1px solid rgba(255,255,255,0.1)", pointerEvents: "none" }} />

        {/* Video loading overlay */}
        {hasVideoLayer && !videoReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20" style={{ pointerEvents: "none" }}>
            <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          </div>
        )}

        {layers.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ pointerEvents: "none" }}>
            <p className="text-zinc-700 text-sm">{t("editor.emptyCanvas")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
