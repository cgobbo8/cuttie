import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Archive, ArrowRight, Clapperboard, Download, Film, HardDrive, Loader2, RotateCcw, Search, Sparkles, Trash2 } from "lucide-react";
import {
  clipThumbUrl,
  deleteJob,
  freeProject,
  listGamesAndStreamers,
  listJobs,
  retryJob,
  type GameSummary,
  type JobSummary,
  type PaginationMeta,
} from "../lib/api";
import { useChannel } from "../lib/ChannelContext";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { analysisProgress, dayDate, fileSize, hoursMinutes, splitVodTitle } from "../lib/format";
import { projectPath, projectStage, type ProjectStage } from "../lib/projects";
import ConfirmModal from "../components/ConfirmModal";
import ProjectRemoveModal from "../components/ProjectRemoveModal";
import { useToast } from "../components/Toast";

type StatusFilter = "" | "in_progress" | "done" | "error";

const PER_PAGE = 24;

function ProjectCard({
  job,
  cover,
  onRetry,
  onDelete,
}: {
  job: JobSummary;
  cover: string | null;
  onRetry: (job: JobSummary) => void;
  onDelete: (job: JobSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const stage: ProjectStage = projectStage(job);
  const { tag, title } = splitVodTitle(job.custom_title || job.vod_title);
  const date = job.stream_date ?? job.created_at;
  const progress = stage === "analyzing" ? analysisProgress(job.status, job.progress, job.eta) : null;

  const stop = (e: MouseEvent, action: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    action();
  };

  return (
    <Link
      to={projectPath(job.job_id, stage)}
      className="group glass rounded-[18px] overflow-hidden flex flex-col transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]"
    >
      <div className="relative aspect-video overflow-hidden bg-white/[0.04]">
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${
              stage === "error" ? "grayscale-[0.6] brightness-[0.6]" : stage === "freed" ? "grayscale-[0.5] brightness-[0.75]" : ""
            }`}
          />
        ) : (
          <div className="w-full h-full skeleton" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(11,11,12,0.6)_0%,rgba(11,11,12,0)_45%)]" />

        <span className="absolute top-2.5 left-2.5 chip glass-chip text-white h-[26px] px-2.5 text-[12px]">
          {stage === "analyzing" ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" /> {t("projects.analyzing", { percent: progress?.percent ?? 0 })}
            </>
          ) : stage === "error" ? (
            <span className="text-[#ff8a7a]">{t("status.error")}</span>
          ) : stage === "freed" ? (
            <>
              <Archive className="w-3 h-3" /> {t("projects.stage.freed")}
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-accent" /> {t(`projects.stage.${stage}`)}
            </>
          )}
        </span>
        {job.vod_duration_seconds ? (
          <span className="absolute bottom-2.5 right-2.5 mono chip glass-chip text-white h-[24px] px-2 text-[11.5px]">
            {hoursMinutes(job.vod_duration_seconds)}
          </span>
        ) : null}
        <button
          onClick={(e) => stop(e, () => onDelete(job))}
          aria-label={t("home.deleteProject")}
          title={t("home.deleteProject")}
          className="absolute top-2 right-2 btn btn-icon btn-sm glass-chip text-white/80 hover:text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {progress && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-3 p-4">
        <div className="min-w-0">
          <h2 className="text-[16px] leading-snug font-semibold tracking-[-0.01em] text-white line-clamp-2">{title || t("home.untitledVod")}</h2>
          <p className="mt-1 text-[12.5px] text-ink-3 truncate">{[dayDate(date, i18n.language), job.vod_game, tag].filter(Boolean).join(" · ")}</p>
        </div>

        {job.status === "DONE" && (
          <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-ink-3" /> {t("projects.moments", { count: job.clip_count })}
            </span>
            {job.kept_count > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5 text-ink-3" /> {t("projects.kept", { count: job.kept_count })}
              </span>
            )}
            {job.export_count > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5 text-ink-3" /> {t("projects.exported", { count: job.export_count })}
              </span>
            )}
            {/* What its clips take on this computer */}
            {job.clips_bytes > 0 && (
              <span className="inline-flex items-center gap-1.5 text-ink-3" title={t("projects.size")}>
                <HardDrive className="w-3.5 h-3.5" /> {fileSize(job.clips_bytes, i18n.language)}
              </span>
            )}
          </div>
        )}
        {stage === "error" && job.error && <p className="text-[12.5px] leading-snug text-ink-3 line-clamp-2">{job.error}</p>}

        <div className="mt-auto pt-1 flex items-center justify-between gap-3">
          {stage === "error" ? (
            <button onClick={(e) => stop(e, () => onRetry(job))} className="btn btn-glass btn-sm">
              <RotateCcw className="w-3.5 h-3.5" /> {t("projects.next.error")}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-[550] text-white">
              {t(`projects.next.${stage}`)}
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Every live analyzed so far, each opening at the step it is at */
export default function ProjectsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { channel } = useChannel();
  const { creator } = useCreatorWorkspace();

  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>({
    total: 0,
    per_page: PER_PAGE,
    current_page: 1,
    last_page: 1,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [gameFilter, setGameFilter] = useState("");
  const [games, setGames] = useState<GameSummary[]>([]);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<JobSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    listGamesAndStreamers(creator?.id)
      .then(({ games }) => setGames(games))
      .catch(() => {});
  }, [creator?.id]);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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
        per_page: PER_PAGE,
        search: debouncedSearch || undefined,
        status: statusFilter || undefined,
        game: gameFilter || undefined,
        creator_id: creator?.id,
      });
      setJobs(result.data);
      setMeta(result.meta);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, gameFilter, creator?.id]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  // Analyses running: follow their progress
  const running = jobs.some((j) => j.status !== "DONE" && j.status !== "ERROR");
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [running, fetchJobs]);

  // The live's own thumbnail while there is no clip yet
  const vodThumbs = useMemo(() => new Map((channel?.vods ?? []).map((v) => [v.id, v.thumbnail_url])), [channel]);
  const coverOf = (job: JobSummary) =>
    job.cover_clip ? clipThumbUrl(job.job_id, job.cover_clip, { width: 480 }) : (job.vod_id && vodThumbs.get(job.vod_id)) || job.streamer_thumbnail;

  const retry = async (job: JobSummary) => {
    try {
      await retryJob(job.job_id);
      navigate(`/${job.job_id}`);
    } catch {
      toast.error(t("projects.retryError"));
    }
  };

  const confirmDelete = async () => {
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
  };

  // Only the clips: the project and its exports stay
  const confirmFree = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { freed } = await freeProject(deleteTarget.job_id);
      setDeleteTarget(null);
      toast.success(t("projects.remove.freed", { size: fileSize(freed, i18n.language) }));
      fetchJobs();
    } catch {
      toast.error(t("projects.remove.freeError"));
    } finally {
      setDeleting(false);
    }
  };
  // A project still being analyzed, or with nothing to free, can only be deleted
  const canFree = !!deleteTarget && deleteTarget.clips_bytes > 0 && (deleteTarget.status === "DONE" || deleteTarget.status === "ERROR");

  const filtered = !!(debouncedSearch || statusFilter || gameFilter);
  const filters: { key: StatusFilter; label: string }[] = [
    { key: "", label: t("home.all") },
    { key: "in_progress", label: t("home.inProgress") },
    { key: "done", label: t("home.completed") },
    { key: "error", label: t("home.errors") },
  ];

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="title-large">{t("projects.title")}</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-2">{t("projects.count", { count: meta.total })}</p>
        </div>
        {(meta.total > 0 || filtered) && (
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="glass flex items-center gap-2 h-10 w-[300px] max-w-full px-3 rounded-[12px] focus-within:border-white/25">
              <Search className="w-4 h-4 text-ink-3 flex-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("projects.search")}
                aria-label={t("projects.search")}
                className="flex-1 min-w-0 bg-transparent outline-none focus-visible:outline-none text-[13.5px] text-white placeholder:text-ink-4"
              />
            </label>
            {games.length > 1 && (
              <select
                value={gameFilter}
                onChange={(e) => {
                  setGameFilter(e.target.value);
                  setPage(1);
                }}
                aria-label={t("home.allGames")}
                className="glass h-10 px-3 rounded-[12px] text-[13.5px] text-white bg-transparent outline-none"
              >
                <option value="">{t("home.allGames")}</option>
                {games.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <div role="group" aria-label={t("projects.filter")} className="seg">
              {filters.map((f) => (
                <button
                  key={f.key}
                  aria-pressed={statusFilter === f.key}
                  onClick={() => {
                    setStatusFilter(f.key);
                    setPage(1);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {loading && jobs.length === 0 ? (
        <div className="mt-7 grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="glass rounded-[18px] overflow-hidden">
              <div className="aspect-video skeleton" />
              <div className="p-4 space-y-2.5">
                <div className="h-4 w-3/4 rounded skeleton" />
                <div className="h-3 w-1/2 rounded skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="mt-10 glass rounded-[20px] p-8 max-w-[560px] flex flex-col items-start">
          <span className="w-11 h-11 rounded-[13px] bg-white/[0.07] grid place-items-center">
            <Clapperboard className="w-5 h-5 text-ink-2" />
          </span>
          <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-white">
            {filtered ? t("common.noResults") : t("projects.emptyTitle")}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{filtered ? t("projects.emptyFiltered") : t("projects.emptyHint")}</p>
          {!filtered && (
            <Link to="/" className="btn btn-primary mt-5">
              {t("projects.emptyCta")} <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-7 grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(320px,1fr))]">
          {jobs.map((job, i) => (
            // The entry animation sits on a wrapper: it would freeze the card's hover lift
            <div key={job.job_id} className="animate-rise grid min-w-0" style={{ ["--i" as string]: i }}>
              <ProjectCard job={job} cover={coverOf(job)} onRetry={retry} onDelete={setDeleteTarget} />
            </div>
          ))}
        </div>
      )}

      {meta.last_page > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label={t("projects.pages")}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-glass btn-sm">
            {t("home.previous")}
          </button>
          <span className="mono text-[12.5px] text-ink-3">
            {t("home.page", {
              current: meta.current_page,
              total: meta.last_page,
            })}
          </span>
          <button onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))} disabled={page >= meta.last_page} className="btn btn-glass btn-sm">
            {t("home.next")}
          </button>
        </nav>
      )}

      <ProjectRemoveModal
        open={canFree}
        clipsBytes={deleteTarget?.clips_bytes ?? 0}
        onFree={confirmFree}
        onDelete={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
      <ConfirmModal
        open={!!deleteTarget && !canFree}
        title={t("home.deleteProject")}
        message={t("home.deleteProjectMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
