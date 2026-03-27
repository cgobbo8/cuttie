import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { Layer, LayerAnimation } from "../../lib/editorTypes";
import { layerVisibilityAtTime, ANIMATION_DEFS } from "../../lib/animations";

function fmtShort(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}

interface Props {
  currentTime: number;
  duration: number;
  playing: boolean;
  trimStart: number;
  trimEnd: number;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onTrimChange: (trimStart: number, trimEnd: number) => void;
  /** Normalized waveform peaks (0-1), evenly spaced across full duration */
  waveform?: Float32Array | null;
  /** Chat message timestamps (seconds, relative to clip start) */
  chatTimestamps?: number[];
  /** Subtitle word intervals */
  subtitleWords?: { start: number; end: number }[];
  /** Currently selected layer — shows lifetime bar when set */
  selectedLayer?: Layer | null;
  /** Called to update an animation on the selected layer (for lifetime bar drag) */
  onUpdateAnimation?: (layerId: string, animId: string, patch: Partial<LayerAnimation>) => void;
  /** Called before starting a drag to snapshot undo state */
  onCommitAnimation?: () => void;
}

type TrimDragTarget = "start" | "end" | null;

/* ── Waveform canvas renderer ───────────────────────────── */

function WaveformCanvas({ peaks, width, height }: { peaks: Float32Array; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    canvas.width = width * 2; // retina
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barCount = Math.min(peaks.length, Math.floor(width));
    const barW = canvas.width / barCount;

    ctx.fillStyle = "rgba(255, 255, 255, 0.12)"; // white at 12%
    for (let i = 0; i < barCount; i++) {
      // Map bar index to peak index
      const peakIdx = Math.floor((i / barCount) * peaks.length);
      const v = peaks[peakIdx];
      const barH = Math.max(1, v * canvas.height * 0.9);
      const x = i * barW;
      const y = (canvas.height - barH) / 2;
      ctx.fillRect(x, y, Math.max(1, barW - 0.5), barH);
    }
  }, [peaks, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}

/* ── Layer lifetime bar ──────────────────────────────────── */

/** "move" = translate block (duration fixed), "resize" = change duration (anchor edge fixed) */
type DragMode = "move" | "resize";
type LifetimeDragTarget = { animId: string; mode: DragMode; grabOffset: number; initialTime: number; initialDuration: number; category: "in" | "out" } | null;

function LayerLifetimeBar({
  layer, duration, width,
  onUpdateAnimation, onCommit,
}: {
  layer: Layer;
  duration: number;
  width: number;
  onUpdateAnimation?: (layerId: string, animId: string, patch: Partial<LayerAnimation>) => void;
  onCommit?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<LifetimeDragTarget>(null);
  const [hoverCursor, setHoverCursor] = useState<string>("default");
  const HEIGHT = 14;
  const EDGE_ZONE = 8;  // px from edge = resize
  const OUTER_PAD = 6;  // px outside block edges still counts as edge hit

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || duration <= 0) return;
    const dpr = 2;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const anims = layer.animations ?? [];
    const SAMPLES = Math.min(Math.floor(width), 400);

    for (let i = 0; i < SAMPLES; i++) {
      const t = (i / SAMPLES) * duration;
      const v = layerVisibilityAtTime(layer, t, duration);
      const x = (i / SAMPLES) * canvas.width;
      const barW = canvas.width / SAMPLES + 0.5;
      const barH = v * canvas.height;
      const y = canvas.height - barH;

      ctx.fillStyle = v >= 0.99
        ? "rgba(255, 255, 255, 0.4)"
        : v > 0
          ? "rgba(255, 255, 255, 0.15)"
          : "rgba(255, 255, 255, 0.03)";
      ctx.fillRect(x, y, barW, barH);

      if (v < 0.01) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
        ctx.fillRect(x, canvas.height - 1, barW, 1);
      }
    }

    // Draw animation blocks
    for (const anim of anims) {
      const def = ANIMATION_DEFS[anim.type];
      if (!def) continue;
      const xStart = (anim.time / duration) * canvas.width;
      const xEnd = ((anim.time + anim.duration) / duration) * canvas.width;

      ctx.fillStyle = def.category === "in" ? "rgba(52, 211, 153, 0.12)" : "rgba(251, 146, 60, 0.12)";
      ctx.fillRect(xStart, 0, xEnd - xStart, canvas.height);

      const edgeColor = def.category === "in" ? "rgba(52, 211, 153, 0.9)" : "rgba(251, 146, 60, 0.9)";
      ctx.fillStyle = edgeColor;
      ctx.fillRect(xStart, 0, dpr * 1.5, canvas.height);
      ctx.fillRect(xEnd - dpr * 1.5, 0, dpr * 1.5, canvas.height);
    }
  }, [layer, duration, width]);

  // Hit-test: determines animation + drag mode based on category
  // IN:  left edge = move (anchor), right edge = resize (duration)
  // OUT: right edge = move (anchor), left edge = resize (duration)
  const hitTest = useCallback((clientX: number): { animId: string; mode: DragMode; category: "in" | "out"; px: number } | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper || duration <= 0) return null;
    const rect = wrapper.getBoundingClientRect();
    const px = clientX - rect.left;
    const anims = layer.animations ?? [];

    for (const anim of anims) {
      const def = ANIMATION_DEFS[anim.type];
      if (!def) continue;
      const startPx = (anim.time / duration) * width;
      const endPx = ((anim.time + anim.duration) / duration) * width;
      const cat = def.category as "in" | "out";

      // Left edge hit
      if (px >= startPx - OUTER_PAD && px <= startPx + EDGE_ZONE) {
        // IN: left = move, OUT: left = resize
        return { animId: anim.id, mode: cat === "in" ? "move" : "resize", category: cat, px };
      }
      // Right edge hit
      if (px >= endPx - EDGE_ZONE && px <= endPx + OUTER_PAD) {
        // IN: right = resize, OUT: right = move
        return { animId: anim.id, mode: cat === "in" ? "resize" : "move", category: cat, px };
      }
      // Middle = always move
      if (px > startPx + EDGE_ZONE && px < endPx - EDGE_ZONE) {
        return { animId: anim.id, mode: "move", category: cat, px };
      }
    }
    return null;
  }, [layer.animations, duration, width]);

  // Hover cursor
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragTarget) return;
    const hit = hitTest(e.clientX);
    setHoverCursor(hit ? (hit.mode === "move" ? "grab" : "ew-resize") : "default");
  }, [hitTest, dragTarget]);

  // Start drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onUpdateAnimation) return;
    const hit = hitTest(e.clientX);
    if (!hit) return;
    e.stopPropagation();
    e.preventDefault();
    const anim = (layer.animations ?? []).find((a) => a.id === hit.animId);
    if (!anim) return;
    onCommit?.();
    const startPx = (anim.time / duration) * width;
    setDragTarget({
      animId: hit.animId,
      mode: hit.mode,
      category: hit.category,
      grabOffset: hit.px - startPx,
      initialTime: anim.time,
      initialDuration: anim.duration,
    });
  }, [hitTest, layer.animations, duration, width, onUpdateAnimation, onCommit]);

  // Drag handling
  useEffect(() => {
    if (!dragTarget || !onUpdateAnimation) return;
    const MIN_DURATION = 0.05;

    const onMove = (e: MouseEvent) => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const t = Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration));

      if (dragTarget.mode === "move") {
        // Translate: duration stays constant, only time changes
        const px = e.clientX - rect.left;
        const newStartPx = px - dragTarget.grabOffset;
        const newTime = (newStartPx / width) * duration;
        const clamped = Math.max(0, Math.min(duration - dragTarget.initialDuration, newTime));
        onUpdateAnimation(layer.id, dragTarget.animId, { time: clamped });
      } else {
        // Resize: change duration, keep anchor edge fixed
        if (dragTarget.category === "in") {
          // IN resize = drag right edge, start stays fixed
          const start = dragTarget.initialTime;
          const newEnd = Math.max(start + MIN_DURATION, Math.min(t, duration));
          onUpdateAnimation(layer.id, dragTarget.animId, { duration: newEnd - start });
        } else {
          // OUT resize = drag left edge, end stays fixed
          const end = dragTarget.initialTime + dragTarget.initialDuration;
          const newTime = Math.max(0, Math.min(t, end - MIN_DURATION));
          onUpdateAnimation(layer.id, dragTarget.animId, { time: newTime, duration: end - newTime });
        }
      }
    };

    const onUp = () => setDragTarget(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragTarget, duration, width, layer.id, onUpdateAnimation]);

  const activeCursor = dragTarget
    ? (dragTarget.mode === "move" ? "grabbing" : "ew-resize")
    : hoverCursor;

  return (
    <div
      ref={wrapperRef}
      style={{ width, height: HEIGHT, cursor: activeCursor, position: "relative" }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseLeave={() => !dragTarget && setHoverCursor("default")}
    >
      <canvas
        ref={canvasRef}
        style={{ width, height: HEIGHT, display: "block", borderRadius: 4 }}
      />
    </div>
  );
}

