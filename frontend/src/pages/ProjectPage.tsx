import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, RotateCcw, Sparkles, Upload, X } from "lucide-react";
import {
  clipThumbUrl,
  deleteClip,
  getJobChat,
  getJobStatus,
  mapSSEHotPoint,
  renameClip,
  retryJob,
  updateSelection,
  type ClipChatLine,
  type ClipSelection,
  type JobResponse,
  type TimelineCandidate,
} from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { useTransmitChannel } from "../lib/TransmitContext";
import { buildMoments, countStates, nextTodo, type MomentState } from "../lib/moments";
import { hoursMinutes, shortDate, splitVodTitle } from "../lib/format";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";
import ProviderFix, { providerNotice } from "../components/ProviderFix";
import ImportClipModal from "../components/ImportClipModal";
import AnalysisView from "../components/project/AnalysisView";
import Stepper from "../components/project/Stepper";
import VodTimeline from "../components/project/VodTimeline";
import MomentPlayer, { type MomentPlayerHandle } from "../components/project/MomentPlayer";
import MomentDetails from "../components/project/MomentDetails";
import MomentList from "../components/project/MomentList";

function vodIdOf(url: string | null): string | null {
  return url?.match(/videos\/(\d+)/)?.[1] ?? null;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

export default function ProjectPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { jobId } = useParams<{ jobId: string }>();
  const { channel } = useChannel();

  const [job, setJob] = useState<JobResponse | null>(null);
  const [selected, setSelected] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const playerRef = useRef<MomentPlayerHandle>(null);

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
  const counts = countStates(moments);

  // Open on the first moment still to sort
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!jobId || moments.length === 0 || openedFor.current === jobId) return;
    openedFor.current = jobId;
    const first = moments.findIndex((m) => m.state === "todo");
    setSelected(first === -1 ? 0 : first);
  }, [jobId, moments]);

  // When the chat spoke in each clip, for the trim strip (once the clips exist)
  const [clipChat, setClipChat] = useState<Record<string, ClipChatLine[]>>({});
  const done = job?.status === "DONE";
  useEffect(() => {
    if (!jobId || !done) return;
    getJobChat(jobId).then(setClipChat).catch(() => setClipChat({}));
  }, [jobId, done]);

  const current = moments[Math.min(selected, moments.length - 1)];
  const trimmedByUser = !!current?.suggested && !!current?.trimmedByUser;
  const hasChat = !!current && (clipChat[current.filename]?.length ?? 0) > 0;
  const vodId = vodIdOf(job?.url ?? null);
  const vodThumb = channel?.vods.find((v) => v.id === vodId)?.thumbnail_url ?? null;
  useBackdrop(current && jobId ? clipThumbUrl(jobId, current.filename) : vodThumb);

  const select = useCallback((index: number) => {
    setInteracted(true);
    setSelected(index);
  }, []);

  const saveChoice = useCallback(
    async (filename: string, patch: { state?: ClipSelection["state"] | null; trim?: [number, number] | null }) => {
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

  // Keyboard: Space play, G keep, X pass, arrows to move
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || moments.length === 0) return;
      const key = e.key.toLowerCase();
      if (key === " ") {
        e.preventDefault();
        setInteracted(true);
        playerRef.current?.toggle();
      } else if (key === "g") decide("kept");
      else if (key === "x") decide("passed");
      else if (key === "arrowdown" || key === "arrowright") {
        e.preventDefault();
        select(Math.min(moments.length - 1, selected + 1));
      } else if (key === "arrowup" || key === "arrowleft") {
        e.preventDefault();
        select(Math.max(0, selected - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, moments.length, select, selected]);

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

  const { tag, title } = splitVodTitle(job.custom_title || job.vod_title);
  const processing = job.status !== "DONE" && job.status !== "ERROR";
  // Stopped because the AI provider refuses every call (no credits, refused key)
  const stopped = job.status === "ERROR" ? providerNotice(job.notices) : undefined;
  const categoryLabel = (category: string | undefined) => (category ? t(`categories.${category}`, { defaultValue: category }) : null);
  const stepLinks = { analyze: `/${jobId}`, choose: `/${jobId}`, edit: `/${jobId}/montage`, export: `/${jobId}/montage` };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <Link to="/" className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {t("sidebar.home")}
          </Link>
          <div className="mt-2 flex items-center gap-2.5 flex-wrap">
            <h1 className="text-[32px] leading-[1.1] tracking-[-0.03em] font-[650] text-white">{title}</h1>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-2">
            {job.stream_date && <span>{shortDate(job.stream_date, i18n.language)}</span>}
            {job.vod_duration_seconds ? (
              <>
                <span aria-hidden className="opacity-50">·</span>
                <span className="tabular-nums">{hoursMinutes(job.vod_duration_seconds)}</span>
              </>
            ) : null}
            {job.vod_game && (
              <>
                <span aria-hidden className="opacity-50">·</span>
                <span>{job.vod_game}</span>
              </>
            )}
            {tag && <span className="chip chip-neutral h-[22px] font-[550]">{tag}</span>}
            {job.vod_context?.summary && (
              <button onClick={() => setContextOpen((o) => !o)} className="btn btn-ghost btn-sm h-7 px-2" aria-expanded={contextOpen}>
                {t("project.liveSummary")}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${contextOpen ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>
        </div>
        <Stepper
          current={processing ? "analyze" : "choose"}
          links={stepLinks}
          locked={processing ? ["choose", "edit", "export"] : counts.kept === 0 ? ["edit", "export"] : []}
          detail={processing ? undefined : t("project.keptCount", { count: counts.kept })}
        />
      </header>

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
        notice.kind === "transcription" || notice.kind === "live_transcript" ? (
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

      {!processing && moments.length > 0 && current && (
        <>
          <section className="mt-5">
            <VodTimeline
              vodId={vodId}
              durationSeconds={job.vod_duration_seconds ?? Math.max(...moments.map((m) => m.end))}
              moments={moments}
              selected={selected}
              onSelect={select}
              chat={job.timeline?.chat}
              chatDuration={job.timeline?.duration}
            />
          </section>

          <section className="mt-[18px] flex flex-wrap gap-[18px] items-start">
            <div className="flex-[1_1_680px] min-w-0 flex flex-col gap-4">
              <MomentPlayer
                ref={playerRef}
                jobId={jobId}
                moment={current}
                categoryLabel={categoryLabel(current.hp.llm?.category)}
                autoPlay={interacted}
                chat={clipChat[current.filename]}
                onTrimChange={(trim) => saveChoice(current.filename, { trim })}
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-1.5 pt-3 pb-1.5">
                  {/* The hint, and the way back to the AI's cut under it */}
                  <div className="flex-1 min-w-[220px] flex flex-col items-start gap-1">
                    <span className="text-[12.5px] text-ink-3">
                      {current.duplicateOf
                        ? t("project.duplicateHint", { rank: current.duplicateOf.rank })
                        : current.suggested && !current.trimmedByUser
                          ? t("project.suggestedTrimHint", { seconds: Math.round(current.suggested[1] - current.suggested[0]) })
                          : t("project.trimHint")}
                    </span>
                    {(trimmedByUser || hasChat) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {trimmedByUser && (
                          <button onClick={() => saveChoice(current.filename, { trim: null })} className="btn btn-ghost btn-sm h-7 px-2 -ml-2">
                            <Sparkles className="w-3.5 h-3.5" /> {t("project.backToSuggestedTrim")}
                          </button>
                        )}
                        {hasChat && (
                          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-white/90" /> {t("project.chatDots")}
                          </span>
                        )}
                      </div>
                    )}
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
            </div>

            <div className="flex-[0_1_400px] min-w-0 lg:sticky lg:top-[96px]">
              <MomentList
                jobId={jobId}
                moments={moments}
                selected={selected}
                onSelect={select}
                categoryLabel={categoryLabel}
                footer={
                  <div className="mt-3 pt-3.5 border-t border-white/[0.08] flex flex-col gap-3">
                    <button onClick={() => setImporting(true)} className="btn btn-ghost btn-sm self-start">
                      <Upload className="w-[15px] h-[15px]" /> {t("importClip.addClip")}
                    </button>
                    <div className="flex items-center justify-between gap-2.5">
                      <span className="text-[13px] text-ink-2">
                        <span className="mono font-semibold text-white">{counts.kept}</span> {t("project.clipsKept", { count: counts.kept })}
                      </span>
                      {counts.kept > 0 ? (
                        <Link to={`/${jobId}/montage`} className="btn btn-primary">
                          {t("project.toEdit")} <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.2} />
                        </Link>
                      ) : (
                        <span className="text-[12.5px] text-ink-3">{t("project.keepToContinue")}</span>
                      )}
                    </div>
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
