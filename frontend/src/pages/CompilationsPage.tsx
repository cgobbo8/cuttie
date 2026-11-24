import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, FolderDown, Layers, Loader2, Plus } from "lucide-react";
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
import { openKeptClip } from "../lib/clipVideo";
import { useChannel } from "../lib/ChannelContext";
import { copyName, liveWhen, namesKeptWith, plainDate } from "../lib/compilationLibrary";
import { hoursMinutes, splitVodTitle } from "../lib/format";
import { building, dropBuild, onBuildEnd, startBuild, useBuilds, type Build } from "../lib/backgroundBuild";
import { stepText } from "../lib/compilation";
import { useMusics } from "../lib/music/library";
import { VIDEO_SOURCES, sourceOf, type VideoSource } from "../lib/videoSources";
import ClipCard from "../components/compilation/ClipCard";
import CompilationCard from "../components/compilation/CompilationCard";
import SuggestionCard from "../components/compilation/SuggestionCard";
import LivePicker from "../components/compilation/LivePicker";
import SourceName from "../components/live/SourceName";
import ConfirmModal from "../components/ConfirmModal";
import { useAssistantPlace } from "../lib/AssistantContext";
import { useToast } from "../components/Toast";
import AssistantMark from "../components/assistant/Mark";

type Standing = "all" | "draft" | "exported";

/**
 * /compilations — « Vidéos »: by live, the newest first, the videos the AI proposes to make of
 * it (its ideas of sequences and compilations nobody decided on, at the head of the live) and
 * everything kept of it: the clips kept from the analysis, the sequences and the compilations
 * made. Filtered by what a video is made from and by where it stands. A card opens the video's
 * montage in its live; an idea is built from here, behind the page. (The clips still to sort
 * are on the live's own page.)
 * A compilation made from several lives is with each of them: the same card, the same video
 * (`home`: the live it is kept with, where every action on it goes).
 */
