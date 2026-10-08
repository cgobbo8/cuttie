import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Download, Loader2, Play, X } from "lucide-react";
import { clipThumbUrl, clipUrl, getJobStatus, listRenders, type JobResponse, type RenderStatus } from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { splitVodTitle } from "../lib/format";
import Stepper from "../components/project/Stepper";

/** The latest render of each clip of this project */
function latestPerClip(renders: RenderStatus[], jobId: string): RenderStatus[] {
  const byClip = new Map<string, RenderStatus>();
  for (const r of renders) {
    if (r.job_id !== jobId) continue;
    const prev = byClip.get(r.clip_filename);
    if (!prev || r.created_at > prev.created_at) byClip.set(r.clip_filename, r);
  }
  return [...byClip.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function RenderCard({ jobId, render, queued }: { jobId: string; render: RenderStatus; queued: boolean }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const done = render.status === "done" && render.output_filename;
  const failed = render.status === "error";
  const waiting = render.status === "pending" || queued;

  return (
    <article className="flex flex-col gap-2.5">
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

export default function ExportStepPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const [job, setJob] = useState<JobResponse | null>(null);
  const [renders, setRenders] = useState<RenderStatus[] | null>(null);

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId).then(setJob).catch(() => navigate("/"));
  }, [jobId, navigate]);

  const load = useCallback(() => {
    listRenders()
      .then(setRenders)
      .catch(() => setRenders([]));
  }, []);
  useEffect(load, [load]);

  const items = useMemo(() => (renders && jobId ? latestPerClip(renders, jobId) : []), [renders, jobId]);
  // Renders run one at a time: only the furthest along is really rendering
  const activeId = useMemo(() => {
    const running = items.filter((r) => r.status === "rendering");
    return (running.find((r) => r.progress > 0) ?? running[0])?.render_id ?? null;
  }, [items]);
  const busy = items.some((r) => r.status === "pending" || r.status === "rendering");
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [busy, load]);

  useBackdrop(items[0] && jobId ? clipThumbUrl(jobId, items[0].clip_filename) : null);

  if (!jobId) return null;
  const ready = items.filter((r) => r.status === "done").length;
  const progress = items.length ? Math.round(items.reduce((sum, r) => sum + (r.status === "done" ? 100 : r.progress), 0) / items.length) : 0;
  const { title } = splitVodTitle(job?.custom_title || job?.vod_title);

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Link to={`/${jobId}/montage`} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {t("project.step.edit")}
          </Link>
          <h1 className="mt-2 text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">
            {busy ? t("exportStep.titleBusy") : t("exportStep.title")}
          </h1>
          {title && <p className="mt-2 text-[13.5px] text-ink-2">{title}</p>}
        </div>
        <Stepper current="export" links={{ analyze: `/${jobId}`, choose: `/${jobId}`, edit: `/${jobId}/montage` }} />
      </header>

      {renders === null ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 glass rounded-[18px] p-6 max-w-[560px]">
          <p className="text-[15px] text-ink-2">{t("exportStep.empty")}</p>
          <Link to={`/${jobId}/montage`} className="btn btn-primary mt-4">{t("exportStep.toEdit")}</Link>
        </div>
      ) : (
        <>
          <section className="mt-[22px] glass rounded-[18px] px-5 py-4 flex flex-wrap items-center gap-[22px]">
            <div className="flex-[1_1_360px] min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[15px] font-semibold text-white">{t("exportStep.readyCount", { ready, total: items.length })}</span>
                {busy && <span className="text-[12.5px] text-ink-3">{t("exportStep.keepOpen")}</span>}
              </div>
              <div className="mt-2.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-accent shadow-[0_0_14px_var(--color-accent-glow)] transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="flex gap-1.5">
              <span className="chip chip-neutral mono">1080 × 1920</span>
              <span className="chip chip-neutral mono">30 i/s</span>
              <span className="chip chip-neutral mono">MP4</span>
            </div>
          </section>

          <section className="mt-[22px] grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
            {items.map((r) => (
              <RenderCard key={r.render_id} jobId={jobId} render={r} queued={r.status === "rendering" && r.render_id !== activeId} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
