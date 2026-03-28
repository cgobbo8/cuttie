import { useEffect, useState, useMemo, useCallback } from "react";
import { Link } from "react-router";
import { Loader2, Download, AlertCircle, Film, Search, Gamepad2, Trash2 } from "lucide-react";
import { listRenders, deleteRender, clipUrl, type RenderStatus } from "../lib/api";
import { useTranslation } from "react-i18next";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

function fmtDate(iso: string, lng: string): string {
  const locale = lng === "es" ? "es-ES" : lng === "en" ? "en-US" : "fr-FR";
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type StatusFilter = "all" | "done" | "rendering" | "error";

function RenderRow({ render, lng, onDelete }: { render: RenderStatus; lng: string; onDelete: (render: RenderStatus) => void }) {
  const { t } = useTranslation();
  const isRendering = render.status === "rendering";
  const isDone = render.status === "done";
  const isError = render.status === "error";

  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.02] transition-colors group">
      {/* Icon */}
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
          isDone
            ? "bg-emerald-500/10 text-emerald-400"
            : isError
              ? "bg-red-500/10 text-red-400"
              : "bg-white/[0.06] text-zinc-400"
        }`}
      >
        {isRendering ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4" />
        ) : (
          <Film className="w-4 h-4" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">
          {render.clip_name || render.clip_filename}
        </div>
        <div className="text-[11px] text-zinc-500 flex items-center gap-2 mt-0.5">
          {render.vod_title && (
            <Link
              to={`/${render.job_id}`}
              className="truncate max-w-[200px] hover:text-zinc-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {render.vod_title}
            </Link>
          )}
          {render.vod_game && (
            <span className="flex items-center gap-1 shrink-0">
              <Gamepad2 className="w-3 h-3" />
              {render.vod_game}
            </span>
          )}
          <span className="shrink-0">{fmtDate(render.created_at, lng)}</span>
        </div>
      </div>

      {/* Status / progress */}
      <div className="shrink-0 flex items-center gap-3">
        {isRendering && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-white/50 rounded-full transition-all duration-500"
                style={{ width: `${render.progress}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-400 font-mono w-8 text-right tabular-nums">
              {render.progress}%
            </span>
          </div>
        )}

        {isError && (
          <span className="text-[11px] text-red-400 font-medium">{t("exports.error")}</span>
        )}

        {isDone && render.url && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
              {render.size_mb} MB
            </span>
            <button
              onClick={async () => {
                const res = await fetch(clipUrl(render.job_id, render.output_filename!));
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = render.clip_name ? `${render.clip_name}.mp4` : render.output_filename!;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 hover:text-white transition-colors font-medium border border-white/[0.08]"
            >
              <Download className="w-3.5 h-3.5" />
              {t("exports.download")}
            </button>
          </div>
        )}

        {/* Delete button */}
        <button
          onClick={() => onDelete(render)}
          className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
          title={t("exports.deleteExport")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export default function ExportsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [renders, setRenders] = useState<RenderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<RenderStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteRequest = useCallback((render: RenderStatus) => {
    setDeleteTarget(render);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRender(deleteTarget.render_id);
      setRenders((prev) => prev.filter((r) => r.render_id !== deleteTarget.render_id));
      setDeleteTarget(null);
      toast.success(t("exports.deleteSuccess"));
    } catch {
      toast.error(t("exports.deleteError"));
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast, t]);

  const hasRendering = renders.some((r) => r.status === "rendering");

  useEffect(() => {
    let active = true;
    const load = () => {
      listRenders()
        .then((data) => { if (active) setRenders(data); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    };

    load();
    const interval = setInterval(load, hasRendering || loading ? 2000 : 10000);
    return () => { active = false; clearInterval(interval); };
  }, [hasRendering, loading]);

  const filtered = useMemo(() => {
    let list = renders;

    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          (r.clip_name || r.clip_filename).toLowerCase().includes(q) ||
          (r.vod_title || "").toLowerCase().includes(q) ||
          (r.vod_game || "").toLowerCase().includes(q),
      );
    }

    return list;
  }, [renders, search, statusFilter]);

  const counts = useMemo(() => ({
    all: renders.length,
    done: renders.filter((r) => r.status === "done").length,
    rendering: renders.filter((r) => r.status === "rendering").length,
    error: renders.filter((r) => r.status === "error").length,
  }), [renders]);

  const filterBtn = (key: StatusFilter, label: string) => (
    <button
      onClick={() => setStatusFilter(key)}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
        statusFilter === key
          ? "bg-white/[0.08] text-white"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
      }`}
    >
      {label}
      {counts[key] > 0 && (
        <span className="ml-1.5 text-[10px] text-zinc-500 tabular-nums">{counts[key]}</span>
      )}
    </button>
  );

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">
            {t("exports.title")}
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {t("exports.exportCount", { count: renders.length })}
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
            placeholder={t("exports.searchPlaceholder")}
            className="w-full pl-10 pr-4 py-2.5 bg-white/[0.03] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.16] transition-colors"
          />
        </div>
        <div className="flex items-center gap-1">
          {filterBtn("all", t("exports.all"))}
          {filterBtn("done", t("exports.completed"))}
          {filterBtn("rendering", t("exports.inProgress"))}
          {filterBtn("error", t("exports.errors"))}
        </div>
      </div>

      <div className="surface-static rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Film className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">
              {search || statusFilter !== "all"
                ? t("common.noResults")
                : t("exports.noExports")}
            </p>
            {!search && statusFilter === "all" && (
              <p className="text-xs text-zinc-600 mt-1">
                {t("exports.noExportsHint")}
              </p>
            )}
          </div>
        ) : (
          filtered.map((r) => <RenderRow key={r.render_id} render={r} lng={i18n.language} onDelete={handleDeleteRequest} />)
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={!!deleteTarget}
        title={t("exports.deleteExport")}
        message={t("exports.deleteExportMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />
    </div>
  );
}
