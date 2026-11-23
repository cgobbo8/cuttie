import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Film, Layers, Lightbulb, Loader2, Plus, Scissors, Sparkles } from "lucide-react";
import {
  LiveError,
  clipThumbUrl,
  deleteCompilation,
  duplicateCompilation,
  findSuggestions,
  listAllCompilations,
  listCompilations,
  openClipVideo,
  saveCompilation,
  type CompilationSummary,
  type LiveCompilations,
} from "../lib/api";
import { useChannel } from "../lib/ChannelContext";
import { copyName, libraryGroups, liveWhen, namesKeptWith, plainDate } from "../lib/compilationLibrary";
import { hoursMinutes, splitVodTitle } from "../lib/format";
import { waitingBySource, waitingIn, withProposedFirst } from "../lib/suggestions";
import { VIDEO_SOURCES, isVideoSource, sourceOf, type VideoSource } from "../lib/videoSources";
import ClipCard from "../components/compilation/ClipCard";
import CompilationCard from "../components/compilation/CompilationCard";
import SuggestionCard from "../components/compilation/SuggestionCard";
import LivePicker from "../components/compilation/LivePicker";
import ModeSwitch from "../components/project/ModeSwitch";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

const SOURCE_ICONS = { clip: Scissors, sequence: Film, compilation: Layers } as const;

/**
 * /compilations — every video, by live: open, copy, rename, delete, see which are exported,
 * start a new one from any analysed live.
 * /:jobId/compilations — the same for one live.
 * Three sources at the same level (?kind=clip|sequence|compilation, see lib/videoSources.ts):
 * a live's clips (those the analysis found, opened as a video on a click, and those asked to the
 * AI), its sequences and its compilations. After its source a video is the same thing: the same
 * card, the same editor, the same export.
 * A compilation made from several lives is with each of them: the same card, the
 * same compilation (`home`: the live it is kept with, where every action on it goes).
 * The videos the AI proposed for a live come first, each on a card of its own: an
 * idea with what it noticed, opened to have it built.
 */
