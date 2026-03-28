import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { listJobs, listGamesAndStreamers, deleteJob, retryJob, type JobSummary, type PaginationMeta, type GameSummary, type StreamerSummary } from "../lib/api";
import { useTranslation } from "react-i18next";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";
import {
  Search,
  ArrowUpDown,
  RotateCcw,
  Loader2,
  FolderOpen,
  Trash2,
  Gamepad2,
  Users,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";

type SortKey = "date" | "title" | "status";
type SortDir = "asc" | "desc";
type StatusFilter = "" | "done" | "in_progress" | "error";

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

function formatNumber(n: number | null): string {
  if (n == null) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({ total: 0, per_page: 20, current_page: 1, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [gameFilter, setGameFilter] = useState(searchParams.get("game") || "");
  const [streamerFilter, setStreamerFilter] = useState(searchParams.get("streamer") || "");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  // Filter options from games API
  const [gameOptions, setGameOptions] = useState<GameSummary[]>([]);
  const [streamerOptions, setStreamerOptions] = useState<StreamerSummary[]>([]);

  useEffect(() => {
    listGamesAndStreamers()
      .then(({ games, streamers }) => {
        setGameOptions(games);
        setStreamerOptions(streamers);
      })
      .catch(() => {});
  }, []);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (gameFilter) params.set("game", gameFilter);
    if (streamerFilter) params.set("streamer", streamerFilter);
    setSearchParams(params, { replace: true });
  }, [gameFilter, streamerFilter, setSearchParams]);

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<JobSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [search]);

  const fetchJobs = useCallback(async () => {
    try {
      const result = await listJobs({
        page,
        per_page: 20,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        game: gameFilter || undefined,
        streamer: streamerFilter || undefined,
      });
      setJobs(result.data);
      setMeta(result.meta);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, gameFilter, streamerFilter]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // Poll for in-progress jobs
  const hasInProgress = jobs.some((j) => j.status !== "DONE" && j.status !== "ERROR");
  useEffect(() => {
    if (!hasInProgress) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [hasInProgress, fetchJobs]);

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

  // Client-side sort (server returns by date desc, we re-sort locally for title/status)
  const sorted = [...jobs].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "date":
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "title":
        return dir * (a.vod_title || "").localeCompare(b.vod_title || "");
      case "status":
        return dir * a.status.localeCompare(b.status);
      default:
        return 0;
    }
  });

  const handleRetry = useCallback(
    async (e: React.MouseEvent, jobId: string) => {
      e.stopPropagation();
      try {
        await retryJob(jobId);
        navigate(`/${jobId}`);
      } catch {}
    },
    [navigate],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent, job: JobSummary) => {
      e.stopPropagation();
      setDeleteTarget(job);
    },
    [],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteJob(deleteTarget.job_id);
      setDeleteTarget(null);
      toast.success(t("home.deleteSuccess"));
      fetchJobs();
    } catch {
      toast.error(t("home.deleteError"));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, fetchJobs, toast, t]);

  const handleStatusFilter = useCallback((f: StatusFilter) => {
    setStatusFilter(f);
    setPage(1);
  }, []);

  const SortButton = ({ label, sortKeyVal }: { label: string; sortKeyVal: SortKey }) => (
    <button
      onClick={() => toggleSort(sortKeyVal)}
      className={`flex items-center gap-1 text-xs font-medium transition-colors ${
        sortKey === sortKeyVal ? "text-white" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  const filterBtn = (key: StatusFilter, label: string) => (
    <button
      key={key}
      onClick={() => handleStatusFilter(key)}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
        statusFilter === key
          ? "bg-white/[0.08] text-white"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
      }`}
    >
      {label}
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
            {t("home.analysisCount", { count: meta.total })}
          </p>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("home.search")}
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.16] transition-colors"
          />
        </div>
        <div className="flex items-center gap-1">
          {filterBtn("", t("home.all"))}
          {filterBtn("done", t("home.completed"))}
          {filterBtn("in_progress", t("home.inProgress"))}
          {filterBtn("error", t("home.errors"))}
        </div>
      </div>

      {/* Game & streamer filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative">
          <select
            value={gameFilter}
            onChange={(e) => { setGameFilter(e.target.value); setPage(1); }}
            className="appearance-none text-xs pl-3 pr-8 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-zinc-300 focus:outline-none focus:border-white/[0.16] transition-colors cursor-pointer"
          >
            <option value="">{t("home.allGames")}</option>
            {gameOptions.map((g) => (
              <option key={g.game_id || g.name} value={g.name}>{g.name}</option>
            ))}
          </select>
          <Gamepad2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={streamerFilter}
            onChange={(e) => { setStreamerFilter(e.target.value); setPage(1); }}
            className="appearance-none text-xs pl-3 pr-8 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.08] text-zinc-300 focus:outline-none focus:border-white/[0.16] transition-colors cursor-pointer"
          >
            <option value="">{t("home.allStreamers")}</option>
            {streamerOptions.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <Users className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
        </div>
        {(gameFilter || streamerFilter) && (
          <button
            onClick={() => { setGameFilter(""); setStreamerFilter(""); setPage(1); }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-white px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            <X className="w-3 h-3" />
            {t("home.clearFilters")}
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {debouncedSearch || statusFilter || gameFilter || streamerFilter ? t("common.noResults") : t("home.noProjects")}
          </p>
          {!debouncedSearch && !statusFilter && !gameFilter && !streamerFilter && (
            <p className="text-xs text-zinc-600 mt-1">
              {t("home.noProjectsHint")}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="surface-static rounded-xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_120px_80px_80px_80px_130px_40px] gap-4 px-5 py-3 border-b border-white/[0.06] bg-white/[0.02]">
              <SortButton label={t("home.colTitle")} sortKeyVal="title" />
              <SortButton label={t("home.colStatus")} sortKeyVal="status" />
              <span className="text-xs font-medium text-zinc-500">{t("home.colDuration")}</span>
              <span className="text-xs font-medium text-zinc-500 flex items-center gap-1">
                <Users className="w-3 h-3" />
                {t("home.colViewers")}
              </span>
              <span className="text-xs font-medium text-zinc-500 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {t("home.colChat")}
              </span>
              <SortButton label={t("home.colDate")} sortKeyVal="date" />
              <span />
            </div>

            {/* Rows */}
            {sorted.map((job) => (
              <div
                key={job.job_id}
                onClick={() => navigate(`/${job.job_id}`)}
                className="grid grid-cols-[1fr_120px_80px_80px_80px_130px_40px] gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.03] transition-colors cursor-pointer group"
              >
                {/* Title + game + streamer */}
                <div className="min-w-0 flex items-center gap-3">
                  {job.streamer_thumbnail ? (
                    <img
                      src={job.streamer_thumbnail}
                      alt={job.streamer || ""}
                      className="w-8 h-8 rounded-full shrink-0 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full shrink-0 bg-white/[0.06] flex items-center justify-center">
                      <Users className="w-3.5 h-3.5 text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0">
                  <p className="text-sm text-zinc-300 truncate group-hover:text-white transition-colors">
                    {job.vod_title || t("home.untitledVod")}
                  </p>
                  <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
                    {job.streamer && (
                      <span className="truncate max-w-[140px]">{job.streamer}</span>
                    )}
                    {job.vod_game && (
                      <span className="flex items-center gap-1 shrink-0">
                        <Gamepad2 className="w-3 h-3" />
                        <span className="truncate max-w-[160px]">{job.vod_game}</span>
                      </span>
                    )}
                  </div>
                  </div>
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

                {/* Viewers */}
                <div className="flex items-center">
                  <span className="text-xs text-zinc-500 font-mono">
                    {formatNumber(job.view_count)}
                  </span>
                </div>

                {/* Chat messages */}
                <div className="flex items-center">
                  <span className="text-xs text-zinc-500 font-mono">
                    {formatNumber(job.chat_message_count)}
                  </span>
                </div>

                {/* Date */}
                <div className="flex items-center">
                  <span className="text-xs text-zinc-500">
                    {formatDate(job.created_at, i18n.language)}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end">
                  {job.status === "ERROR" && (
                    <button
                      onClick={(e) => handleRetry(e, job.job_id)}
                      className="p-1.5 text-zinc-500 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors opacity-0 group-hover:opacity-100"
                      title={t("home.retry")}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={(e) => handleDelete(e, job)}
                    className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                    title={t("home.deleteProject")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {meta.last_page > 1 && (
            <div className="flex items-center justify-between mt-4 px-1">
              <span className="text-xs text-zinc-500">
                {t("home.page", { current: meta.current_page, total: meta.last_page })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  {t("home.previous")}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                  disabled={page >= meta.last_page}
                  className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  {t("home.next")}
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t("home.deleteProject")}
        message={t("home.deleteProjectMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
