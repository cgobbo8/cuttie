import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Download, Loader2 } from "lucide-react";
import { clipThumbUrl, getJobStatus, listCompilations, listRenders, type Compilation, type JobResponse, type RenderStatus } from "../lib/api";
import { openKeptClip } from "../lib/clipVideo";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { allItems } from "../lib/compilation";
import { plainDate } from "../lib/compilationLibrary";
import { clock } from "../lib/format";
import { keptCount, liveEntries, videoFacts, type LiveEntry } from "../lib/liveEntries";
import { buildMoments } from "../lib/moments";
import { useMusics } from "../lib/music/library";
import { activeRenderId, latestPerClip } from "../lib/renders";
import { customTemplates } from "../lib/templateKeys";
import { exportVideo } from "../lib/videoExport";
import { VIDEO_SOURCES } from "../lib/videoSources";
import LiveHeader from "../components/live/LiveHeader";
import SourceName from "../components/live/SourceName";
import FreedNotice from "../components/project/FreedNotice";
import RenderCard from "../components/project/RenderCard";
import { useToast } from "../components/Toast";

/** Saved this long after its export, a video was changed since (saving the export itself takes a moment) */
const CHANGED_AFTER_MS = 60_000;

/**
 * /:jobId/export — the last step of a live: everything kept from it (clips, sequences,
 * compilations), with where each stands, exported together or one by one; and the files made.
 * A video is exported as its montage shows it, without that montage being open: one kept and
 * never opened goes out in the look every new video gets.
 */