/* ── Main component ─────────────────────────────────────── */

export default function PlaybackBar({
  currentTime, duration, playing,
  trimStart, trimEnd,
  onSeek, onTogglePlay, onTrimChange,
  waveform,
  chatTimestamps,
  subtitleWords,
  selectedLayer,
  onUpdateAnimation,
  onCommitAnimation,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [trimDragging, setTrimDragging] = useState<TrimDragTarget>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // Layer visibility toggles
  const [showWaveform, setShowWaveform] = useState(true);
  const [showChat, setShowChat] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(true);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  // Track width for waveform canvas sizing
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setTrackWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const timeFromX = useCallback(
    (clientX: number) => {
      if (!trackRef.current || duration <= 0) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  // Clamp time to trim bounds
  const clampToTrim = useCallback(
    (t: number) => Math.max(trimStart, Math.min(t, trimEnd)),
    [trimStart, trimEnd],
  );

  // Playhead drag
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => onSeek(clampToTrim(timeFromX(e.clientX)));
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, timeFromX, onSeek, clampToTrim]);

  // Trim handle drag
  useEffect(() => {
    if (!trimDragging) return;
    const MIN_TRIM_DURATION = 0.5;
    const onMove = (e: MouseEvent) => {
      const t = timeFromX(e.clientX);
      if (trimDragging === "start") {
        onTrimChange(Math.max(0, Math.min(t, trimEnd - MIN_TRIM_DURATION)), trimEnd);
      } else {
        onTrimChange(trimStart, Math.min(duration, Math.max(t, trimStart + MIN_TRIM_DURATION)));
      }
    };
    const onUp = () => setTrimDragging(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [trimDragging, timeFromX, trimStart, trimEnd, duration, onTrimChange]);

  const ticks: number[] = [];
  if (duration > 0) {
    const step = duration <= 10 ? 1 : duration <= 30 ? 2 : duration <= 60 ? 5 : 10;
    for (let t = 0; t <= duration; t += step) ticks.push(t);
  }

  const hasTrim = trimStart > 0 || trimEnd < duration;
  const trimmedDuration = trimEnd - trimStart;

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-zinc-950/80">
      {/* Timeline track */}
      <div className="px-4 pt-3 pb-1">
        {/* Ruler */}
        <div className="relative h-4 text-[9px] text-zinc-600 font-mono select-none">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
              {fmtShort(t)}
            </span>
          ))}
        </div>

        {/* Track */}
        <div
          ref={trackRef}
          className="relative h-10 bg-white/[0.03] rounded-lg cursor-pointer select-none overflow-hidden"
          onMouseDown={(e) => {
            if (trimDragging) return;
            onSeek(clampToTrim(timeFromX(e.clientX)));
            setDragging(true);
          }}
        >
          {/* Waveform */}
          {showWaveform && waveform && waveform.length > 0 && trackWidth > 0 && (
            <WaveformCanvas peaks={waveform} width={trackWidth} height={40} />
          )}

          {/* Chat message dots */}
          {showChat && chatTimestamps && chatTimestamps.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {chatTimestamps.map((t, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 rounded-full bg-blue-400/50"
                  style={{
                    left: `${pct(t)}%`,
                    bottom: 3,
                    transform: "translateX(-50%)",
                  }}
                />
              ))}
            </div>
          )}

          {/* Subtitle word markers */}
          {showSubtitles && subtitleWords && subtitleWords.length > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 pointer-events-none">
              {subtitleWords.map((w, i) => (
                <div
                  key={i}
                  className="absolute top-0 h-full bg-emerald-400/40 rounded-sm"
                  style={{
                    left: `${pct(w.start)}%`,
                    width: `${Math.max(0.2, pct(w.end) - pct(w.start))}%`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Dimmed regions outside trim */}
          {hasTrim && (
            <>
              <div
                className="absolute top-0 h-full bg-black/50 rounded-l-lg z-[1]"
                style={{ left: 0, width: `${pct(trimStart)}%` }}
              />
              <div
                className="absolute top-0 h-full bg-black/50 rounded-r-lg z-[1]"
                style={{ left: `${pct(trimEnd)}%`, width: `${100 - pct(trimEnd)}%` }}
              />
            </>
          )}

          {/* Active trim region highlight */}
          <div
            className="absolute top-0 h-full bg-white/[0.03]"
            style={{ left: `${pct(trimStart)}%`, width: `${pct(trimEnd) - pct(trimStart)}%` }}
          />

          {/* Trim start handle */}
          <div
            className="absolute top-0 h-full z-20 group"
            style={{ left: `${pct(trimStart)}%`, transform: "translateX(-50%)" }}
            onMouseDown={(e) => { e.stopPropagation(); setTrimDragging("start"); }}
          >
            <div className="w-1 h-full bg-white group-hover:bg-zinc-200 cursor-ew-resize rounded-full transition-colors" />
            <div className="absolute top-1/2 -translate-y-1/2 -left-1.5 w-4 h-8 flex items-center justify-center cursor-ew-resize">
              <div className="w-0.5 h-4 bg-white group-hover:bg-zinc-200 rounded-full transition-colors" />
            </div>
          </div>

          {/* Trim end handle */}
          <div
            className="absolute top-0 h-full z-20 group"
            style={{ left: `${pct(trimEnd)}%`, transform: "translateX(-50%)" }}
            onMouseDown={(e) => { e.stopPropagation(); setTrimDragging("end"); }}
          >
            <div className="w-1 h-full bg-white group-hover:bg-zinc-200 cursor-ew-resize rounded-full transition-colors" />
            <div className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-4 h-8 flex items-center justify-center cursor-ew-resize">
              <div className="w-0.5 h-4 bg-white group-hover:bg-zinc-200 rounded-full transition-colors" />
            </div>
          </div>

          {/* Playhead */}
          <div
            className="absolute top-0 h-full z-10 pointer-events-none"
            style={{ left: `${pct(currentTime)}%` }}
          >
            <div className="w-0.5 h-full bg-white/90 -translate-x-1/2" />
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 bg-white rounded-b-sm" />
          </div>
        </div>

        {/* Layer lifetime bar */}
        {selectedLayer && selectedLayer.animations && selectedLayer.animations.length > 0 && trackWidth > 0 && (
          <div className="mt-1">
            <LayerLifetimeBar
              layer={selectedLayer}
              duration={duration}
              width={trackWidth}
              onUpdateAnimation={onUpdateAnimation}
              onCommit={onCommitAnimation}
            />
          </div>
        )}

        {/* Legend chips — clickable toggles */}
        {(waveform || chatTimestamps || subtitleWords) && (
          <div className="flex items-center gap-1.5 mt-1">
            {waveform && (
              <button
                onClick={() => setShowWaveform((v) => !v)}
                className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  showWaveform
                    ? "border-white/[0.15] bg-white/[0.06] text-zinc-200"
                    : "border-white/[0.06] bg-transparent text-zinc-600"
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${showWaveform ? "bg-white" : "bg-zinc-700"}`} />
                audio
              </button>
            )}
            {chatTimestamps && chatTimestamps.length > 0 && (
              <button
                onClick={() => setShowChat((v) => !v)}
                className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  showChat
                    ? "border-blue-500/30 bg-blue-500/10 text-blue-300"
                    : "border-white/[0.06] bg-transparent text-zinc-600"
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${showChat ? "bg-blue-400" : "bg-zinc-700"}`} />
                chat
              </button>
            )}
            {subtitleWords && subtitleWords.length > 0 && (
              <button
                onClick={() => setShowSubtitles((v) => !v)}
                className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
                  showSubtitles
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/[0.06] bg-transparent text-zinc-600"
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${showSubtitles ? "bg-emerald-400" : "bg-zinc-700"}`} />
                sous-titres
              </button>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-4 pb-2.5 pt-1">
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlay}
            className="w-8 h-8 rounded-md bg-white/[0.05] hover:bg-white/[0.1] flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
          >
            {playing ? (
              <Pause className="w-4 h-4" fill="currentColor" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
            )}
          </button>

          <span className="text-[11px] font-mono text-zinc-400">
            {fmt(currentTime)} <span className="text-zinc-600">/ {fmt(duration)}</span>
          </span>

          {hasTrim && (
            <span className="text-[10px] font-mono text-white/70 ml-1">
              trim {fmt(trimmedDuration)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span><kbd className="text-zinc-500">I</kbd>/<kbd className="text-zinc-500">O</kbd> trim</span>
          <span><kbd className="text-zinc-500">←→</kbd> ±5s</span>
          <span><kbd className="text-zinc-500">⇧←→</kbd> ±1f</span>
          <span><kbd className="text-zinc-500">Space</kbd> play</span>
        </div>
      </div>
    </div>
  );
}
