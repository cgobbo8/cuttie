import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { clipThumbUrl, clipUrl } from "../../lib/api";
import { clock } from "../../lib/format";
import type { Moment } from "../../lib/moments";

export interface MomentPlayerHandle {
  toggle: () => void;
  /** Jump to a time of the clip and play */
  playFrom: (seconds: number) => void;
}

interface Props {
  jobId: string;
  moment: Moment;
  categoryLabel: string | null;
  /** Start playing as soon as the clip is ready (after a user action) */
  autoPlay: boolean;
  onTrimChange: (trim: [number, number] | null) => void;
  /** Decision row, under the trim bar */
  children?: ReactNode;
}

const FILMSTRIP_FRAMES = 10;
const MIN_TRIM = 1;

/** Pointer drag helper: calls `onMove` with the pointer's position as a 0-1 ratio of `el` */
function dragRatio(e: ReactPointerEvent, el: HTMLElement, onMove: (ratio: number) => void, onEnd?: () => void) {
  e.preventDefault();
  e.stopPropagation();
  const update = (clientX: number) => {
    const rect = el.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };
  update(e.clientX);
  // Listen on the window so the drag survives leaving the element
  const move = (ev: PointerEvent) => update(ev.clientX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd?.();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

const MomentPlayer = forwardRef<MomentPlayerHandle, Props>(function MomentPlayer(
  { jobId, moment, categoryLabel, autoPlay, onTrimChange, children },
  ref,
) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(moment.duration);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [trim, setTrim] = useState<[number, number]>(moment.trim ?? [0, moment.duration]);
  const trimRef = useRef(trim);
  trimRef.current = trim;

  // New moment: reset everything (the <video> is keyed on the file)
  useEffect(() => {
    setDuration(moment.duration);
    setCurrent(moment.trim?.[0] ?? 0);
    setTrim(moment.trim ?? [0, moment.duration]);
    setPlaying(false);
  }, [moment.filename]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const [a, b] = trimRef.current;
      if (video.currentTime < a || video.currentTime >= b - 0.1) video.currentTime = a;
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);
  const playFrom = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const [a, b] = trimRef.current;
    video.currentTime = Math.min(Math.max(seconds, a), b - 0.1);
    video.play().catch(() => {});
  }, []);
  useImperativeHandle(ref, () => ({ toggle, playFrom }), [toggle, playFrom]);

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const [a, b] = trimRef.current;
    video.currentTime = Math.min(Math.max(time, a), b);
    setCurrent(video.currentTime);
  };

  const commitTrim = () => {
    const [a, b] = trimRef.current;
    const full = a <= 0.05 && b >= duration - 0.05;
    onTrimChange(full ? null : [a, b]);
  };

  const pct = (time: number) => `${(time / Math.max(duration, 0.1)) * 100}%`;
  const keys = moment.hp.llm?.key_moments ?? [];

  return (
    <article className="glass-strong rounded-[20px] p-2.5">
      <div ref={boxRef} className="relative aspect-video rounded-[13px] overflow-hidden bg-black group/player">
        <video
          key={moment.filename}
          ref={videoRef}
          src={clipUrl(jobId, moment.filename)}
          poster={clipThumbUrl(jobId, moment.filename, { width: 1280 })}
          preload="metadata"
          playsInline
          muted={muted}
          className="w-full h-full object-contain rounded-none"
          onClick={toggle}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) {
              setDuration(d);
              if (!moment.trim) setTrim([0, d]);
              e.currentTarget.currentTime = moment.trim?.[0] ?? 0;
            }
            if (autoPlay) e.currentTarget.play().catch(() => {});
          }}
          onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime;
            setCurrent(time);
            if (time >= trimRef.current[1] - 0.05 && !e.currentTarget.paused) {
              e.currentTarget.pause();
              e.currentTarget.currentTime = trimRef.current[0];
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />

        <div className="absolute top-3 left-3 flex gap-1.5">
          <span className="chip glass-chip text-white h-[26px] mono">#{moment.rank}</span>
          {categoryLabel && <span className="chip glass-chip text-white h-[26px]">{categoryLabel}</span>}
        </div>
        <span className="absolute top-3 right-3 chip h-[26px] bg-accent text-accent-ink">
          <span className="mono">{moment.score}</span>
          <span className="font-medium opacity-70">/ 100</span>
        </span>

        {/* Glass transport bar over the video */}
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-3 h-[52px] pl-2 pr-3 rounded-[14px] glass-bar">
          <button onClick={toggle} aria-label={playing ? t("project.pause") : t("project.play")} className="btn btn-primary btn-icon w-9 h-9 rounded-[10px]">
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />}
          </button>
          <span className="mono text-[12.5px] text-ink-2 whitespace-nowrap">
            {clock(current)} / {clock(duration)}
          </span>
          <div
            ref={scrubRef}
            className="relative flex-1 h-[22px] cursor-pointer"
            onPointerDown={(e) => dragRatio(e, scrubRef.current!, (r) => seek(r * duration))}
          >
            <div className="absolute inset-x-0 top-[9px] h-1 rounded-full bg-white/[0.22]" />
            <div className="absolute top-[9px] h-1 rounded-full bg-white/[0.18]" style={{ left: pct(trim[0]), width: pct(trim[1] - trim[0]) }} />
            <div className="absolute left-0 top-[9px] h-1 rounded-full bg-ink" style={{ width: pct(current) }} />
            {keys.map((k) => (
              <span
                key={`${k.time}-${k.label}`}
                title={k.label}
                className="absolute top-[7px] w-2 h-2 -ml-1 rounded-full bg-accent shadow-[0_0_0_2px_rgba(11,11,12,0.7)]"
                style={{ left: pct(Math.min(k.time, duration)) }}
              />
            ))}
            <span className="absolute top-1 w-3.5 h-3.5 -ml-[7px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]" style={{ left: pct(current) }} />
          </div>
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? t("project.unmute") : t("project.mute")} className="text-ink-2 hover:text-white transition-colors">
            {muted ? <VolumeX className="w-[18px] h-[18px]" /> : <Volume2 className="w-[18px] h-[18px]" />}
          </button>
          <button onClick={() => boxRef.current?.requestFullscreen?.()} aria-label={t("project.fullscreen")} className="text-ink-2 hover:text-white transition-colors">
            <Maximize className="w-[17px] h-[17px]" />
          </button>
        </div>
      </div>

      {/* Trim: drag the handles to cut the start / end; click or drag elsewhere to move through the clip */}
      <div className="flex items-center gap-3 px-1.5 pt-3 pb-1">
        <div className="w-[92px] flex-none">
          <div className="text-[11.5px] text-ink-3">{t("project.start")}</div>
          <div className="mono text-[13px] font-medium text-white">{clock(trim[0])}</div>
        </div>
        <div
          ref={stripRef}
          className="relative flex-1 h-[52px] rounded-[9px] overflow-hidden bg-black select-none cursor-pointer touch-none"
          onPointerDown={(e) => dragRatio(e, stripRef.current!, (r) => seek(r * duration))}
        >
          <div className="absolute inset-0 flex">
            {Array.from({ length: FILMSTRIP_FRAMES }, (_, i) => (
              <img
                key={i}
                src={clipThumbUrl(jobId, moment.filename, { time: ((i + 0.5) * moment.duration) / FILMSTRIP_FRAMES })}
                alt=""
                draggable={false}
                className="flex-1 min-w-0 h-full object-cover"
              />
            ))}
          </div>
          <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: pct(trim[0]) }} />
          <div className="absolute inset-y-0 right-0 bg-black/70" style={{ width: `calc(100% - ${pct(trim[1])})` }} />
          <div className="absolute inset-y-0 border-y-2 border-accent pointer-events-none" style={{ left: pct(trim[0]), width: pct(trim[1] - trim[0]) }} />
          {keys.map((k) => (
            <span
              key={`${k.time}-${k.label}`}
              className="absolute top-0 w-1.5 h-1.5 -ml-[3px] rounded-b-full bg-accent pointer-events-none"
              style={{ left: pct(Math.min(k.time, duration)) }}
            />
          ))}
          <span className="absolute inset-y-0 w-0.5 -ml-px bg-white shadow-[0_0_6px_rgba(0,0,0,0.6)] pointer-events-none" style={{ left: pct(current) }}>
            <span className="absolute -top-px left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white" />
          </span>
          {(["start", "end"] as const).map((side) => (
            <span
              key={side}
              role="slider"
              aria-label={side === "start" ? t("project.trimStart") : t("project.trimEnd")}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(side === "start" ? trim[0] : trim[1])}
              tabIndex={0}
              onPointerDown={(e) =>
                dragRatio(
                  e,
                  stripRef.current!,
                  (r) => {
                    const time = r * duration;
                    const [a, b] = trimRef.current;
                    const next: [number, number] = side === "start" ? [Math.min(time, b - MIN_TRIM), b] : [a, Math.max(time, a + MIN_TRIM)];
                    // Keep the ref in step: the drag can end before React renders
                    trimRef.current = next;
                    setTrim(next);
                    if (videoRef.current) videoRef.current.currentTime = side === "start" ? next[0] : next[1];
                  },
                  commitTrim,
                )
              }
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                e.stopPropagation();
                const step = e.key === "ArrowLeft" ? -1 : 1;
                const [a, b] = trimRef.current;
                const next: [number, number] =
                  side === "start" ? [Math.min(Math.max(0, a + step), b - MIN_TRIM), b] : [a, Math.max(Math.min(duration, b + step), a + MIN_TRIM)];
                trimRef.current = next;
                setTrim(next);
                commitTrim();
              }}
              className={`absolute inset-y-0 w-3 rounded-[4px] bg-accent cursor-ew-resize grid place-items-center ${side === "start" ? "" : "-translate-x-full"}`}
              style={{ left: pct(side === "start" ? trim[0] : trim[1]) }}
            >
              <span className="w-0.5 h-4 rounded-full bg-accent-ink/60" />
            </span>
          ))}
        </div>
        <div className="w-[92px] flex-none text-right">
          <div className="text-[11.5px] text-ink-3">{t("project.end")}</div>
          <div className="mono text-[13px] font-medium text-white">{clock(trim[1])}</div>
        </div>
      </div>

      {children}
    </article>
  );
});

export default MomentPlayer;
