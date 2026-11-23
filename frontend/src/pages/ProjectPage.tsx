import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, Check, ChevronDown, Loader2, RotateCcw, Upload, X } from "lucide-react";
import {
  clipThumbUrl,
  deleteClip,
  deleteCompilation,
  getStoryboard,
  listCompilations,
  saveCompilation,
  getJobChat,
  getJobStatus,
  listRenders,
  mapSSEHotPoint,
  renameClip,
  retryJob,
  updateSelection,
  type ClipChatLine,
  type ClipSelection,
  type Compilation,
  type TwitchStoryboard,
  type JobResponse,
  type TimelineCandidate,
} from "../lib/api";
import { MEMORY_READ } from "../lib/aiMemory";
import { useAssistantChanged, useAssistantPlace } from "../lib/AssistantContext";
import { splitVodTitle } from "../lib/format";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { useTransmitChannel } from "../lib/TransmitContext";
import { buildMoments, nextTodo, type MomentState } from "../lib/moments";
import type { Range } from "../lib/montage";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import ProviderFix, { providerNotice } from "../components/ProviderFix";
import ImportClipModal from "../components/ImportClipModal";
import AnalysisView from "../components/project/AnalysisView";
import LiveHeader from "../components/live/LiveHeader";
import SourceList from "../components/live/SourceList";
import VideoDetail from "../components/live/VideoDetail";
import { ideasToSee, keptCount, liveEntries, momentKey, shownEntries, videoMoments, type LiveEntry } from "../lib/liveEntries";
import { VIDEO_SOURCES, sourceOf, type VideoSource } from "../lib/videoSources";
import VodTimeline from "../components/project/VodTimeline";
import MomentPlayer, { type MomentPlayerHandle } from "../components/project/MomentPlayer";
import MomentDetails from "../components/project/MomentDetails";
import FreedNotice from "../components/project/FreedNotice";
import { latestPerClip } from "../lib/renders";

