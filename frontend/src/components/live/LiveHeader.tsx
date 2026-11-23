import type { ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import type { JobResponse } from "../../lib/api";
import { hoursMinutes, shortDate, splitVodTitle } from "../../lib/format";
import Stepper, { type ProjectStep } from "../project/Stepper";

interface Props {
  job: Pick<JobResponse, "job_id" | "custom_title" | "vod_title" | "stream_date" | "vod_duration_seconds" | "vod_game">;
  /** The step on screen */
  step: ProjectStep;
  /** How many videos of this live are kept (clips, sequences, compilations): nothing to edit or export without one */
  kept: number;
  /** The analysis still runs: nothing else can be opened */
  processing?: boolean;
  /** After the live's date, length and game (its summary, on the first step) */
  extra?: ReactNode;
}

/**
 * The top of every page of a live: the live, and the four steps everything it gives goes
 * through. The steps are the only navigation of a live, whatever a video is made from.
 */
export default function LiveHeader({ job, step, kept, processing = false, extra }: Props) {
  const { t, i18n } = useTranslation();
  const { tag, title } = splitVodTitle(job.custom_title || job.vod_title);
  const id = job.job_id;
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="min-w-0">
        <Link to="/projects" className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
          <ArrowLeft className="w-4 h-4" /> {t("sidebar.projects")}
        </Link>
        <h1 className="mt-2 text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">{title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-2">
          {job.stream_date && <span>{shortDate(job.stream_date, i18n.language)}</span>}
          {job.vod_duration_seconds ? (
            <>
              <span aria-hidden className="opacity-50">·</span>
              <span className="tabular-nums">{hoursMinutes(job.vod_duration_seconds)}</span>
            </>
          ) : null}
          {job.vod_game && (
            <>
              <span aria-hidden className="opacity-50">·</span>
              <span>{job.vod_game}</span>
            </>
          )}
          {tag && <span className="chip chip-neutral h-[22px] font-[550]">{tag}</span>}
          {extra}
        </div>
      </div>
      <Stepper
        current={processing ? "analyze" : step}
        links={{ analyze: `/${id}`, choose: `/${id}`, edit: `/${id}/montage`, export: `/${id}/export` }}
        locked={processing ? ["choose", "edit", "export"] : kept === 0 ? (["edit", "export"] as ProjectStep[]).filter((other) => other !== step) : []}
        detail={!processing && kept > 0 ? t("project.keptCount", { count: kept }) : undefined}
        detailOn="choose"
      />
    </header>
  );
}
