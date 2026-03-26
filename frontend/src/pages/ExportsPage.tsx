import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Loader2, Download, AlertCircle, Film } from "lucide-react";
import { listRenders, clipUrl, type RenderStatus } from "../lib/api";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RenderRow({ render }: { render: RenderStatus }) {
  const isRendering = render.status === "rendering";
  const isDone = render.status === "done";
  const isError = render.status === "error";

  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
      {/* Icon */}
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          isDone
            ? "bg-green-500/10 text-green-400"
            : isError
              ? "bg-red-500/10 text-red-400"
              : "bg-purple-500/10 text-purple-400"
        }`}
      >
        {isRendering ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : isError ? (
          <AlertCircle className="w-5 h-5" />
        ) : (
          <Film className="w-5 h-5" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">
          {render.clip_filename}
        </div>
        <div className="text-[11px] text-zinc-500 flex items-center gap-2">
          {render.vod_title && (
            <span className="truncate max-w-[200px]">{render.vod_title}</span>
          )}
          <span>{fmtDate(render.created_at)}</span>
        </div>
      </div>

      {/* Status / progress */}
      <div className="shrink-0 flex items-center gap-3">
        {isRendering && (
          <div className="flex items-center gap-2">
            <div className="w-24 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all duration-500"
                style={{ width: `${render.progress}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-400 font-mono w-8 text-right">
              {render.progress}%
            </span>
          </div>
        )}

        {isError && (
          <span className="text-[11px] text-red-400 font-medium">Erreur</span>
        )}

        {isDone && render.url && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-500 font-mono">
              {render.size_mb} MB
            </span>
            <button
              onClick={async () => {
                const res = await fetch(clipUrl(render.job_id, render.output_filename!));
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = render.output_filename!;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 hover:text-purple-200 transition-colors font-medium flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Telecharger
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExportsPage() {
  const [renders, setRenders] = useState<RenderStatus[]>([]);
  const [loading, setLoading] = useState(true);

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
    // Poll every 2s while renders are in progress (or on first load)
    const interval = setInterval(load, hasRendering || loading ? 2000 : 10000);
    return () => { active = false; clearInterval(interval); };
  }, [hasRendering, loading]);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Exports</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Retrouve tous tes rendus video ici.
          </p>
        </div>
        <Link
          to="/"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Retour
        </Link>
      </div>

      <div className="glass rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-purple-400" />
          </div>
        ) : renders.length === 0 ? (
          <div className="text-center py-16">
            <Film className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
            <p className="text-sm text-zinc-500">Aucun export pour l'instant.</p>
            <p className="text-xs text-zinc-600 mt-1">
              Lance un export depuis l'editeur pour le voir ici.
            </p>
          </div>
        ) : (
          renders.map((r) => <RenderRow key={r.render_id} render={r} />)
        )}
      </div>
    </div>
  );
}
