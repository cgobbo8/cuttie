import { useEffect, useState, useCallback } from "react";
import {
  Loader2,
  Cpu,
  Film,
  Trash2,
  XCircle,
  RefreshCw,
  Clock,
  ListOrdered,
} from "lucide-react";
import {
  getWorkersStatus,
  flushWorkers,
  cancelWorkerJob,
  cancelWorkerRender,
  type WorkersStatus,
  type ActiveJob,
  type ActiveRender,
} from "../lib/api";
import { useTranslation } from "react-i18next";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-zinc-500/10 text-zinc-400",
  DOWNLOADING_AUDIO: "bg-blue-500/10 text-blue-400",
  DOWNLOADING_CHAT: "bg-blue-500/10 text-blue-400",
  ANALYZING_AUDIO: "bg-violet-500/10 text-violet-400",
  ANALYZING_CHAT: "bg-violet-500/10 text-violet-400",
  SCORING: "bg-amber-500/10 text-amber-400",
  ANALYZING_CLIPS: "bg-cyan-500/10 text-cyan-400",
  CLIPPING: "bg-emerald-500/10 text-emerald-400",
  LLM_ANALYSIS: "bg-cyan-500/10 text-cyan-400",
};

function elapsed(isoDate: string | null): string {
  if (!isoDate) return "";
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h${(mins % 60).toString().padStart(2, "0")}`;
}

export default function WorkersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [data, setData] = useState<WorkersStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmFlush, setConfirmFlush] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const status = await getWorkersStatus();
      setData(status);
    } catch {
      // silent — page will show stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleFlush = async () => {
    setConfirmFlush(false);
    try {
      const result = await flushWorkers();
      toast.success(
        t("workers.flushed", {
          queue: result.flushed_queue,
          jobs: result.cancelled_jobs,
        })
      );
      refresh();
    } catch {
      toast.error(t("workers.flushError"));
    }
  };

  const handleCancel = async (jobId: string) => {
    setCancellingId(jobId);
    try {
      await cancelWorkerJob(jobId);
      toast.success(t("workers.cancelled"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("workers.cancelError"));
    } finally {
      setCancellingId(null);
    }
  };

  const handleCancelRender = async (renderId: string) => {
    setCancellingId(renderId);
    try {
      await cancelWorkerRender(renderId);
      toast.success(t("workers.cancelled"));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("workers.cancelError"));
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  const activeJobs = data?.active_jobs ?? [];
  const activeRenders = data?.active_renders ?? [];
  const queue = data?.queue ?? { length: 0, items: [] };
  const hasAnything = activeJobs.length > 0 || activeRenders.length > 0 || queue.length > 0;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Cpu className="w-6 h-6 text-zinc-400" />
          <h1 className="text-xl font-semibold text-zinc-100">
            {t("workers.title")}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-white/[0.08] rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {hasAnything && (
            <button
              onClick={() => setConfirmFlush(true)}
              className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("workers.flushAll")}
            </button>
          )}
        </div>
      </div>

      {/* Queue */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <ListOrdered className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-400">
            {t("workers.queue")}
          </h2>
          <span className="text-xs text-zinc-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
            {queue.length}
          </span>
        </div>

        {queue.length === 0 ? (
          <div className="text-sm text-zinc-600 py-4 text-center border border-white/[0.04] rounded-xl bg-white/[0.01]">
            {t("workers.queueEmpty")}
          </div>
        ) : (
          <div className="border border-white/[0.06] rounded-xl bg-white/[0.01] overflow-hidden">
            {queue.items.map((item, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-b-0"
              >
                <div className="w-6 h-6 rounded-md bg-zinc-500/10 flex items-center justify-center text-zinc-500 text-xs font-mono">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-300 truncate font-mono">
                    {item.job_id || item.raw || "—"}
                  </div>
                  {item.url && (
                    <div className="text-[11px] text-zinc-600 truncate">
                      {item.url}
                    </div>
                  )}
                </div>
                {item.type && (
                  <span className="text-[10px] text-zinc-500 bg-white/[0.04] px-2 py-0.5 rounded">
                    {item.type}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Active jobs */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Loader2 className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-400">
            {t("workers.activeJobs")}
          </h2>
          <span className="text-xs text-zinc-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
            {activeJobs.length}
          </span>
        </div>

        {activeJobs.length === 0 ? (
          <div className="text-sm text-zinc-600 py-4 text-center border border-white/[0.04] rounded-xl bg-white/[0.01]">
            {t("workers.noActiveJobs")}
          </div>
        ) : (
          <div className="space-y-3">
            {activeJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onCancel={handleCancel}
                cancelling={cancellingId === job.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* Active renders */}
      <section className="mt-8">
        <div className="flex items-center gap-2 mb-3">
          <Film className="w-4 h-4 text-zinc-500" />
          <h2 className="text-sm font-medium text-zinc-400">
            {t("workers.activeRenders")}
          </h2>
          <span className="text-xs text-zinc-600 bg-white/[0.04] px-2 py-0.5 rounded-full">
            {activeRenders.length}
          </span>
        </div>

        {activeRenders.length === 0 ? (
          <div className="text-sm text-zinc-600 py-4 text-center border border-white/[0.04] rounded-xl bg-white/[0.01]">
            {t("workers.noActiveRenders")}
          </div>
        ) : (
          <div className="border border-white/[0.06] rounded-xl bg-white/[0.01] overflow-hidden">
            {activeRenders.map((render) => (
              <div
                key={render.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-b-0"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    render.status === "rendering"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-zinc-500/10 text-zinc-400"
                  }`}
                >
                  {render.status === "rendering" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Film className="w-4 h-4" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate">
                    {render.clip_name || render.clip_filename}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                        render.status === "rendering"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-zinc-500/10 text-zinc-400"
                      }`}
                    >
                      {render.status}
                    </span>
                    {render.progress > 0 && (
                      <span className="text-xs text-zinc-500">
                        {render.progress}%
                      </span>
                    )}
                    {render.batch_group_id && (
                      <span className="text-[10px] text-zinc-600">batch</span>
                    )}
                  </div>
                </div>

                {render.created_at && (
                  <div className="flex items-center gap-1 text-xs text-zinc-600 shrink-0">
                    <Clock className="w-3 h-3" />
                    {elapsed(render.created_at)}
                  </div>
                )}

                <button
                  onClick={() => handleCancelRender(render.id)}
                  disabled={cancellingId === render.id}
                  className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 shrink-0"
                  title={t("workers.cancel")}
                >
                  {cancellingId === render.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <ConfirmModal
        open={confirmFlush}
        title={t("workers.flushConfirmTitle")}
        message={t("workers.flushConfirmMessage")}
        confirmLabel={t("workers.flushConfirmButton")}
        onConfirm={handleFlush}
        onCancel={() => setConfirmFlush(false)}
        variant="danger"
      />
    </div>
  );
}

function JobCard({
  job,
  onCancel,
  cancelling,
}: {
  job: ActiveJob;
  onCancel: (id: string) => void;
  cancelling: boolean;
}) {
  const { t } = useTranslation();
  const colorClass = STATUS_COLORS[job.status] || "bg-zinc-500/10 text-zinc-400";

  return (
    <div className="border border-white/[0.06] rounded-xl bg-white/[0.01] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Streamer + game */}
          <div className="flex items-center gap-2 mb-1">
            {job.streamer && (
              <span className="text-sm font-medium text-zinc-200">
                {job.streamer}
              </span>
            )}
            {job.vod_game && (
              <span className="text-xs text-zinc-500">{job.vod_game}</span>
            )}
          </div>

          {/* Title */}
          {job.vod_title && (
            <div className="text-xs text-zinc-500 truncate mb-2">
              {job.vod_title}
            </div>
          )}

          {/* Status + progress */}
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${colorClass}`}
            >
              {job.status}
            </span>
            {job.progress && (
              <span className="text-xs text-zinc-500">{job.progress}</span>
            )}
          </div>
        </div>

        {/* Right: elapsed + cancel */}
        <div className="flex items-center gap-2 shrink-0">
          {job.created_at && (
            <div className="flex items-center gap-1 text-xs text-zinc-600">
              <Clock className="w-3 h-3" />
              {elapsed(job.created_at)}
            </div>
          )}
          <button
            onClick={() => onCancel(job.id)}
            disabled={cancelling}
            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
            title={t("workers.cancel")}
          >
            {cancelling ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Job ID */}
      <div className="mt-2 text-[10px] text-zinc-700 font-mono">{job.id}</div>
    </div>
  );
}
