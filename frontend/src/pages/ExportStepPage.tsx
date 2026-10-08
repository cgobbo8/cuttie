import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Loader2 } from "lucide-react";
import { clipThumbUrl, getJobStatus, listRenders, type JobResponse, type RenderStatus } from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { splitVodTitle } from "../lib/format";
import { activeRenderId, latestPerClip } from "../lib/renders";
import RenderCard from "../components/project/RenderCard";
import Stepper from "../components/project/Stepper";

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
  const activeId = useMemo(() => activeRenderId(items), [items]);
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
