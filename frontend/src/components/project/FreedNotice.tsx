import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Archive, ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { restoreProject, RestoreError, type JobResponse } from "../../lib/api";
import { useToast } from "../Toast";

/**
 * A project whose clips were deleted to free disk space: its exports stay, and
 * the clips can be cut again from the live while Twitch still has it.
 */
export default function FreedNotice({ job, exports, onRestored }: { job: JobResponse; exports?: number; onRestored: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [restoring, setRestoring] = useState(false);
  const [gone, setGone] = useState(false);

  const restore = async () => {
    setRestoring(true);
    try {
      const { failed } = await restoreProject(job.job_id);
      if (failed) toast.error(t("freed.partial", { count: failed }));
      else toast.success(t("freed.restored"));
      onRestored();
    } catch (err) {
      if (err instanceof RestoreError && err.reason === "gone") {
        setGone(true);
        toast.error(t("freed.gone"));
      } else {
        toast.error(t("freed.failed"));
      }
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="glass rounded-[18px] p-5 flex flex-wrap items-center gap-x-5 gap-y-4 max-w-[860px] animate-rise">
      <span className="w-11 h-11 rounded-[13px] bg-white/[0.07] grid place-items-center flex-none">
        <Archive className="w-5 h-5 text-ink-2" />
      </span>
      <div className="flex-[1_1_300px] min-w-0">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{t("freed.title")}</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2 max-w-[60ch]">
          {t("freed.body", { date: job.clips_freed_at ? new Date(job.clips_freed_at).toLocaleDateString(i18n.language, { day: "numeric", month: "long" }) : "" })}{" "}
          {gone ? t("freed.goneHint") : t("freed.restoreHint")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {exports !== undefined && exports > 0 && (
          <Link to={`/${job.job_id}/export`} className="btn btn-glass btn-sm">
            {t("freed.exports", { count: exports })} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        )}
        {!gone && (
          <button onClick={restore} disabled={restoring} className="btn btn-primary btn-sm">
            {restoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
            {restoring ? t("freed.restoring") : t("freed.restore")}
          </button>
        )}
      </div>
    </section>
  );
}