function vodIdOf(url: string | null): string | null {
  return url?.match(/videos\/(\d+)/)?.[1] ?? null;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function ProjectPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  // ?clip=<file> or ?video=<id>: what to show first (a link from the assistant, or from the videos' page)
  const [search, setSearch] = useSearchParams();
  const { channel } = useChannel();

  const [job, setJob] = useState<JobResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const playerRef = useRef<MomentPlayerHandle>(null);
  // The live's sequences and compilations (ideas of the AI and videos made), beside its clips
  const [videos, setVideos] = useState<Compilation[]>([]);
  // The sequence or compilation on screen (its id); none: the clip selected is
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Partial<Record<VideoSource, boolean>>>({});
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<Compilation | null>(null);
  const loadVideos = useCallback(() => {
    if (jobId) listCompilations(jobId).then(setVideos).catch(() => {});
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    getJobStatus(jobId)
      .then((j) => !cancelled && setJob(j))
      .catch(() => !cancelled && navigate("/"));
    return () => {
      cancelled = true;
    };
  }, [jobId, navigate]);

  // Live updates while the analysis runs
  useTransmitChannel(jobId ? `jobs/${jobId}` : null, (raw: unknown) => {
    const data = raw as Record<string, any>;
    // The AI has just read the live into its memory: it may have a correction to propose for a note (NoteProposals)
    if (data.type === "memory") {
      window.dispatchEvent(new Event(MEMORY_READ));
      return;
    }
    // The AI looked through the live once analysed: the videos it proposes join the list
    if (data.type === "suggestions") {
      if (data.count > 0) toast.success(t("suggestions.toast", { count: data.count }));
      loadVideos();
      setJob((prev) => (prev ? { ...prev, suggested: data.suggested ?? prev.suggested } : prev));
      return;
    }
    setJob((prev) => {
      if (!prev) return prev;
      // Live view of the analysis
      if (data.type === "timeline" && data.timeline) {
        return { ...prev, timeline: { ...(prev.timeline ?? {}), ...data.timeline } };
      }
      if (data.type === "candidate" && data.candidate) {
        const c = data.candidate as TimelineCandidate;
        const candidates = [...(prev.timeline?.candidates ?? [])];
        const i = candidates.findIndex((x) => Math.abs(x.t - c.t) < 0.05);
        if (i >= 0) candidates[i] = { ...candidates[i], ...c };
        else candidates.push(c);
        return { ...prev, timeline: { ...(prev.timeline ?? {}), candidates } };
      }
      if (data.type === "clip_ready" && data.hot_point) {
        const hp = mapSSEHotPoint(data.hot_point);
        const rest = (prev.hot_points ?? []).filter((c) => c.clip_filename !== hp.clip_filename || !hp.clip_filename);
        return { ...prev, hot_points: [...rest, hp] };
      }
      return {
        ...prev,
        status: data.status ?? prev.status,
        progress: data.progress ?? prev.progress,
        step_timings: data.step_timings ?? prev.step_timings,
        notices: data.notices ?? prev.notices,
        error: data.error ?? prev.error,
        hot_points: data.status === "DONE" && data.hot_points?.length && !(prev.hot_points ?? []).some((h) => h.clip_filename)
          ? data.hot_points.map(mapSSEHotPoint)
          : prev.hot_points,
      };
    });
    // Done: the final clips (cuts and key moments on each clip's clock), as saved
    if (data.status === "DONE" && jobId) getJobStatus(jobId).then(setJob).catch(() => {});
  });

  const moments = useMemo(() => buildMoments(job?.hot_points ?? [], job?.selection ?? {}), [job]);
  // One list for everything the live gives: clips, sequences, compilations
  const entries = useMemo(() => liveEntries(moments, videos), [moments, videos]);
  const kept = keptCount(entries);

  // Open on the first moment still to sort
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || moments.length === 0 || openedFor.current === jobId) return;
    openedFor.current = jobId;
    if (search.has("clip") || search.has("video")) return;
    const first = moments.findIndex((m) => m.state === "todo");
    setSelected(first === -1 ? 0 : first);
  }, [jobId, moments, search]);
  // ...unless the address names a clip or a video of this live: that one, once it is known
  const wantsClip = search.get("clip");
  const wantsVideo = search.get("video");
  useEffect(() => {
    if (!wantsClip && !wantsVideo) return;
    const clip = wantsClip ? moments.findIndex((m) => m.filename === wantsClip) : -1;
    const video = wantsVideo ? videos.find((one) => one.id === wantsVideo) : undefined;
    if (clip === -1 && !video) return;
    if (video) setOpenVideo(video.id);
    else {
      setOpenVideo(null);
      setSelected(clip);
    }
    setInteracted(true);
    setSearch({}, { replace: true });
  }, [moments, setSearch, videos, wantsClip, wantsVideo]);

  // The assistant changed this live (a clip kept, ideas added): read again
  useAssistantChanged(jobId, () => {
    if (!jobId) return;
    getJobStatus(jobId).then(setJob).catch(() => {});
    loadVideos();
  });

  // Freed projects point to their exports
  const [exportCount, setExportCount] = useState(0);
  const freedAt = job?.clips_freed_at;
  useEffect(() => {
    if (!jobId || !freedAt) return;
    listRenders()
      .then((renders) => setExportCount(latestPerClip(renders, jobId).filter((r) => r.status === "done").length))
      .catch(() => setExportCount(0));
  }, [jobId, freedAt]);

  // When the chat spoke in each clip, for the trim strip (once the clips exist)
  const [clipChat, setClipChat] = useState<Record<string, ClipChatLine[]>>({});
  const done = job?.status === "DONE";
  useEffect(() => {
    if (!jobId || !done) return;
    getJobChat(jobId).then(setClipChat).catch(() => setClipChat({}));
    loadVideos();
  }, [jobId, done, loadVideos]);
  const liveVodId = vodIdOf(job?.url ?? null);
  useEffect(() => {
    if (!liveVodId) return;
    let cancelled = false;
    getStoryboard(liveVodId).then((frames) => !cancelled && setStoryboard(frames)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveVodId]);

  const current = moments[Math.min(selected, moments.length - 1)];
  const vodId = vodIdOf(job?.url ?? null);
  const vodThumb = channel?.vods.find((v) => v.id === vodId)?.thumbnail_url ?? null;
  useBackdrop(current && jobId ? clipThumbUrl(jobId, current.filename, { version: `${current.start}-${current.end}` }) : vodThumb);

  const select = useCallback((index: number) => {
    setInteracted(true);
    setOpenVideo(null);
    setSelected(index);
  }, []);

  // What is on screen: a sequence or a compilation, else the clip selected
  const shownVideo = openVideo ? entries.sequence.concat(entries.compilation, entries.clip).find((entry) => entry.kind === "video" && entry.video.id === openVideo) : undefined;
  const videoEntry = shownVideo?.kind === "video" ? shownVideo : undefined;
  const selectedKey = videoEntry ? videoEntry.key : current ? momentKey(current.filename) : null;
  // What « this live », « this clip », « this video » mean to the assistant
  useAssistantPlace(
    jobId && job
      ? {
          page: job.status === "DONE" ? "live" : "analysis",
          job: jobId,
          title: splitVodTitle(job.custom_title || job.vod_title).title || undefined,
          ...(job.status !== "DONE" ? {} : videoEntry ? { video: { id: videoEntry.video.id, name: videoEntry.video.name, source: sourceOf(videoEntry.video) } } : current ? { clip: { filename: current.filename, name: current.hp.clip_name ?? current.filename } } : {}),
          ...(job.status === "DONE" ? { facts: { clips: moments.length, to_sort: moments.filter((m) => m.state === "todo").length, kept, ideas: VIDEO_SOURCES.reduce((sum, source) => sum + ideasToSee(entries, source), 0) } } : {}),
        }
      : null,
  );
  const selectEntry = useCallback(
    (entry: LiveEntry) => {
      if (entry.kind === "moment") return select(moments.findIndex((m) => m.filename === entry.moment.filename));
      setOpenVideo(entry.video.id);
    },
    [moments, select],
  );
  // A live without clips (they were never cut, or all deleted): its first sequence or compilation is on screen
  useEffect(() => {
    if (moments.length > 0 || openVideo) return;
    const first = [...entries.sequence, ...entries.compilation].find((entry) => entry.kind === "video");
    if (first?.kind === "video") setOpenVideo(first.video.id);
  }, [entries, moments.length, openVideo]);

  /** An idea of the AI is kept by having it built: on to its montage, where it is */
  const keepIdea = useCallback((video: Compilation) => navigate(`/${jobId}/montage?v=${video.id}&build=1`), [jobId, navigate]);
  /** ...or passed on (and taken back): it stays in the list, dimmed */
  const passIdea = useCallback(
    async (video: Compilation) => {
      if (!jobId) return;
      const { passed: was, ...rest } = video;
      setVideoBusy(true);
      try {
        const saved = await saveCompilation(jobId, was ? rest : { ...rest, passed: true });
        setVideos((prev) => prev.map((other) => (other.id === saved.id ? saved : other)));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("brand.saveError"));
      } finally {
        setVideoBusy(false);
      }
    },
    [jobId, t, toast],
  );
  const confirmVideoDelete = async () => {
    const gone = videoToDelete;
    setVideoToDelete(null);
    if (!jobId || !gone) return;
    try {
      await deleteCompilation(jobId, gone.id);
      setVideos((prev) => prev.filter((other) => other.id !== gone.id));
      setOpenVideo(null);
      toast.success(t("compilation.deleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const saveChoice = useCallback(
    async (filename: string, patch: { state?: ClipSelection["state"] | null; trim?: [number, number] | null; segments?: Range[] | null }) => {
      if (!jobId) return;
      // Optimistic, then reconcile with what the server stored
      setJob((prev) => {
        if (!prev) return prev;
        const entry: ClipSelection = { ...(prev.selection[filename] ?? {}) };
        if (patch.state !== undefined) {
          if (patch.state === null) delete entry.state;
          else entry.state = patch.state;
        }
        if (patch.trim !== undefined) {
          if (patch.trim === null) delete entry.trim;
          else entry.trim = patch.trim;
          // One cut: no more pieces
          delete entry.segments;
        }
        if (patch.segments) {
          // Several pieces; the trim spans them
          entry.segments = patch.segments;
          entry.trim = [patch.segments[0][0], patch.segments[patch.segments.length - 1][1]];
        }
        return { ...prev, selection: { ...prev.selection, [filename]: entry } };
      });
      try {
        const selection = await updateSelection(jobId, filename, patch);
        setJob((prev) => (prev ? { ...prev, selection } : prev));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("brand.saveError"));
      }
    },
    [jobId, t, toast],
  );

  const decide = useCallback(
    (state: Exclude<MomentState, "todo">) => {
      if (!current) return;
      setInteracted(true);
      const next = current.state === state ? null : state;
      saveChoice(current.filename, { state: next });
      if (next) {
        // Move on to the next moment still to sort
        const updated = moments.map((m) => (m.filename === current.filename ? { ...m, state: next as MomentState } : m));
        const i = nextTodo(updated, selected);
        if (i !== -1) setSelected(i);
      }
    },
    [current, moments, saveChoice, selected],
  );

  // Keyboard: Space plays, G keeps, X passes, the arrows move through the list
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || moments.length === 0) return;
      const key = e.key.toLowerCase();
      if (e.metaKey || e.ctrlKey) return;
      // The arrows go through the whole list, whatever the section
      const move = (by: 1 | -1) => {
        e.preventDefault();
        const order = shownEntries(entries, openSections, selectedKey);
        const next = order[order.findIndex((entry) => entry.key === selectedKey) + by];
        if (next) selectEntry(next);
      };
      if (key === "arrowdown" || key === "arrowright") return move(1);
      if (key === "arrowup" || key === "arrowleft") return move(-1);
      // A sequence or a compilation on screen: an idea is kept (built) or passed on
      if (videoEntry) {
        if (!videoEntry.idea) return;
        if (key === "g") keepIdea(videoEntry.video);
        else if (key === "x") passIdea(videoEntry.video);
        return;
      }
      if (key === " ") {
        e.preventDefault();
        setInteracted(true);
        playerRef.current?.toggle();
      } else if (key === "g") decide("kept");
      else if (key === "x") decide("passed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, entries, keepIdea, moments.length, openSections, passIdea, selectEntry, selectedKey, videoEntry]);

  const rename = async (name: string) => {
    if (!jobId || !current) return;
    try {
      await renameClip(jobId, current.filename, name);
      setJob((prev) =>
        prev ? { ...prev, hot_points: (prev.hot_points ?? []).map((h) => (h.clip_filename === current.filename ? { ...h, clip_name: name } : h)) } : prev,
      );
      toast.success(t("project.renamed"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };

  const confirmDelete = async () => {
    if (!jobId || !toDelete) return;
    const filename = toDelete;
    setToDelete(null);
    try {
      await deleteClip(jobId, filename);
      setJob((prev) => (prev ? { ...prev, hot_points: (prev.hot_points ?? []).filter((h) => h.clip_filename !== filename) } : prev));
      toast.success(t("hotPoints.clipDeleted"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    }
  };

  if (!job || !jobId) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const processing = job.status !== "DONE" && job.status !== "ERROR";
  // Stopped because the AI provider refuses every call (no credits, refused key)
  const stopped = job.status === "ERROR" ? providerNotice(job.notices) : undefined;
  const categoryLabel = (category: string | undefined) => (category ? t(`categories.${category}`, { defaultValue: category }) : null);
  const freed = !!job.clips_freed_at;
  // What the strip of the live shows besides the clips: each sequence's stretch, the moments of the compilation on screen
  const spans = entries.sequence.flatMap((entry) => (entry.kind === "video" && entry.video.suggestion?.span ? [{ key: entry.key, start: entry.video.suggestion.span[0], end: entry.video.suggestion.span[1], name: entry.video.name, state: entry.state }] : []));
  const ticks = videoEntry && !videoEntry.video.suggestion?.span ? videoMoments(videoEntry.video, 40) : [];
  const shownAt = videoEntry ? (videoEntry.video.suggestion?.span ? (videoEntry.video.suggestion.span[0] + videoEntry.video.suggestion.span[1]) / 2 : (ticks[0] ?? null)) : null;

  return (
    <div className="animate-fade-in">
      <LiveHeader
        job={job}
        step="choose"
        kept={kept}
        processing={processing}
        extra={
          job.vod_context?.summary && (
            <button onClick={() => setContextOpen((o) => !o)} className="btn btn-ghost btn-sm h-7 px-2" aria-expanded={contextOpen}>
              {t("project.liveSummary")}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${contextOpen ? "rotate-180" : ""}`} />
            </button>
          )
        }
      />

      {contextOpen && job.vod_context && (
        <div className="mt-4 glass rounded-[16px] p-5 max-w-[860px] animate-fade-in">
          <p className="text-[14px] leading-relaxed text-ink-2">{job.vod_context.summary}</p>
          {job.vod_context.phases.length > 0 && (
            <ul className="mt-3 space-y-1">
              {job.vod_context.phases.map((p) => (
                <li key={`${p.start}-${p.end}`} className="flex gap-3 text-[12.5px]">
                  <span className="mono text-ink-3 whitespace-nowrap">{p.start} → {p.end}</span>
                  <span className="text-ink-2">{p.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(job.notices ?? []).map((notice) =>
        notice.kind === "transcription" || notice.kind === "live_transcript" || notice.kind === "audio_events" ? (
          <div key={notice.kind} className="mt-4 flex items-start gap-3 p-3.5 pl-4 rounded-[14px] max-w-[860px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)]">
            <AlertTriangle className="w-4 h-4 text-[#F5B14C] flex-none mt-0.5" />
            <p className="text-[12.5px] leading-snug text-[#f7d9a8]">{t(`project.notice.${notice.kind}`, { failed: notice.failed ?? 0, total: notice.total ?? 0 })}</p>
          </div>
        ) : null,
      )}

      {processing && (
        <div className="mt-6">
          <AnalysisView job={job} vodId={vodId} />
        </div>
      )}

      {job.status === "ERROR" && (
        <div className="mt-6 glass rounded-[16px] p-5 flex items-start gap-4">
          <span className="w-10 h-10 rounded-[11px] bg-red-500/10 grid place-items-center flex-none">
            <X className="w-5 h-5 text-red-300" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] text-red-200">{stopped ? t(`job.provider.${stopped.reason}`) : job.error || t("job.errorOccurred")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {stopped && <ProviderFix notice={stopped} />}
              <button
                onClick={async () => {
                  try {
                    await retryJob(jobId);
                    setJob((prev) => (prev ? { ...prev, status: "PENDING", error: null, notices: [] } : prev));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : t("job.retryFailed"));
                  }
                }}
                className="btn btn-glass btn-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" /> {t("job.retry")}
              </button>
            </div>
          </div>
        </div>
      )}

      {freed && (
        <div className="mt-6">
          <FreedNotice job={job} exports={exportCount} onRestored={() => getJobStatus(jobId).then(setJob).catch(() => {})} />
        </div>
      )}

      {!processing && (freed ? videos.length > 0 : moments.length > 0 || videos.length > 0) && (
        <>
          <section className="mt-5">
            <VodTimeline
              vodId={vodId}
              durationSeconds={job.vod_duration_seconds ?? Math.max(1, ...moments.map((m) => m.end))}
              moments={freed ? [] : moments}
              selected={videoEntry ? -1 : selected}
              onSelect={select}
              chat={job.timeline?.chat}
              chatDuration={job.timeline?.duration}
              spans={spans}
              selectedSpan={videoEntry?.key ?? null}
              onSelectSpan={(key) => {
                const entry = entries.sequence.find((one) => one.key === key);
                if (entry) selectEntry(entry);
              }}
              ticks={ticks}
              label={videoEntry && shownAt != null ? { at: shownAt, text: videoEntry.video.name } : null}
            />
          </section>

          <section className="mt-[18px] flex flex-wrap gap-[18px] items-start">
            <div className="flex-[1_1_640px] min-w-0 flex flex-col gap-4">
              {videoEntry ? (
                <VideoDetail
                  jobId={jobId}
                  entry={videoEntry}
                  storyboard={storyboard}
                  busy={videoBusy}
                  onKeep={() => keepIdea(videoEntry.video)}
                  onPass={() => passIdea(videoEntry.video)}
                  onOpen={() => navigate(`/${jobId}/montage?v=${videoEntry.video.id}`)}
                  onRemove={() => setVideoToDelete(videoEntry.video)}
                />
              ) : current && !freed ? (
              <>
              <MomentPlayer
                ref={playerRef}
                jobId={jobId}
                moment={current}
                categoryLabel={categoryLabel(current.hp.llm?.category)}
                autoPlay={interacted}
                chat={clipChat[current.filename]}
                // To watch and decide: its cut is made in the montage, where the tools are
                review
                onPiecesChange={() => {}}
                cutLabel={current.suggested && !current.trimmedByUser ? t("project.cutAdvised") : undefined}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-1.5 pt-3 pb-1.5">
                  {/* Only what the streamer has to know before deciding: this moment is one they already have */}
                  <div className="flex-1 min-w-[120px]">
                    {current.duplicateOf && <span className="text-[12.5px] text-ink-3">{t("project.duplicateHint", { rank: current.duplicateOf.rank })}</span>}
                  </div>
                  {/* Pass and keep stay side by side */}
                  <div className="flex items-center gap-2.5 ml-auto">
                    <button
                      onClick={() => decide("passed")}
                      className={`btn btn-lg pr-3 ${current.state === "passed" ? "bg-white/[0.18] text-white border border-white/20" : "btn-glass"}`}
                    >
                      <X className="w-[15px] h-[15px]" strokeWidth={2.4} />
                      {current.state === "passed" ? t("project.passed") : t("project.pass")}
                      <kbd className="bg-white/[0.08] border-white/10 text-ink-2">X</kbd>
                    </button>
                    <button onClick={() => decide("kept")} className={`btn btn-lg pr-3 ${current.state === "kept" ? "btn-accent" : "btn-primary"}`}>
                      <Check className="w-[15px] h-[15px]" strokeWidth={2.8} />
                      {current.state === "kept" ? t("project.kept") : t("project.keep")}
                      <kbd>G</kbd>
                    </button>
                    {/* Kept: it is a video, its montage a click away */}
                    {current.state === "kept" && (
                      <Link to={`/${jobId}/montage?clip=${encodeURIComponent(current.filename)}`} className="btn btn-lg btn-glass">
                        {t("project.step.edit")} <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.4} />
                      </Link>
                    )}
                  </div>
                </div>
              </MomentPlayer>

              <MomentDetails
                jobId={jobId}
                moment={current}
                onRename={rename}
                onSeek={(s) => {
                  setInteracted(true);
                  playerRef.current?.playFrom(s);
                }}
                onDelete={() => setToDelete(current.filename)}
              />
              </>
              ) : null}
            </div>

            <div className="flex-[0_1_410px] min-w-[300px] lg:sticky lg:top-[96px]">
              <SourceList
                jobId={jobId}
                entries={freed ? { ...entries, clip: entries.clip.filter((entry) => entry.kind === "video") } : entries}
                selected={selectedKey}
                onSelect={selectEntry}
                open={openSections}
                onToggle={(source) => setOpenSections((prev) => ({ ...prev, [source]: !prev[source] }))}
                // A new one starts in its montage, where it is described to the AI or put together by hand
                onAdd={(source) => navigate(`/${jobId}/montage?new=1&kind=${source}`)}
                storyboard={storyboard}
                categoryLabel={categoryLabel}
                clipAction={
                  !freed && (
                    <button onClick={() => setImporting(true)} aria-label={t("importClip.addClip")} title={t("live.importFile")} className="btn btn-ghost btn-icon w-7 h-7 text-ink-3 hover:text-white">
                      <Upload className="w-[15px] h-[15px]" />
                    </button>
                  )
                }
                footer={
                  <div className="mt-2 pt-3 border-t border-white/[0.08] flex items-center justify-between gap-2.5 px-1">
                    <span className="text-[13px] text-ink-2">
                      <span className="mono font-semibold text-white">{kept}</span> {t("live.videosKept", { count: kept })}
                    </span>
                    {kept > 0 ? (
                      <Link to={`/${jobId}/montage`} className="btn btn-primary">
                        {t("project.step.edit")} <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.2} />
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-ink-3">{t("project.keepToContinue")}</span>
                    )}
                  </div>
                }
              />
            </div>
          </section>
        </>
      )}

      <ConfirmModal
        open={!!toDelete}
        title={t("hotPoints.deleteClipTitle")}
        message={t("hotPoints.deleteClipMessage")}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
      <ConfirmModal
        open={!!videoToDelete}
        title={t("compilation.deleteTitle")}
        message={t("compilations.deleteMessage", { name: videoToDelete?.name ?? "" })}
        onConfirm={confirmVideoDelete}
        onCancel={() => setVideoToDelete(null)}
      />
      <ImportClipModal
        jobId={jobId}
        open={importing}
        onClose={() => setImporting(false)}
        onImported={() => {
          setImporting(false);
          getJobStatus(jobId).then(setJob).catch(() => {});
        }}
      />
    </div>
  );
}
