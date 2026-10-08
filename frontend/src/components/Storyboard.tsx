import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getStoryboard, type TwitchStoryboard } from "../lib/api";
import { clock } from "../lib/format";

interface Props {
  vodId: string;
  durationSeconds: number;
  /** Number of frames shown across the strip */
  tiles?: number;
  className?: string;
}

/** CSS for frame `index` of a Twitch seek-preview sprite sheet */
function tileStyle(sb: TwitchStoryboard, index: number): CSSProperties {
  const perSheet = sb.cols * sb.rows;
  const i = Math.min(Math.max(0, index), sb.count - 1);
  const sheet = sb.images[Math.floor(i / perSheet)] ?? sb.images[0];
  const cell = i % perSheet;
  const col = cell % sb.cols;
  const row = Math.floor(cell / sb.cols);
  return {
    backgroundImage: `url("${sheet}")`,
    backgroundSize: `${sb.cols * 100}% ${sb.rows * 100}%`,
    backgroundPosition: `${sb.cols > 1 ? (col / (sb.cols - 1)) * 100 : 0}% ${sb.rows > 1 ? (row / (sb.rows - 1)) * 100 : 0}%`,
  };
}

/**
 * The whole live at a glance: frames from Twitch's seek previews, with a
 * playhead that follows the mouse.
 */
export default function Storyboard({ vodId, durationSeconds, tiles = 8, className = "" }: Props) {
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null | undefined>(undefined);
  const [hover, setHover] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStoryboard(undefined);
    getStoryboard(vodId)
      .then((sb) => !cancelled && setStoryboard(sb))
      .catch(() => !cancelled && setStoryboard(null));
    return () => {
      cancelled = true;
    };
  }, [vodId]);

  const frames = useMemo(
    () => (storyboard ? Array.from({ length: tiles }, (_, k) => Math.round(((k + 0.5) * storyboard.count) / tiles)) : []),
    [storyboard, tiles],
  );

  if (storyboard === null) return null;

  const hoveredTile = hover === null ? null : Math.min(tiles - 1, Math.floor(hover * tiles));
  const endLabel = durationSeconds >= 3600 ? clock(durationSeconds).replace(/:\d\d$/, "") : clock(durationSeconds);

  const hours = Array.from({ length: Math.floor(durationSeconds / 3600) }, (_, i) => i + 1).filter(
    (h) => (h * 3600) / durationSeconds < 0.94,
  );

  return (
    <div className={`glass rounded-[16px] p-2.5 pb-1.5 ${className}`}>
      <div
        ref={stripRef}
        className="relative h-[88px] rounded-[9px] overflow-hidden flex cursor-crosshair"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {storyboard
          ? frames.map((index, k) => (
              <div
                key={k}
                className="flex-1 h-full transition-opacity duration-200"
                style={{
                  // The tile under the cursor scrubs through the live
                  ...tileStyle(storyboard, hoveredTile === k ? Math.round(hover! * (storyboard.count - 1)) : index),
                  opacity: hoveredTile === null || hoveredTile === k ? 1 : 0.55,
                }}
              />
            ))
          : Array.from({ length: tiles }, (_, k) => <div key={k} className="flex-1 h-full skeleton border-r border-black/20" />)}
        {hover !== null && (
          <>
            <div className="absolute top-0 bottom-0 w-[2px] bg-ink shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" style={{ left: `${hover * 100}%` }} />
            <span
              className="mono absolute top-2 -translate-x-1/2 h-[22px] px-[7px] rounded-[6px] flex items-center bg-black/75 text-[11.5px] font-medium text-white"
              style={{ left: `${Math.min(94, Math.max(6, hover * 100))}%` }}
            >
              {clock(hover * durationSeconds)}
            </span>
          </>
        )}
      </div>
      <div className="mono relative h-[22px] text-[11px] text-ink-3">
        <span className="absolute left-0.5 top-1.5">0:00</span>
        {hours.map((h) => (
          <span key={h} className="absolute top-1.5 -translate-x-1/2" style={{ left: `${((h * 3600) / durationSeconds) * 100}%` }}>
            {h}:00
          </span>
        ))}
        <span className="absolute right-0.5 top-1.5">{endLabel}</span>
      </div>
    </div>
  );
}