export default function CompilationsPage() {
  const { t, i18n } = useTranslation();
  useAssistantPlace({ page: "videos" });
  const toast = useToast();
  const navigate = useNavigate();
  const { channel } = useChannel();
  const [lives, setLives] = useState<LiveCompilations[] | null>(null);
  const [kind, setKind] = useState<VideoSource | "all">("all");
  const [standing, setStanding] = useState<Standing>("all");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CompilationSummary | null>(null);

  const load = useCallback(() => listAllCompilations().then(setLives), []);
  useEffect(() => {
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
  /** "9 nov. · Le titre du live", for each live a compilation is made from */
  const madeFrom = (c: CompilationSummary) =>
    c.lives.flatMap((id) => {
      const live = (lives ?? []).find((other) => other.job_id === id);
      if (!live) return [];
      const when = liveWhen(live);
      return [[when ? plainDate(when, i18n.language) : null, liveTitle(live)].filter(Boolean).join(" · ")];
    });

  // What each live shows: the ideas the AI proposes for it that nobody decided on (the most promising first, not among
  // what is exported: none is), then what is kept of it: the videos made (not the blank ones) and the kept clips that have no video yet
  const keptOf = useCallback(
    (live: LiveCompilations) => {
      const ideas =
        standing === "exported"
          ? []
          : live.compilations
              .filter((c) => c.home === live.job_id && c.waiting && !c.passed && c.suggestion && (kind === "all" || sourceOf(c) === kind))
              .sort((a, b) => (b.suggestion?.score ?? 0) - (a.suggestion?.score ?? 0));
      const videos = live.compilations.filter((c) => !c.waiting && !c.passed && c.passages > 0 && (kind === "all" || sourceOf(c) === kind) && (standing === "all" || (standing === "exported") === !!c.exported_at));
      const clips = kind === "all" || kind === "clip" ? (live.clips ?? []).filter((clip) => clip.state === "kept" && standing !== "exported") : [];
      return { ideas, videos: [...videos].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)), clips };
    },
    [kind, standing],
  );
  const shown = useMemo(
    () =>
      (lives ?? [])
        .map((live) => ({ live, ...keptOf(live) }))
        // (a live the AI is looking through is listed before it has anything: its ideas are about to come)
        .filter((group) => group.ideas.length + group.videos.length + group.clips.length > 0 || (group.live.looking && standing !== "exported" && kind !== "clip"))
        .sort((a, b) => Date.parse(liveWhen(b.live) ?? "") - Date.parse(liveWhen(a.live) ?? "")),
    [keptOf, lives],
  );
  /** How many kept videos there are of each source (one made from several lives is listed with each, and counts once) */
  const countOf = (source: VideoSource | "all") =>
    (lives ?? []).reduce(
      (sum, live) =>
        sum +
        live.compilations.filter((c) => c.home === live.job_id && !c.waiting && !c.passed && c.passages > 0 && (source === "all" || sourceOf(c) === source)).length +
        (source === "all" || source === "clip" ? (live.clips ?? []).filter((clip) => clip.state === "kept").length : 0),
      0,
    );

  /* ── What the AI proposes for each live ─────────────────── */

  const builds = useBuilds();
  const musics = useMusics();
  /** An idea is chosen: the AI builds it behind this page, and it joins what is kept when it is ready */
  const buildIdea = async (live: LiveCompilations, c: CompilationSummary) => {
    if (busy) return;
    setBusy(c.id);
    try {
      // (the list holds a summary of each video: the idea itself, with what the AI wrote for it, is asked of its live)
      const video = (await listCompilations(c.home)).find((one) => one.id === c.id);
      if (!video) throw new Error(t("common.error"));
      startBuild(c.home, video, { duration: live.duration ?? 0, language: i18n.language.slice(0, 2), tracks: musics.map((track) => track.id) });
      toast.info(t("live.buildStarted", { name: c.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(null);
    }
  };
  /** ...or passed on: it leaves this page, and stays in its live, where it can be taken back */
  const passIdea = async (c: CompilationSummary) => {
    if (busy) return;
    setBusy(c.id);
    try {
      const video = (await listCompilations(c.home)).find((one) => one.id === c.id);
      if (video) await saveCompilation(c.home, { ...video, passed: true });
      await load();
      toast.success(t("suggestions.dismissed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    } finally {
      setBusy(null);
    }
  };
  // While the AI looks through a live for videos to propose, the list is read again now and then: its ideas come by themselves
  const someLooking = (lives ?? []).some((live) => live.looking);
  useEffect(() => {
    if (!someLooking) return;
    const timer = window.setInterval(() => load().catch(() => {}), 8000);
    return () => window.clearInterval(timer);
  }, [load, someLooking]);
  // A build ended while this page is on screen: the list is read again, and its outcome said
  useEffect(
    () =>
      onBuildEnd((build: Build) => {
        load().catch(() => {});
        if (build.state === "done") toast.success(t("live.built", { name: build.name }));
        else toast.error(build.why === "empty" ? t("compilation.planEmpty") : t(`compilation.failure.${build.why ?? "failed"}`));
        dropBuild(build.job, build.id);
      }),
    [load, t, toast],
  );
  /** What a build is doing, in a few words (null: this idea is not being built) */
  const buildLine = (c: CompilationSummary): string | null => {
    const build = building(builds, c.home, c.id);
    return !build ? null : build.state === "waiting" ? t("live.buildWaiting") : build.state === "cutting" ? t("live.buildCutting") : stepText(t, build.step);
  };

  /** A kept clip opened for the first time: it becomes a video like the others, in its montage */
  const openClip = async (jobId: string, filename: string) => {
    if (busy) return;
    setBusy(filename);
    try {
      const video = await openKeptClip(jobId, filename);
      navigate(`/${jobId}/montage?v=${video.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
      setBusy(null);
    }
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
  const duplicate = (c: CompilationSummary) =>
    run(c.id, async () => {
      await duplicateCompilation(c.home, c.id, copyName(c.name, namesKeptWith(lives ?? [], c.home), t("compilations.copyWord")));
      toast.success(t("compilations.duplicated"));
    });
  const rename = (c: CompilationSummary, name: string) =>
    run(c.id, async () => {
      // The whole video is saved under its new name
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

  const pill = (on: boolean) => `flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] transition-colors ${on ? "font-semibold bg-ink text-ground" : "text-ink-2 hover:bg-white/[0.08] hover:text-white"}`;

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">{t("videos.title")}</h1>
          <p className="mt-2 text-[13.5px] text-ink-2 max-w-[62ch]">{t("videos.keptAll")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/exports" className="btn btn-ghost btn-sm">
            <FolderDown className="w-[15px] h-[15px]" /> {t("videos.files")}
          </Link>
          {(lives.length > 0 || (channel?.vods.length ?? 0) > 0) && (
            <button onClick={() => setPicking(true)} className="btn btn-primary btn-sm">
              <Plus className="w-[15px] h-[15px]" /> {t("videos.newVideo")}
            </button>
          )}
        </div>
      </header>

      {lives.length === 0 ? (
        <section className="mt-10 glass rounded-[20px] p-8 max-w-[560px]">
          <Layers className="w-7 h-7 text-ink-3" />
          <h2 className="mt-3 text-[17px] font-[600] text-white">{t("compilations.noLive")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("compilations.noLiveHint")}</p>
          <Link to="/" className="btn btn-primary btn-sm mt-4">
            {t("compilations.analyse")} <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      ) : (
        <>
          {/* What a video is made from, then where it stands */}
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <nav aria-label={t("project.modes")} className="glass-still inline-flex items-center gap-0.5 p-1 rounded-[13px]">
              <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")} className={pill(kind === "all")}>
                {t("videos.all")} <span className={`mono text-[11.5px] ${kind === "all" ? "opacity-60" : "text-ink-3"}`}>{countOf("all")}</span>
              </button>
              {VIDEO_SOURCES.map((source) => (
                <button key={source} type="button" aria-pressed={kind === source} onClick={() => setKind(source)} className={pill(kind === source)}>
                  <SourceName source={source} many />
                  <span className={`mono text-[11.5px] ${kind === source ? "opacity-60" : "text-ink-3"}`}>{countOf(source)}</span>
                </button>
              ))}
            </nav>
            <div role="group" aria-label={t("videos.standing.label")} className="seg">
              {(["all", "draft", "exported"] as const).map((one) => (
                <button key={one} type="button" aria-pressed={standing === one} onClick={() => setStanding(one)}>
                  {t(`videos.standing.${one}`)}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 && (
            <section className="mt-8 glass rounded-[20px] p-7 max-w-[560px]">
              <h2 className="text-[17px] font-[600] text-white">{t("videos.noneKept")}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("videos.noneKeptHint")}</p>
              <Link to="/projects" className="btn btn-primary btn-sm mt-4">
                {t("sidebar.projects")} <ArrowRight className="w-4 h-4" />
              </Link>
            </section>
          )}

          {shown.map(({ live, ideas, videos, clips }) => (
            <section key={live.job_id} className="mt-8">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h2 className="text-[16px] font-[600] tracking-[-0.01em] text-white truncate">{liveTitle(live)}</h2>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">{liveLine(live)}</p>
                </div>
                <Link to={`/${live.job_id}`} className="btn btn-ghost btn-sm">
                  {t("compilations.openLive")} <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
              {live.looking && standing !== "exported" && kind !== "clip" && (
                <p role="status" className="ai-ideas mb-4 flex items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-[13.5px] text-ink-2">
                  <AssistantMark size={22} busy className="flex-none" />
                  {t("videos.looking")}
                </p>
              )}
              {/* What the AI proposes for this live, before what is kept of it: an idea chosen is built behind the page and joins the videos below */}
              {ideas.length > 0 && (
                <div className={`grid gap-4 grid-cols-[repeat(auto-fill,minmax(310px,1fr))] ${videos.length + clips.length > 0 ? "mb-4" : ""}`}>
                  {ideas.map((c) => (
                    <SuggestionCard key={`${c.home}/${c.id}`} jobId={c.home} compilation={c} fallback={liveCover(live)} busy={busy === c.id} building={buildLine(c)} onBuild={() => buildIdea(live, c)} onDismiss={() => passIdea(c)} />
                  ))}
                </div>
              )}
              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
                {videos.map((c) => (
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
                ))}
                {/* Kept in « Choisir » and never opened: a click makes each a video like the others */}
                {clips.map((clip) => (
                  <ClipCard key={`${live.job_id}/${clip.filename}`} jobId={live.job_id} clip={clip} busy={busy === clip.filename} onOpen={() => openClip(live.job_id, clip.filename)} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {picking && (
        <LivePicker
          title={t("compilations.pickLive")}
          hint={t("videos.pickLiveHint")}
          lives={lives}
          coverOf={liveCover}
          // (several lives: a compilation that takes from all of them)
          multiple
          confirm={(count) => (count > 1 ? t("compilations.createFrom", { count }) : t("videos.openLive"))}
          // One live: what it gives is chosen on its own page. Several: a compilation kept with the newest, taking from the others too
          onPick={([first, ...rest]) => navigate(rest.length > 0 ? `/${first}/montage?new=1&kind=compilation&lives=${rest.join(",")}` : `/${first}`)}
          onClose={() => setPicking(false)}
          onAnalysed={() => load().catch(() => {})}
        />
      )}

      <ConfirmModal
        open={!!toDelete}
        title={t("compilation.deleteTitle")}
        message={[
          toDelete?.exported_at ? t("compilations.deleteExported", { name: toDelete.name }) : t("compilations.deleteMessage", { name: toDelete?.name ?? "" }),
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
