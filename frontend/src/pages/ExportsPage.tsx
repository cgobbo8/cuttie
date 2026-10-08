import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, Clapperboard, Search } from "lucide-react";
import { deleteRender, listRenders, type RenderStatus } from "../lib/api";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import { splitVodTitle } from "../lib/format";
import { activeRenderId, groupByProject, libraryRenders } from "../lib/renders";
import RenderCard from "../components/project/RenderCard";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

type Filter = "all" | "done" | "running" | "error";

const RUNNING = new Set<RenderStatus["status"]>(["pending", "rendering"]);

/** Every exported clip, grouped by live, ready to download and post */
export default function ExportsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { creator } = useCreatorWorkspace();
  const [renders, setRenders] = useState<RenderStatus[] | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [deleteTarget, setDeleteTarget] = useState<RenderStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    listRenders(creator?.id)
      .then(setRenders)
      .catch(() => setRenders([]));
  }, [creator?.id]);
  useEffect(load, [load]);

  const shown = useMemo(() => libraryRenders(renders ?? []), [renders]);
  const busy = shown.some((r) => RUNNING.has(r.status));
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [busy, load]);

  const activeId = useMemo(() => activeRenderId(shown), [shown]);
  const counts = useMemo(
    () => ({
      all: shown.length,
      done: shown.filter((r) => r.status === "done").length,
      running: shown.filter((r) => RUNNING.has(r.status)).length,
      error: shown.filter((r) => r.status === "error").length,
    }),
    [shown],
  );

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matching = shown.filter(
      (r) =>
        (filter === "all" || (filter === "done" ? r.status === "done" : filter === "error" ? r.status === "error" : RUNNING.has(r.status))) &&
        (!q || [r.clip_name, r.vod_title, r.vod_game].some((s) => s?.toLowerCase().includes(q))),
    );
    return groupByProject(matching);
  }, [shown, filter, search]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRender(deleteTarget.render_id);
      setDeleteTarget(null);
      toast.success(t("exports.deleteSuccess"));
      load();
    } catch {
      toast.error(t("exports.deleteError"));
    } finally {
      setDeleting(false);
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t("exports.all") },
    { key: "done", label: t("exports.ready") },
    { key: "running", label: t("exports.running") },
    { key: "error", label: t("exports.failed") },
  ];

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="title-large">{t("exports.title")}</h1>
          <p className="mt-1.5 text-[13.5px] text-ink-2">{t("exports.count", { count: counts.done })}</p>
        </div>
        {shown.length > 0 && (
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="glass flex items-center gap-2 h-10 w-[280px] max-w-full px-3 rounded-[12px] focus-within:border-white/25">
              <Search className="w-4 h-4 text-ink-3 flex-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("exports.search")}
                aria-label={t("exports.search")}
                className="flex-1 min-w-0 bg-transparent outline-none focus-visible:outline-none text-[13.5px] text-white placeholder:text-ink-4"
              />
            </label>
            <div role="group" aria-label={t("exports.filter")} className="seg">
              {filters.map((f) => (
                <button key={f.key} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label}
                  {counts[f.key] > 0 && <span className="mono ml-1.5 text-[11px] opacity-60">{counts[f.key]}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {renders === null ? (
        <div className="mt-8 grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="aspect-[9/16] rounded-[16px] skeleton" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-10 glass rounded-[20px] p-8 max-w-[560px] flex flex-col items-start">
          <span className="w-11 h-11 rounded-[13px] bg-white/[0.07] grid place-items-center">
            <Clapperboard className="w-5 h-5 text-ink-2" />
          </span>
          <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-white">
            {shown.length ? t("common.noResults") : t("exports.emptyTitle")}
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{shown.length ? t("exports.emptyFiltered") : t("exports.emptyHint")}</p>
          {!shown.length && (
            <Link to="/projects" className="btn btn-primary mt-5">
              {t("exports.emptyCta")} <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-7 flex flex-col gap-9">
          {groups.map((group) => {
            const { tag, title } = splitVodTitle(group.vodTitle);
            return (
              <section key={group.jobId} aria-label={title || undefined} className="animate-rise">
                <div className="flex flex-wrap items-end justify-between gap-3 pb-3.5 border-b border-white/[0.07]">
                  <div className="min-w-0">
                    <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-white truncate">{title || t("home.untitledVod")}</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-3">
                      {[group.vodGame, tag, t("exports.clips", { count: group.renders.length })].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Link to={`/${group.jobId}/export`} className="btn btn-ghost btn-sm -mr-2">
                    {t("exports.openProject")} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
                <div className="mt-4 grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                  {group.renders.map((r) => (
                    <RenderCard
                      key={r.render_id}
                      jobId={r.job_id}
                      render={r}
                      queued={r.status === "rendering" && r.render_id !== activeId}
                      onDelete={setDeleteTarget}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title={t("exports.delete")}
        message={t("exports.deleteMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
