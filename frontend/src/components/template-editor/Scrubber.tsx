import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PlayerRef } from "@remotion/player";

/** The player's current frame, followed without re-rendering the whole editor (only the caller) */
export function usePlayerFrame(playerRef: RefObject<PlayerRef | null>): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let raf = 0;
    let last = -1;
    // Polled: survives the player mounting late or being replaced
    const tick = () => {
      const f = playerRef.current?.getCurrentFrame() ?? 0;
      if (f !== last) {
        last = f;
        setFrame(f);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playerRef]);
  return frame;
}

/** 0:12,3 */
export function useClock() {
  const { i18n } = useTranslation();
  const tenths = new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (seconds: number) => {
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const rest = tenths.format(Math.floor((s % 60) * 10) / 10);
    return `${m}:${rest.padStart(4, "0")}`;
  };
}

interface Props {
  playerRef: RefObject<PlayerRef | null>;
  durationInFrames: number;
  fps: number;
  /** The selected widget's time on screen, seconds */
  window?: { from: number; to: number } | null;
}

/**
 * The preview's timeline: click or drag anywhere to go there, arrow keys move
 * by a second (Shift: 5). The selected widget's time on screen is lit up.
 */
export default function Scrubber({ playerRef, durationInFrames, fps, window: span }: Props) {
  const { t } = useTranslation();
  const frame = usePlayerFrame(playerRef);
  const clock = useClock();
  const track = useRef<HTMLDivElement>(null);
  const duration = durationInFrames / fps;
  const last = Math.max(1, durationInFrames - 1);

  const seekAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    playerRef.current?.seekTo(Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const player = playerRef.current;
    const wasPlaying = player?.isPlaying() ?? false;
    player?.pause();
    seekAt(e.clientX);
    const move = (ev: PointerEvent) => seekAt(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (wasPlaying) playerRef.current?.play();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    // Not a nudge of the selected element
    e.preventDefault();
    e.stopPropagation();
    playerRef.current?.seekTo(Math.min(last, Math.max(0, frame + step * fps * (e.shiftKey ? 5 : 1))));
  };

  const pct = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;
  const now = frame / fps;

  return (
    <div className="flex flex-1 min-w-0 items-center gap-2 pl-1 select-none">

      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t("templateEditor.timeline")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 10) / 10}
        aria-valuenow={Math.round(now * 10) / 10}
        aria-valuetext={clock(now)}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className="group/scrub relative flex-1 h-7 cursor-pointer touch-none outline-none rounded-[6px] focus-visible:shadow-[0_0_0_2px_var(--color-accent-soft)]"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -mt-[3px] rounded-full bg-white/[0.12]" />
        {span && (
          <div
            className="absolute top-1/2 h-3 -mt-1.5 rounded-[4px] bg-accent/25 border border-accent/60"
            style={{ left: pct(span.from), width: `calc(${pct(span.to)} - ${pct(span.from)})` }}
          />
        )}
        <div className="absolute left-0 top-1/2 h-1.5 -mt-[3px] rounded-full bg-white/70" style={{ width: pct(now) }} />
        <span
          className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full bg-white shadow-[0_1px_6px_rgba(0,0,0,0.6)] transition-transform group-hover/scrub:scale-110"
          style={{ left: pct(now) }}
        />
      </div>
      <span className="mono text-[11px] text-white whitespace-nowrap">
        {clock(now)}
        <span className="text-ink-3"> / {clock(duration).replace(/[.,]\d$/, "")}</span>
      </span>
    </div>
  );
}