export default function CompilationsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const [search, setSearch] = useSearchParams();
  // The source on screen (nothing said: compilations, where this page used to open)
  const kind: VideoSource = isVideoSource(search.get("kind")) ? (search.get("kind") as VideoSource) : "compilation";
  const { channel } = useChannel();
  const [lives, setLives] = useState<LiveCompilations[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CompilationSummary | null>(null);
  // The live the AI is being asked to look through for ideas
  const [finding, setFinding] = useState<string | null>(null);

  // Every live, even for one live's page: its cards name the other lives they are made from
  const load = useCallback(() => listAllCompilations().then(setLives), []);
  useEffect(() => {
    load().catch((err) => {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      setLives([]);
    });
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // A live just analysed: the AI is looking through it, what it proposes shows up when it is done
  const looking = (lives ?? []).some((live) => live.looking);
  useEffect(() => {
    if (!looking) return;
    const timer = window.setInterval(() => load().catch(() => {}), 4000);
    return () => window.clearInterval(timer);
  }, [looking, load]);

  /** Has the AI look through a live for compilations worth making */
  const findIdeas = async (id: string) => {
    if (finding) return;
    setFinding(id);
    try {
      const found = await findSuggestions(id);
      await load();
      if (found.compilations.length > 0) toast.success(t("suggestions.proposed", { count: found.compilations.length }));
      else toast.info(t("suggestions.nothingNew"));
    } catch (err) {
      toast.error(err instanceof LiveError ? t(`compilation.failure.${err.reason}`) : err instanceof Error ? err.message : t("common.error"));
    } finally {
      setFinding(null);
    }
  };

  // The live's own picture while it has no clip (or its clips were freed)
  const vodThumbs = useMemo(() => new Map((channel?.vods ?? []).map((v) => [v.id, v.thumbnail_url])), [channel]);
  const liveCover = (live: LiveCompilations) => (live.cover_clip ? clipThumbUrl(live.job_id, live.cover_clip, { width: 480 }) : (live.vod_id && vodThumbs.get(live.vod_id)) || null);
  const liveTitle = (live: LiveCompilations) => splitVodTitle(live.title).title || t("compilations.untitledLive");
  const liveLine = (live: LiveCompilations) => {
    const when = liveWhen(live);
    return [when ? plainDate(when, i18n.language) : null, live.game, live.duration ? hoursMinutes(live.duration) : null].filter(Boolean).join(" · ");
  };

  const withSome = useMemo(() => libraryGroups(lives ?? []), [lives]);
  const proposed = waitingIn(lives ?? []);
  /** "9 nov. · Le titre du live", for each live a compilation is made from */
  const madeFrom = (c: CompilationSummary) =>
    c.lives.flatMap((id) => {
      const live = (lives ?? []).find((other) => other.job_id === id);
      if (!live) return [];
      const when = liveWhen(live);
      return [[when ? plainDate(when, i18n.language) : null, liveTitle(live)].filter(Boolean).join(" · ")];
    });
  const own = jobId ? (lives ?? []).find((live) => live.job_id === jobId) : null;

  const startIn = (id: string) => navigate(`/${id}/compilation?new=1&kind=${kind}`);
  const startNew = () => {
    if (jobId) startIn(jobId);
    // Always the picker: several lives can be ticked (a compilation only), and one not analysed yet can be analysed from it
    else setPicking(true);
  };
  /** A clip of the analysis becomes a video like the others, and opens in the editor */
  const openClip = async (id: string, filename: string) => {
    if (busy) return;
    setBusy(filename);
    try {
      const video = await openClipVideo(id, filename);
      navigate(`/${id}/compilation?c=${video.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      setBusy(null);
    }
  };
  /** How many videos of each source there are on screen (one live's, or every live's) */
  const scope = (lives ?? []).filter((live) => (jobId ? live.job_id === jobId : !filter || live.job_id === filter));
  const countOf = (source: VideoSource) =>
    scope.reduce((sum, live) => sum + live.compilations.filter((c) => c.home === live.job_id && sourceOf(c) === source).length + (source === "clip" ? (live.clips?.length ?? 0) : 0), 0);

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
  const duplicate = (c: CompilationSummary) =>
    run(c.id, async () => {
      await duplicateCompilation(c.home, c.id, copyName(c.name, namesKeptWith(lives ?? [], c.home), t("compilations.copyWord")));
      toast.success(t("compilations.duplicated"));
    });
  const rename = (c: CompilationSummary, name: string) =>
    run(c.id, async () => {
      // The whole compilation is saved under its new name
      const full = (await listCompilations(c.home)).find((other) => other.id === c.id);
      if (!full) throw new Error(t("common.error"));
      await saveCompilation(c.home, { ...full, name });
      toast.success(t("compilations.renamed"));
    });
  const confirmDelete = () => {
    const gone = toDelete;
    setToDelete(null);
    if (gone)
      run(gone.id, async () => {
        await deleteCompilation(gone.home, gone.id);
        toast.success(t(gone.waiting ? "suggestions.dismissed" : "compilation.deleted"));
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
  const cards = (live: LiveCompilations) => [
    ...withProposedFirst(live.compilations.filter((c) => sourceOf(c) === kind)).map((c) =>
      c.waiting ? (
        // An idea of the AI, not built yet
        <SuggestionCard key={`${c.home}/${c.id}`} jobId={c.home} compilation={c} fallback={liveCover(live)} busy={busy === c.id} onDismiss={() => setToDelete(c)} />
      ) : (
      <CompilationCard
        key={`${c.home}/${c.id}`}
        jobId={c.home}
        compilation={c}
        madeFrom={madeFrom(c)}
        fallback={liveCover(live)}
        busy={busy === c.id}
        onDuplicate={() => duplicate(c)}
        onRename={(name) => rename(c, name)}
        onDelete={() => setToDelete(c)}
      />
      ),
    ),
    // The clips the analysis found, not opened yet: a click makes each a video like the others
    ...(kind === "clip" ? (live.clips ?? []).map((clip) => <ClipCard key={`${live.job_id}/${clip.filename}`} jobId={live.job_id} clip={clip} busy={busy === clip.filename} onOpen={() => openClip(live.job_id, clip.filename)} />) : []),
  ];
  /** A live the AI never looked through (analysed before it did so by itself): it can be asked to */
  const canFind = (live: LiveCompilations | null | undefined): live is LiveCompilations => !!live && !live.looked_at && !live.looking;
  const ideasTile = (live: LiveCompilations) => (
    <button
      type="button"
      onClick={() => findIdeas(live.job_id)}
      disabled={!!finding}
      className="group rounded-[18px] border border-dashed border-accent-line/50 hover:border-accent-line bg-accent-soft/20 hover:bg-accent-soft/40 transition-colors min-h-[220px] p-5 flex flex-col items-start justify-end text-left disabled:cursor-wait"
    >
      <span className="w-10 h-10 rounded-[12px] bg-accent-soft grid place-items-center text-accent">
        {finding === live.job_id ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <Lightbulb className="w-[18px] h-[18px]" />}
      </span>
      <span className="mt-3 text-[15px] font-[600] text-white">{t(finding === live.job_id ? "suggestions.finding" : "suggestions.findTitle")}</span>
      <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{t("suggestions.findHint")}</span>
    </button>
  );
  const lookingNote = (
    <p role="status" className="flex items-center gap-2 text-[12.5px] text-ink-2">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> {t("suggestions.looking")}
    </p>
  );
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
      <span className="mt-3 text-[15px] font-[600] text-white">{t(`videos.new.${kind}`)}</span>
      <span className="mt-1 text-[12.5px] leading-snug text-ink-2">{t(`videos.newHint.${kind}`)}</span>
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
          <h1 className={`${jobId ? "mt-2 " : ""}text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white`}>{t("videos.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2 max-w-[62ch]">{jobId && own ? [liveTitle(own), liveLine(own)].filter(Boolean).join(" · ") : t("videos.subtitle")}</p>
          {!jobId && proposed > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-accent">
              <Sparkles className="w-3.5 h-3.5" /> {t("suggestions.waiting", { count: proposed })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!jobId && withSome.length > 1 && (
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("compilations.filter")} className="select-arrow h-9 max-w-[260px] px-3 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line">
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
              <Plus className="w-[15px] h-[15px]" /> {t(`videos.new.${kind}`)}
            </button>
          )}
          {jobId && <ModeSwitch jobId={jobId} current={kind} here suggested={waitingBySource(own?.compilations ?? [])} />}
        </div>
      </header>

      {/* The three sources, at the same level (on one live's page the switch above says it) */}
      {!jobId && (
        <nav aria-label={t("project.modes")} className="mt-6 glass-still inline-flex items-center gap-0.5 p-1 rounded-[13px]">
          {VIDEO_SOURCES.map((source) => {
            const Icon = SOURCE_ICONS[source];
            return (
              <button
                key={source}
                type="button"
                aria-pressed={source === kind}
                onClick={() => setSearch(source === "compilation" ? {} : { kind: source }, { replace: true })}
                className={`flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] transition-colors ${source === kind ? "font-semibold bg-ink text-ground" : "text-ink-2 hover:bg-white/[0.08] hover:text-white"}`}
              >
                <Icon className="w-4 h-4" /> {t(`project.mode.${source}`)}
                <span className={`mono text-[11.5px] ${source === kind ? "opacity-60" : "text-ink-3"}`}>{countOf(source)}</span>
              </button>
            );
          })}
        </nav>
      )}
      <p className="mt-3 text-[13px] text-ink-3">
        {t(`videos.about.${kind}`)}
        {kind === "clip" && jobId && (
          <>
            {" "}
            <Link to={`/${jobId}`} className="text-ink-2 underline decoration-white/20 underline-offset-2 hover:text-white">
              {t("videos.sort")}
            </Link>
          </>
        )}
      </p>

      {jobId ? (
        <>
          {own?.looking && <div className="mt-5">{lookingNote}</div>}
          <section className={`mt-5 ${grid}`}>
            {newTile}
            {kind !== "clip" && canFind(own) && ideasTile(own)}
            {own && cards(own)}
          </section>
        </>
      ) : lives.length === 0 ? (
        <section className="mt-10 glass rounded-[20px] p-8 max-w-[560px]">
          <Layers className="w-7 h-7 text-ink-3" />
          <h2 className="mt-3 text-[17px] font-[600] text-white">{t("compilations.noLive")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("compilations.noLiveHint")}</p>
          <Link to="/" className="btn btn-primary btn-sm mt-4">
            {t("compilations.analyse")} <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      ) : scope.every((live) => cards(live).length === 0) ? (
        <section className={`mt-5 ${grid}`}>{newTile}</section>
      ) : (
        scope.filter((live) => cards(live).length > 0).map((live) => (
          <section key={live.job_id} className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-[16px] font-[600] tracking-[-0.01em] text-white truncate">{liveTitle(live)}</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{liveLine(live)}</p>
                {live.looking && <div className="mt-1.5">{lookingNote}</div>}
              </div>
              <div className="flex items-center gap-1.5">
                {kind !== "clip" && canFind(live) && (
                  <button onClick={() => findIdeas(live.job_id)} disabled={!!finding} title={t("suggestions.findHint")} className="btn btn-ghost btn-sm">
                    {finding === live.job_id ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Lightbulb className="w-[15px] h-[15px] text-accent" />}
                    {t(finding === live.job_id ? "suggestions.finding" : "suggestions.find")}
                  </button>
                )}
                <Link to={`/${live.job_id}/compilations?kind=${kind}`} className="btn btn-ghost btn-sm">
                  {t("compilations.openLive")}
                </Link>
                <button onClick={() => startIn(live.job_id)} className="btn btn-glass btn-sm">
                  <Plus className="w-[15px] h-[15px]" /> {t(`videos.new.${kind}`)}
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
          // (only a compilation takes from several lives)
          multiple={kind === "compilation"}
          confirm={(count) => (count > 1 ? t("compilations.createFrom", { count }) : t(`videos.new.${kind}`))}
          // The newest live keeps the video; the others are the lives a compilation also takes from
          onPick={([first, ...rest]) => navigate(`/${first}/compilation?new=1&kind=${kind}${rest.length > 0 ? `&lives=${rest.join(",")}` : ""}`)}
          onClose={() => setPicking(false)}
          onAnalysed={() => load().catch(() => {})}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title={t(toDelete?.waiting ? "suggestions.dismissTitle" : "compilation.deleteTitle")}
        message={[
          toDelete?.waiting
            ? t("suggestions.dismissMessage", { name: toDelete.name })
            : toDelete?.exported_at
              ? t("compilations.deleteExported", { name: toDelete.name })
              : t("compilations.deleteMessage", { name: toDelete?.name ?? "" }),
          // The same compilation is listed with each of its lives: it goes from all of them
          toDelete && toDelete.lives.length > 1 ? t("compilations.deleteEverywhere", { count: toDelete.lives.length }) : null,
        ]
          .filter(Boolean)
          .join(" ")}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
