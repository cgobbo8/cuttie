import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Layers, Loader2, Plus, Sparkles } from "lucide-react";
import {
  clipThumbUrl,
  deleteCompilation,
  duplicateCompilation,
  listAllCompilations,
  listCompilations,
  saveCompilation,
  type CompilationSummary,
  type LiveCompilations,
} from "../lib/api";
import { useChannel } from "../lib/ChannelContext";
import { copyName, libraryGroups, liveWhen, plainDate } from "../lib/compilationLibrary";
import { hoursMinutes, splitVodTitle } from "../lib/format";
import CompilationCard from "../components/compilation/CompilationCard";
import LivePicker from "../components/compilation/LivePicker";
import ModeSwitch from "../components/project/ModeSwitch";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

/**
 * /compilations — every compilation, by live: open, copy, rename, delete,
 * see which are exported, start a new one from any analysed live.
 * /:jobId/compilations — the same for one live, the other side of its project
 * (clips on one side, compilations on the other).
 */
export default function CompilationsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const { channel } = useChannel();
  const [lives, setLives] = useState<LiveCompilations[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<{ jobId: string; c: CompilationSummary } | null>(null);

  const load = useCallback(() => listAllCompilations(jobId).then(setLives), [jobId]);
  useEffect(() => {
    setLives(null);
    load().catch((err) => {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      setLives([]);
    });
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // The live's own picture while it has no clip (or its clips were freed)
  const vodThumbs = useMemo(() => new Map((channel?.vods ?? []).map((v) => [v.id, v.thumbnail_url])), [channel]);
  const liveCover = (live: LiveCompilations) => (live.cover_clip ? clipThumbUrl(live.job_id, live.cover_clip, { width: 480 }) : (live.vod_id && vodThumbs.get(live.vod_id)) || null);
  const liveTitle = (live: LiveCompilations) => splitVodTitle(live.title).title || t("compilations.untitledLive");
  const liveLine = (live: LiveCompilations) => {
    const when = liveWhen(live);
    return [when ? plainDate(when, i18n.language) : null, live.game, live.duration ? hoursMinutes(live.duration) : null].filter(Boolean).join(" · ");
  };

  const groups = useMemo(() => libraryGroups(lives ?? [], jobId ?? (filter || null)), [lives, jobId, filter]);
  const withSome = useMemo(() => libraryGroups(lives ?? []), [lives]);
  const total = withSome.reduce((sum, live) => sum + live.compilations.length, 0);
  const own = jobId ? (lives ?? []).find((live) => live.job_id === jobId) : null;

  const startIn = (id: string) => navigate(`/${id}/compilation?new=1`);
  const startNew = () => {
    if (jobId) startIn(jobId);
    // Always the picker: several lives can be ticked, and one not analysed yet can be analysed from it
    else setPicking(true);
  };

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };
  const duplicate = (live: LiveCompilations, c: CompilationSummary) =>
    run(c.id, async () => {
      await duplicateCompilation(live.job_id, c.id, copyName(c.name, live.compilations.map((other) => other.name), t("compilations.copyWord")));
      toast.success(t("compilations.duplicated"));
    });
  const rename = (live: LiveCompilations, c: CompilationSummary, name: string) =>
    run(c.id, async () => {
      // The whole compilation is saved under its new name
      const full = (await listCompilations(live.job_id)).find((other) => other.id === c.id);
      if (!full) throw new Error(t("common.error"));
      await saveCompilation(live.job_id, { ...full, name });
      toast.success(t("compilations.renamed"));
    });
  const confirmDelete = () => {
    const gone = toDelete;
    setToDelete(null);
    if (gone)
      run(gone.c.id, async () => {
        await deleteCompilation(gone.jobId, gone.c.id);
        toast.success(t("compilation.deleted"));
      });
  };

  if (!lives) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const grid = "grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]";
  const cards = (live: LiveCompilations) =>
    live.compilations.map((c) => (
      <CompilationCard
        key={c.id}
        jobId={live.job_id}
        compilation={c}
        fallback={liveCover(live)}
        busy={busy === c.id}
        onDuplicate={() => duplicate(live, c)}
        onRename={(name) => rename(live, c, name)}
        onDelete={() => setToDelete({ jobId: live.job_id, c })}
      />
    ));
  /** The way in: describe a video, the AI builds it */
  const newTile = (
    <button
      type="button"
      onClick={startNew}
      className="group rounded-[18px] border border-dashed border-white/[0.16] hover:border-accent-line bg-white/[0.02] hover:bg-accent-soft/40 transition-colors min-h-[220px] p-5 flex flex-col items-start justify-end text-left"
    >
      <span className="w-10 h-10 rounded-[12px] bg-accent-soft grid place-items-center text-accent">
        <Sparkles className="w-[18px] h-[18px]" />
      </span>
      <span className="mt-3 text-[15px] font-[600] text-white">{t("compilation.new")}</span>
      <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{t("compilations.newHint")}</span>
    </button>
  );

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          {jobId && (
            <Link to="/projects" className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
              <ArrowLeft className="w-4 h-4" /> {t("sidebar.projects")}
            </Link>
          )}
          <h1 className={`${jobId ? "mt-2 " : ""}text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white`}>{t("compilations.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2 max-w-[62ch]">
            {jobId && own ? [liveTitle(own), liveLine(own)].filter(Boolean).join(" · ") : total > 0 ? t("compilations.count", { count: total }) : t("compilations.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!jobId && withSome.length > 1 && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("compilations.filter")} className="h-9 max-w-[260px] px-3 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line">
              <option value="">{t("compilations.allLives")}</option>
              {withSome.map((live) => (
                <option key={live.job_id} value={live.job_id}>
                  {[liveTitle(live), liveWhen(live) ? plainDate(liveWhen(live)!, i18n.language) : null].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          )}
          {!jobId && (lives.length > 0 || (channel?.vods.length ?? 0) > 0) && (
            <button onClick={startNew} className="btn btn-primary btn-sm">
              <Plus className="w-[15px] h-[15px]" /> {t("compilation.new")}
            </button>
          )}
          {jobId && <ModeSwitch jobId={jobId} current="compilations" />}
        </div>
      </header>

      {jobId ? (
        <section className={`mt-7 ${grid}`}>
          {newTile}
          {groups[0] && cards(groups[0])}
        </section>
      ) : lives.length === 0 ? (
        <section className="mt-10 glass rounded-[20px] p-8 max-w-[560px]">
          <Layers className="w-7 h-7 text-ink-3" />
          <h2 className="mt-3 text-[17px] font-[600] text-white">{t("compilations.noLive")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("compilations.noLiveHint")}</p>
          <Link to="/" className="btn btn-primary btn-sm mt-4">
            {t("compilations.analyse")} <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      ) : groups.length === 0 ? (
        <section className={`mt-7 ${grid}`}>{newTile}</section>
      ) : (
        groups.map((live) => (
          <section key={live.job_id} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-[16px] font-[600] tracking-[-0.01em] text-white truncate">{liveTitle(live)}</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{liveLine(live)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Link to={`/${live.job_id}/compilations`} className="btn btn-ghost btn-sm">
                  {t("compilations.openLive")}
                </Link>
                <button onClick={() => startIn(live.job_id)} className="btn btn-glass btn-sm">
                  <Plus className="w-[15px] h-[15px]" /> {t("compilations.newHere")}
                </button>
              </div>
            </div>
            <div className={grid}>{cards(live)}</div>
          </section>
        ))
      )}

      {picking && (
        <LivePicker
          title={t("compilations.pickLive")}
          hint={t("compilations.pickLiveHint")}
          lives={lives}
          coverOf={liveCover}
          multiple
          confirm={(count) => (count > 1 ? t("compilations.createFrom", { count }) : t("compilation.new"))}
          // The newest live keeps the compilation; the others are the lives it also takes from
          onPick={([first, ...rest]) => navigate(`/${first}/compilation?new=1${rest.length > 0 ? `&lives=${rest.join(",")}` : ""}`)}
          onClose={() => setPicking(false)}
          onAnalysed={() => load().catch(() => {})}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title={t("compilation.deleteTitle")}
        message={toDelete?.c.exported_at ? t("compilations.deleteExported", { name: toDelete.c.name }) : t("compilations.deleteMessage", { name: toDelete?.c.name ?? "" })}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
