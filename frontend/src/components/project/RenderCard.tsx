import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download, Play, Trash2, X } from "lucide-react";
import { clipThumbUrl, clipUrl, type RenderStatus } from "../../lib/api";

/** A vertical export: its first frame (or the video once played), state, download */
export default function RenderCard({
  jobId,
  render,
  queued,
  onDelete,
}: {
  jobId: string;
  render: RenderStatus;
  /** Waiting for the render in progress */
  queued: boolean;
  onDelete?: (render: RenderStatus) => void;
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const done = render.status === "done" && render.output_filename;
  const failed = render.status === "error";
  const waiting = render.status === "pending" || queued;

  return (
    <article className="group flex flex-col gap-2.5">
      <div className="relative aspect-[9/16] rounded-[16px] overflow-hidden border border-white/10 bg-black shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]">
        {done && playing ? (
          <video src={clipUrl(jobId, render.output_filename!)} controls autoPlay className="w-full h-full object-cover rounded-none" />
        ) : (
          <>
            <img
              src={done ? clipThumbUrl(jobId, render.output_filename!) : clipThumbUrl(jobId, render.clip_filename)}
              alt=""
              className={`w-full h-full object-cover ${done ? "" : "brightness-[0.45] grayscale-[0.5]"}`}
            />
            {done && (
              <button
                onClick={() => setPlaying(true)}
                aria-label={t("exportStep.play")}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[52px] h-[52px] rounded-full grid place-items-center glass-chip border border-white/30 text-white hover:scale-105 transition-transform"
              >
                <Play className="w-[18px] h-[18px] translate-x-[1px]" fill="currentColor" />
              </button>
            )}
          </>
        )}

        {onDelete && !playing && (render.status === "done" || render.status === "error") && (
          <button
            onClick={() => onDelete(render)}
            aria-label={t("exports.delete")}
            title={t("exports.delete")}
            className="absolute top-2 left-2 btn btn-icon btn-sm glass-chip text-white/80 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
        {done ? (
          !playing && (
            <span className="absolute top-2.5 right-2.5 chip bg-accent text-accent-ink">
              <Check className="w-3 h-3" strokeWidth={3.4} /> {t("exportStep.ready")}
            </span>
          )
        ) : failed ? (
          <span className="absolute top-2.5 right-2.5 chip chip-danger">
            <X className="w-3 h-3" /> {t("exportStep.failed")}
          </span>
        ) : waiting ? (
          <span className="absolute top-2.5 right-2.5 chip glass-chip text-ink-2">{t("exportStep.queued")}</span>
        ) : (
          <div className="absolute inset-x-3 bottom-3 p-3 rounded-[12px] glass-bar">
            <div className="flex justify-between items-baseline text-[12.5px]">
              <span className="font-semibold text-white">{t("exportStep.rendering")}</span>
              <span className="mono font-semibold text-white">{render.progress} %</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-white/15 overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${render.progress}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-white truncate">{render.clip_name ?? render.clip_filename}</span>
        {render.size_mb ? <span className="mono text-[12px] text-ink-3 whitespace-nowrap">{Math.round(render.size_mb)} Mo</span> : null}
      </div>
      {done && render.url && (
        <a href={render.url} className="btn btn-glass btn-sm self-start">
          <Download className="w-[15px] h-[15px]" /> {t("exportStep.download")}
        </a>
      )}
      {failed && render.error && <p className="text-[12px] text-red-300 line-clamp-3">{render.error}</p>}
    </article>
  );
}
