import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Pause, Play, Plus } from "lucide-react";
import { clipThumbUrl, clipUrl, type CompilationItem, type PieceState, type TranscriptWord } from "../../lib/api";
import { liveClock } from "../../lib/compilation";
import { dragRatio } from "../../lib/drag";
import { snapToWords } from "../../lib/montage";
import { Tooltip } from "../ui/Tooltip";

interface Props {
  jobId: string;
  /** A moment of the live: a search result looked at, or an item of the compilation */
  item: CompilationItem;
  /** Its clip, once cut from the live */
  piece: PieceState | undefined;
  /** The clip is being cut from the live */
  cutting: boolean;
  /** The words said in the clip: its cut lands between them */
  words?: TranscriptWord[];
  /** New bounds of the moment, live seconds (the clip is cut again when they leave it) */
  onChange: (start: number, end: number) => void;
  /** Templates this passage can be shown in (only for a passage of the compilation) */
  templates?: { key: string; name: string }[];
  /** Its own template, null: the video's */
  template?: string | null;
  /** The video's template, by name */
  videoTemplate?: string;
  onTemplate?: (key: string | null) => void;
  /** Plays as soon as it is there (not while the whole video plays next to it) */
  autoPlay?: boolean;
  /** Changes when something else starts playing: this one stops */
  hush?: number;
  /** It started playing */
  onPlay?: () => void;
}

const FRAMES = 8;
const MIN_LENGTH = 0.6;
/** What "+" adds on one side, seconds */
const MORE = 5;

/**
 * One moment of the live as it is, before any template: plays the part kept,
 * and its two handles move the cut inside the clip (a few seconds wider than
 * the moment). "+" on a side gives 5 s more of the live.
 */
