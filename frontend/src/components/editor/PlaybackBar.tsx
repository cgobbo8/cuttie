import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

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
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
}

export default function PlaybackBar({ currentTime, duration, playing, onSeek, onTogglePlay }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);

  const timeFromX = useCallback(
    (clientX: number) => {
      if (!trackRef.current || duration <= 0) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => onSeek(timeFromX(e.clientX));
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragging, timeFromX, onSeek]);

  const ticks: number[] = [];
  if (duration > 0) {
    const step = duration <= 10 ? 1 : duration <= 30 ? 2 : duration <= 60 ? 5 : 10;
    for (let t = 0; t <= duration; t += step) ticks.push(t);
  }

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
          className="relative h-10 bg-white/[0.03] rounded-lg cursor-pointer select-none"
          onMouseDown={(e) => {
            onSeek(timeFromX(e.clientX));
            setDragging(true);
          }}
        >
          {/* Progress */}
          <div
            className="absolute top-0 h-full bg-purple-500/10 rounded-l-lg"
            style={{ width: `${pct(currentTime)}%` }}
          />

          {/* Playhead */}
          <div
            className="absolute top-0 h-full z-10 pointer-events-none"
            style={{ left: `${pct(currentTime)}%` }}
          >
            <div className="w-0.5 h-full bg-white/90 -translate-x-1/2" />
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-2 bg-white rounded-b-sm" />
          </div>
        </div>
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
        </div>

        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span><kbd className="text-zinc-500">Space</kbd> play</span>
          <span><kbd className="text-zinc-500">Esc</kbd> quitter</span>
        </div>
      </div>
    </div>
  );
}