export default function ExportStepPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const { kit, channel } = useChannel();
  const musics = useMusics();
  const [job, setJob] = useState<JobResponse | null>(null);
  const [videos, setVideos] = useState<Compilation[] | null>(null);
  const [renders, setRenders] = useState<RenderStatus[] | null>(null);
  // What the streamer ticked or unticked (by entry; else: what was never exported, or changed since)
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // Videos being made ready for their export (their clips cut, the video built)
  const [preparing, setPreparing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId).then(setJob).catch(() => navigate("/"));
    listCompilations(jobId).then(setVideos).catch(() => setVideos([]));
  }, [jobId, navigate]);

  const load = useCallback(() => {
    listRenders()
      .then(setRenders)
      .catch(() => setRenders([]));
  }, []);
  useEffect(load, [load]);

  const files = useMemo(() => (renders && jobId ? latestPerClip(renders, jobId) : []), [renders, jobId]);
  // Renders run one at a time: only the furthest along is really rendering
  const activeId = useMemo(() => activeRenderId(files), [files]);
  const busy = files.some((r) => r.status === "pending" || r.status === "rendering");
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(load, 2000);
    return () => window.clearInterval(id);
  }, [busy, load]);

  // What is kept from this live, by source
  const entries = useMemo(() => liveEntries(buildMoments(job?.hot_points ?? [], job?.selection ?? {}), videos ?? []), [job, videos]);
  const kept = useMemo(() => VIDEO_SOURCES.flatMap((source) => entries[source].filter((entry) => entry.state === "kept")), [entries]);
  const videoOf = (entry: LiveEntry): Compilation | null => (entry.kind === "video" ? entry.video : ((videos ?? []).find((video) => video.clip === entry.moment.filename) ?? null));
  const renderOf = (video: Compilation | null) => (video ? files.find((r) => r.clip_filename === `comp_${video.id}.mp4`) : undefined);
  /** Where a kept video stands: never exported, being exported, exported (and changed since or not) */
  const standing = (entry: LiveEntry) => {
    if (preparing.has(entry.key)) return "preparing" as const;
    const video = videoOf(entry);
    const render = renderOf(video);
    if (!render || render.status === "error") return "ready" as const;
    if (render.status !== "done") return "rendering" as const;
    return video && Date.parse(video.updated_at) - Date.parse(render.created_at) > CHANGED_AFTER_MS ? ("changed" as const) : ("exported" as const);
  };
  const isPicked = (entry: LiveEntry) => picked[entry.key] ?? ["ready", "changed"].includes(standing(entry));
  const chosen = kept.filter((entry) => isPicked(entry) && !["preparing", "rendering"].includes(standing(entry)));

  const first = files[0];
  useBackdrop(first && jobId ? clipThumbUrl(jobId, first.clip_filename) : null);

  /** The ticked videos are exported one after the other (a kept clip never opened gets its video first) */
  const exportChosen = async () => {
    if (!jobId || !kit || chosen.length === 0) return;
    const using = { jobId, kit, channel: channel ?? null, customs: customTemplates(kit), game: job?.vod_game ?? null, musics, t };
    const list = [...chosen];
    setPreparing(new Set(list.map((entry) => entry.key)));
    let failed = 0;
    for (const entry of list) {
      try {
        let video = videoOf(entry);
        if (!video && entry.kind === "moment") {
          const made = await openKeptClip(jobId, entry.moment.filename);
          video = made;
          setVideos((prev) => [...(prev ?? []).filter((other) => other.id !== made.id), made]);
        }
        if (!video) throw new Error("no video");
        await exportVideo(using, video);
        load();
      } catch {
        failed += 1;
      } finally {
        setPreparing((prev) => new Set([...prev].filter((key) => key !== entry.key)));
        setPicked((prev) => ({ ...prev, [entry.key]: false }));
      }
    }
    if (failed > 0) toast.error(t("exportStep.someFailed", { count: failed }));
    else toast.success(t("exportStep.started", { count: list.length }));
  };

  if (!jobId || !job || !videos) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const row = (entry: LiveEntry) => {
    const video = videoOf(entry);
    const state = standing(entry);
    const render = renderOf(video);
    const piece = video ? allItems(video).find((item) => item.ready && item.file) : undefined;
    const thumb = entry.kind === "moment" ? clipThumbUrl(jobId, entry.moment.filename) : piece ? clipThumbUrl(piece.job ?? jobId, piece.file!) : null;
    const name = entry.kind === "moment" ? (video?.name ?? entry.moment.hp.clip_name ?? "") : entry.video.name;
    const seconds = video ? videoFacts(video).seconds : entry.kind === "moment" ? entry.moment.pieces.reduce((sum, [a, b]) => sum + b - a, 0) : 0;
    const on = isPicked(entry);
    const working = state === "preparing" || state === "rendering";
    return (
      <li key={entry.key} className="flex items-center gap-3.5 px-3 py-2.5">
        <button
          role="checkbox"
          aria-checked={on}
          aria-label={name}
          disabled={working}
          onClick={() => setPicked((prev) => ({ ...prev, [entry.key]: !on }))}
          className={`flex-none w-[22px] h-[22px] rounded-[7px] border-[1.5px] grid place-items-center transition-colors disabled:opacity-40 ${on && !working ? "bg-accent border-accent text-accent-ink" : "border-white/25 text-transparent hover:border-white/50"}`}
        >
          <Check className="w-3 h-3" strokeWidth={3.4} />
        </button>
        <span className="flex-none w-[30px] h-[40px] rounded-[7px] overflow-hidden bg-white/[0.06]">{thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}</span>
        <Link to={`/${jobId}/montage?${video ? `v=${video.id}` : entry.kind === "moment" ? `clip=${encodeURIComponent(entry.moment.filename)}` : ""}`} className="flex-1 min-w-0 group">
          <span className="block truncate text-[14px] font-[560] text-white group-hover:underline decoration-white/30 underline-offset-2">{name}</span>
          <span className="mono block text-[12px] text-ink-3">{clock(seconds)}</span>
        </Link>
        <span className={`flex-none flex items-center gap-1.5 text-[12.5px] ${state === "exported" ? "text-accent" : "text-ink-2"}`}>
          {working && <Loader2 className="w-3.5 h-3.5 spinner" />}
          {state === "preparing" && t("exportStep.preparing")}
          {state === "rendering" && (render && render.render_id === activeId ? `${t("exportStep.rendering")} · ${Math.round(render.progress)} %` : t("exportStep.queued"))}
          {state === "ready" && t("exportStep.readyToExport")}
          {state === "exported" && render && t("compilations.exportedOn", { date: plainDate(render.created_at, i18n.language) })}
          {state === "changed" && t("compilations.status.changed")}
        </span>
      </li>
    );
  };

  return (
    <div className="animate-fade-in">
      <LiveHeader job={job} step="export" kept={keptCount(entries)} />

      {/* Clips freed to make room: the exports stay, the clips can come back */}
      {job.clips_freed_at && (
        <div className="mt-[22px]">
          <FreedNotice job={job} onRestored={() => getJobStatus(jobId).then(setJob).catch(() => {})} />
        </div>
      )}

      {kept.length === 0 ? (
        <section className="mt-8 glass rounded-[20px] p-7 max-w-[560px]">
          <h2 className="text-[17px] font-[600] text-white">{t("live.nothingKept")}</h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{t("exportStep.nothingKeptHint")}</p>
          <Link to={`/${jobId}`} className="btn btn-primary btn-sm mt-4">
            <ArrowLeft className="w-4 h-4" /> {t("project.step.choose")}
          </Link>
        </section>
      ) : (
        <section className="mt-5 glass rounded-[20px] p-2">
          {VIDEO_SOURCES.map((source) => {
            const theirs = kept.filter((entry) => entry.source === source);
            if (theirs.length === 0) return null;
            return (
              <div key={source}>
                <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                  <SourceName source={source} many className="text-[13px] font-[620] text-white" iconClass="w-4 h-4 text-ink-2" />
                  <span className="mono text-[12px] text-ink-3">{theirs.length}</span>
                </div>
                <ul className="divide-y divide-white/[0.06]">{theirs.map(row)}</ul>
              </div>
            );
          })}
          <div className="mt-1 px-3 pt-3 pb-2 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12.5px] text-ink-3">
              <span className="mono">1080 × 1920</span> · MP4 · {t("exportStep.levelled")}
            </span>
            <button onClick={exportChosen} disabled={chosen.length === 0 || !kit || preparing.size > 0} className="btn btn-primary btn-lg">
              {preparing.size > 0 ? <Loader2 className="w-4 h-4 spinner" /> : <Download className="w-4 h-4" />}
              {t("exportStep.exportCount", { count: chosen.length })}
            </button>
          </div>
        </section>
      )}

      {files.length > 0 && (
        <>
          <h2 className="mt-8 text-[16px] font-[600] tracking-[-0.01em] text-white">
            {t("exportStep.files")}
            {busy && <span className="ml-3 text-[12.5px] font-normal text-ink-3">{t("exportStep.keepOpen")}</span>}
          </h2>
          <section className="mt-3 grid gap-[18px] grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
            {[...files].reverse().map((r) => (
              <RenderCard key={r.render_id} jobId={jobId} render={r} queued={r.status === "rendering" && r.render_id !== activeId} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}