export default function PiecePreview({ jobId, item, piece, cutting, words, onChange, templates, template, videoTemplate, onTemplate, autoPlay = true, hush, onPlay }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const ready = !!piece?.ready && piece.file_start !== null && piece.file_end !== null;
  const fileStart = piece?.file_start ?? item.start;
  const length = Math.max(0.1, (piece?.file_end ?? item.end) - fileStart);
  // The cut on the clip's clock
  const [cut, setCut] = useState<[number, number]>([item.start - fileStart, item.end - fileStart]);
  const cutRef = useRef(cut);
  cutRef.current = cut;
  const [current, setCurrent] = useState(cut[0]);
  const [playing, setPlaying] = useState(false);
  // Its clip cut again shows the new file
  const version = `${piece?.file_start}-${piece?.file_end}`;
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  useEffect(() => {
    if (hush) videoRef.current?.pause();
  }, [hush]);

  useEffect(() => {
    const next: [number, number] = [item.start - fileStart, item.end - fileStart];
    cutRef.current = next;
    setCut(next);
  }, [item.id, item.start, item.end, fileStart]);

  // A new moment plays from its start
  useEffect(() => {
    setPlaying(false);
    setCurrent(cutRef.current[0]);
  }, [item.id, version]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      const [a, b] = cutRef.current;
      if (video.currentTime < a - 0.05 || video.currentTime >= b - 0.1) video.currentTime = a;
      video.play().catch(() => {});
    } else video.pause();
  };

  const pct = (time: number) => `${Math.min(100, Math.max(0, (time / length) * 100))}%`;
  const more = (side: "start" | "end") => {
    const label = t(side === "start" ? "compilation.moreBefore" : "compilation.moreAfter");
    return (
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={label}
          disabled={cutting || (side === "start" && item.start <= 0)}
          onClick={() => (side === "start" ? onChange(Math.max(0, item.start - MORE), item.end) : onChange(item.start, item.end + MORE))}
          className="btn btn-glass btn-icon w-7 h-7 rounded-full flex-none"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />
        </button>
      </Tooltip>
    );
  };

  return (
    <div className="w-full">
      <div className="relative aspect-video rounded-[13px] overflow-hidden bg-black">
        {ready ? (
          <video
            key={`${item.id}-${version}`}
            ref={videoRef}
            src={clipUrl(jobId, piece!.file, version)}
            poster={clipThumbUrl(jobId, piece!.file, { width: 1280, time: Math.max(0, item.start - fileStart + 0.3), version })}
            preload="metadata"
            playsInline
            className="w-full h-full object-contain rounded-none"
            onClick={toggle}
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = cutRef.current[0];
              if (autoPlayRef.current) e.currentTarget.play().catch(() => {});
            }}
            onTimeUpdate={(e) => {
              const time = e.currentTarget.currentTime;
              setCurrent(time);
              if (time >= cutRef.current[1] - 0.04 && !e.currentTarget.paused) {
                e.currentTarget.pause();
                e.currentTarget.currentTime = cutRef.current[0];
              }
            }}
            onPlay={() => {
              setPlaying(true);
              onPlay?.();
            }}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-center px-6">
            <div className="flex flex-col items-center gap-2.5 text-[13px] text-ink-2">
              <Loader2 className="w-5 h-5 spinner text-ink-3" />
              {t("compilation.cuttingPiece")}
            </div>
          </div>
        )}
        {ready && (
          <button
            onClick={toggle}
            aria-label={playing ? t("project.pause") : t("project.play")}
            className="absolute left-3 bottom-3 btn btn-primary btn-icon w-9 h-9 rounded-[10px]"
          >
            {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />}
          </button>
        )}
        <span className="absolute top-3 left-3 chip glass-chip text-white h-[26px] mono">{liveClock(item.start)}</span>
        <span className="absolute top-3 right-3 chip glass-chip text-white h-[26px] mono">{(item.end - item.start).toFixed(1)} s</span>
      </div>

      {/* The cut inside the clip: drag the handles; + for 5 s more of the live */}
      <div className="flex items-center gap-2 pt-2.5">
        {more("start")}
        <div
          ref={stripRef}
          className="relative flex-1 h-[42px] rounded-[8px] overflow-hidden bg-black select-none cursor-pointer touch-none"
          onPointerDown={(e) =>
            ready &&
            dragRatio(e, stripRef.current!, (r) => {
              if (videoRef.current) videoRef.current.currentTime = r * length;
              setCurrent(r * length);
            })
          }
        >
          {ready && (
            <div className="absolute inset-0 flex">
              {Array.from({ length: FRAMES }, (_, i) => (
                <img
                  key={i}
                  src={clipThumbUrl(jobId, piece!.file, { time: ((i + 0.5) * length) / FRAMES, version })}
                  alt=""
                  draggable={false}
                  className="flex-1 min-w-0 h-full object-cover"
                />
              ))}
            </div>
          )}
          <div className="absolute inset-y-0 left-0 bg-black/70" style={{ width: pct(cut[0]) }} />
          <div className="absolute inset-y-0 right-0 bg-black/70" style={{ width: `calc(100% - ${pct(cut[1])})` }} />
          <div className="absolute inset-y-0 border-y-2 border-accent pointer-events-none" style={{ left: pct(cut[0]), width: pct(cut[1] - cut[0]) }} />
          {ready && <span className="absolute inset-y-0 w-0.5 -ml-px bg-white pointer-events-none" style={{ left: pct(current) }} />}
          {ready &&
            (["start", "end"] as const).map((side) => (
              <span
                key={side}
                role="slider"
                aria-label={side === "start" ? t("project.trimStart") : t("project.trimEnd")}
                aria-valuemin={0}
                aria-valuemax={Math.round(length)}
                aria-valuenow={Math.round(side === "start" ? cut[0] : cut[1])}
                tabIndex={0}
                onPointerDown={(e) =>
                  dragRatio(
                    e,
                    stripRef.current!,
                    (r, alt) => {
                      const raw = r * length;
                      const time = !alt && words?.length ? snapToWords(raw, words) : raw;
                      const [a, b] = cutRef.current;
                      const next: [number, number] = side === "start" ? [Math.min(Math.max(0, time), b - MIN_LENGTH), b] : [a, Math.max(Math.min(length, time), a + MIN_LENGTH)];
                      cutRef.current = next;
                      setCut(next);
                      if (videoRef.current) videoRef.current.currentTime = side === "start" ? next[0] : next[1];
                    },
                    () => onChange(fileStart + cutRef.current[0], fileStart + cutRef.current[1]),
                  )
                }
                className={`absolute inset-y-0 w-[9px] rounded-[3px] bg-accent cursor-ew-resize grid place-items-center ${side === "start" ? "" : "-translate-x-full"}`}
                style={{ left: pct(side === "start" ? cut[0] : cut[1]) }}
              >
                <span className="w-px h-3.5 rounded-full bg-accent-ink/60" />
              </span>
            ))}
        </div>
        {more("end")}
      </div>

      {/* The template of this passage alone, when it shouldn't look like the rest of the video */}
      {templates && onTemplate && (
        <label className="flex items-center gap-3 pt-3 px-0.5">
          <span className="text-[13px] text-ink-2 flex-none">{t("compilation.itemTemplate")}</span>
          <select
            value={template && templates.some((tpl) => tpl.key === template) ? template : ""}
            onChange={(e) => onTemplate(e.target.value || null)}
            className="select-arrow flex-1 min-w-0 h-9 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]"
          >
            <option value="">{t("compilation.sameAsVideo", { name: videoTemplate ?? "" })}</option>
            {templates.map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
