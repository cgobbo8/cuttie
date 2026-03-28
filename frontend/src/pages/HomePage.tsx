import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { listJobs, retryJob, type JobSummary } from "../lib/api";
import { useTranslation } from "react-i18next";
import {
  Search,
  ArrowUpDown,
  RotateCcw,
  Loader2,
  FolderOpen,
} from "lucide-react";

type SortKey = "date" | "title" | "status";
type SortDir = "asc" | "desc";

function formatDate(iso: string, lng: string): string {
  const locale = lng === "es" ? "es-ES" : lng === "en" ? "en-US" : "fr-FR";
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === "DONE") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        {t("status.done")}
      </span>
    );
  }
  if (status === "ERROR") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-red-500/10 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        {t("status.error")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-white/[0.06] text-zinc-300">
      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
      {t("status.inProgress")}
    </span>
  );
}

export default function HomePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("desc");
      }
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    let list = jobs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (j) =>
          (j.vod_title || "").toLowerCase().includes(q) ||
          j.status.toLowerCase().includes(q),
      );
    }

    list = [...list].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "date":
          return (
            dir *
            (new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime())
          );
        case "title":
          return (
            dir *
            (a.vod_title || "").localeCompare(b.vod_title || "")
          );
        case "status":
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });

    return list;
  }, [jobs, search, sortKey, sortDir]);

  const handleRetry = useCallback(
    async (e: React.MouseEvent, jobId: string) => {
      e.stopPropagation();
      try {
        await retryJob(jobId);
        navigate(`/${jobId}`);
      } catch {
        /* ignore */
      }
    },
    [navigate],
  );

  const SortButton = ({
    label,
    sortKeyVal,
  }: {
    label: string;
    sortKeyVal: SortKey;
  }) => (
    <button
      onClick={() => toggleSort(sortKeyVal)}
      className={`flex items-center gap-1 text-xs font-medium transition-colors ${
        sortKey === sortKeyVal
          ? "text-white"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            {t("home.title")}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {t("home.analysisCount", { count: jobs.length })}
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("home.search")}
          className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.16] transition-colors"
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {search ? t("common.noResults") : t("home.noProjects")}
          </p>
          <p className="text-xs text-zinc-600 mt-1">
            {t("home.noProjectsHint")}
          </p>
        </div>
      ) : (
        <div className="surface-static rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_120px_100px_140px] gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
            <SortButton label={t("home.colTitle")} sortKeyVal="title" />
            <SortButton label={t("home.colStatus")} sortKeyVal="status" />
            <span className="text-xs font-medium text-zinc-500">{t("home.colDuration")}</span>
            <SortButton label={t("home.colDate")} sortKeyVal="date" />
          </div>

          {/* Rows */}
          {filtered.map((job) => (
            <div
              key={job.job_id}
              onClick={() => navigate(`/${job.job_id}`)}
              className="grid grid-cols-[1fr_120px_100px_140px] gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.03] transition-colors cursor-pointer group"
            >
              {/* Title */}
              <div className="min-w-0">
                <p className="text-sm text-zinc-300 truncate group-hover:text-white transition-colors">
                  {job.vod_title || t("home.untitledVod")}
                </p>
              </div>

              {/* Status */}
              <div className="flex items-center">
                <StatusBadge status={job.status} />
              </div>

              {/* Duration */}
              <div className="flex items-center">
                <span className="text-xs text-zinc-500 font-mono">
                  {formatDuration(job.vod_duration_seconds)}
                </span>
              </div>

              {/* Date + actions */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">
                  {formatDate(job.created_at, i18n.language)}
                </span>
                {job.status === "ERROR" && (
                  <button
                    onClick={(e) => handleRetry(e, job.job_id)}
                    className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                    title={t("home.retry")}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
