import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  getJobStatus,
  retryJob,
  subscribeJobSSE,
  type JobResponse,
  type JobStatusType,
  type HotPoint,
  type StepTiming,
  type SSEEvent,
} from "../lib/api";
import JobStatus from "../components/JobStatus";
import HotPoints from "../components/HotPoints";
import { ArrowLeft, RotateCcw, Loader2, X, PackageCheck, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../components/Toast";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import BatchExportModal from "../components/BatchExportModal";
import ImportClipModal from "../components/ImportClipModal";

export default function JobPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { selectByStreamer } = useCreatorWorkspace();

  const [loading, setLoading] = useState(true);

  // Job metadata
  const [status, setStatus] = useState<JobStatusType>("PENDING");
  const [progress, setProgress] = useState(t("job.starting"));
  const [stepTimings, setStepTimings] = useState<Record<string, StepTiming> | null>(null);
  const [vodUrl, setVodUrl] = useState("");
  const [vodTitle, setVodTitle] = useState("");
  const [vodGame, setVodGame] = useState("");
  const [vodDuration, setVodDuration] = useState(0);
  const [streamer, setStreamer] = useState("");
  const [viewCount, setViewCount] = useState(0);
  const [streamDate, setStreamDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Clips: accumulate as they arrive
  const [clips, setClips] = useState<HotPoint[]>([]);
  const [clipsTotal, setClipsTotal] = useState<number | null>(null);
  const [animatedClips, setAnimatedClips] = useState<Set<string>>(new Set());
  const [isFinalSort, setIsFinalSort] = useState(false);

  // Batch export selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [quickExportClip, setQuickExportClip] = useState<string | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  const sseCleanupRef = useRef<(() => void) | null>(null);

  const applyJobData = useCallback((job: JobResponse) => {
    setStatus(job.status);
    setProgress(job.progress || "");
    if (job.step_timings) setStepTimings(job.step_timings);
    if (job.url) setVodUrl(job.url);
    if (job.vod_title) setVodTitle(job.vod_title);
    if (job.vod_game) setVodGame(job.vod_game);
    if (job.vod_duration_seconds) setVodDuration(job.vod_duration_seconds);
    if (job.streamer) {
      setStreamer(job.streamer);
      selectByStreamer(job.streamer);
    }
    if (job.view_count) setViewCount(job.view_count);
    if (job.stream_date) setStreamDate(job.stream_date);
    if (job.error) setError(job.error);
    if (job.hot_points?.length) {
      setClips(job.hot_points);
    }
  }, [selectByStreamer]);

  const parseClipsTotal = useCallback((prog: string) => {
    const match = prog.match(/(\d+)\/(\d+)/);
    if (match) return parseInt(match[2], 10);
    return null;
  }, []);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if ("type" in event && event.type === "clip_ready") {
      setClips((prev) => {
        // Match by clip_filename OR by clip_name (for placeholders that don't have a filename yet)
        const existing = prev.findIndex(
          (c) =>
            (c.clip_filename && c.clip_filename === event.hot_point.clip_filename) ||
            (!c.clip_filename && c.clip_name && c.clip_name === event.hot_point.clip_name),
        );
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = event.hot_point;
          return next;
        }
        return [event.hot_point, ...prev];
      });
      const clipKey = event.hot_point.clip_filename || `rank-${event.rank}`;
      setAnimatedClips((prev) => new Set(prev).add(clipKey));
      return;
    }

    const update = event as Exclude<SSEEvent, { type: "clip_ready" }>;
    if (update.status) setStatus(update.status);
    if (update.progress) {
      setProgress(update.progress);
      const total = parseClipsTotal(update.progress);
      if (total) setClipsTotal(total);
    }
    if (update.step_timings) setStepTimings(update.step_timings);
    if (update.vod_title) setVodTitle(update.vod_title);
    if (update.vod_game) setVodGame(update.vod_game);
    if (update.vod_duration_seconds) setVodDuration(update.vod_duration_seconds);
    if (update.streamer) {
      setStreamer(update.streamer);
      selectByStreamer(update.streamer);
    }
    if (update.view_count) setViewCount(update.view_count);
    if (update.stream_date) setStreamDate(update.stream_date);
    if (update.error) setError(update.error);

    if (update.status === "DONE" && update.hot_points?.length) {
      setIsFinalSort(true);
      // Only replace clips if we're transitioning TO done (not on initial SSE state for already-done jobs)
      setClips((prev) => {
        // If clips are already loaded and include real files, don't overwrite (avoids killing placeholders)
        if (prev.length > 0 && prev.some((c) => c.clip_filename)) return prev;
        return update.hot_points!;
      });
    }
  }, [parseClipsTotal, selectByStreamer]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    getJobStatus(jobId)
      .then((job) => {
        if (cancelled) return;
        applyJobData(job);
        setLoading(false);
        // Always connect SSE — even for DONE jobs, clip imports can emit clip_ready events
        const cleanup = subscribeJobSSE(jobId, handleSSEEvent);
        sseCleanupRef.current = cleanup;
      })
      .catch(() => {
        if (!cancelled) navigate("/");
      });

    return () => {
      cancelled = true;
      sseCleanupRef.current?.();
    };
  }, [jobId, navigate, applyJobData, handleSSEEvent]);

  useEffect(() => {
    if (status === "DONE" || status === "ERROR") {
      sseCleanupRef.current?.();
      sseCleanupRef.current = null;
    }
  }, [status]);

  const handleRetry = useCallback(async () => {
    if (!jobId) return;
    try {
      await retryJob(jobId);
      setClips([]);
      setStatus("PENDING");
      setProgress(t("job.starting"));
      setError(null);
      setIsFinalSort(false);
      setAnimatedClips(new Set());
      const cleanup = subscribeJobSSE(jobId, handleSSEEvent);
      sseCleanupRef.current = cleanup;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("job.retryFailed"));
    }
  }, [jobId, handleSSEEvent, t]);

  const clipsWithFilesForSelection = clips.filter((c) => c.clip_filename);

  const handleStartSelection = useCallback(() => {
    setSelectionMode(true);
    setSelectedClips(new Set(clipsWithFilesForSelection.map((c) => c.clip_filename!)));
  }, [clipsWithFilesForSelection]);

  const handleToggleClip = useCallback((filename: string) => {
    setSelectedClips((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedClips(new Set(clipsWithFilesForSelection.map((c) => c.clip_filename!)));
  }, [clipsWithFilesForSelection]);

  const handleDeselectAll = useCallback(() => {
    setSelectedClips(new Set());
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedClips(new Set());
  }, []);

  const handleBatchExportDone = useCallback(() => {
    setShowBatchModal(false);
    setSelectionMode(false);
    setSelectedClips(new Set());
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
      </div>
    );
  }

  const isProcessing = status !== "DONE" && status !== "ERROR";
  const clipsWithFiles = clips.filter((c) => c.clip_filename);

  return (
    <div className="animate-fade-in">
      {/* Back link + batch export button */}
      <div className="flex items-center justify-between mb-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("job.backToProjects")}
        </Link>
        {status === "DONE" && !selectionMode && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              {t("importClip.addClip")}
            </button>
            {clipsWithFilesForSelection.length > 0 && (
              <button
                onClick={handleStartSelection}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
              >
                <PackageCheck className="w-4 h-4" />
                {t("batchExport.exportClips")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Progress bar while processing */}
      {isProcessing && (
        <div className="mb-6">
          <JobStatus
            status={status}
            progress={progress}
            stepTimings={stepTimings}
            clipsReady={clipsWithFiles.length}
            clipsTotal={clipsTotal}
          />
        </div>
      )}

      {/* Error state */}
      {status === "ERROR" && (
        <div className="surface-static rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
              <X className="w-5 h-5 text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-400 mb-4">
                {error || t("job.errorOccurred")}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t("job.retry")}
                </button>
                <Link
                  to="/"
                  className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {t("job.back")}
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {clips.length > 0 && (
        <HotPoints
          hotPoints={clips}
          vodUrl={vodUrl}
          vodTitle={vodTitle || "VOD"}
          vodGame={vodGame}
          vodDuration={vodDuration}
          jobId={jobId!}
          streamer={streamer}
          viewCount={viewCount}
          streamDate={streamDate}
          isStreaming={isProcessing}
          animatedClips={animatedClips}
          isFinalSort={isFinalSort}
          selectionMode={selectionMode}
          selectedClips={selectedClips}
          onToggleClip={handleToggleClip}
          onQuickExport={(filename) => setQuickExportClip(filename)}
        />
      )}

      {/* Selection mode sticky bar */}
      {selectionMode && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-zinc-900/95 backdrop-blur-sm border-t border-white/[0.08] px-6 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <span className="text-sm text-zinc-300">
              {t("batchExport.clipsSelected", { count: selectedClips.size })}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={selectedClips.size === clipsWithFilesForSelection.length ? handleDeselectAll : handleSelectAll}
                className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {selectedClips.size === clipsWithFilesForSelection.length
                  ? t("batchExport.deselectAll")
                  : t("batchExport.selectAll")}
              </button>
              <button
                onClick={handleCancelSelection}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                {t("batchExport.cancel")}
              </button>
              <button
                onClick={() => setShowBatchModal(true)}
                disabled={selectedClips.size === 0}
                className="px-5 py-2 text-sm font-medium text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {t("batchExport.next")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch export modal */}
      {showBatchModal && (
        <BatchExportModal
          jobId={jobId!}
          clipFilenames={Array.from(selectedClips)}
          onClose={() => setShowBatchModal(false)}
          onDone={handleBatchExportDone}
        />
      )}

      {/* Quick export modal (single clip) */}
      {quickExportClip && (
        <BatchExportModal
          jobId={jobId!}
          clipFilenames={[quickExportClip]}
          onClose={() => setQuickExportClip(null)}
          onDone={() => { setQuickExportClip(null); }}
        />
      )}

      {/* Import clip modal */}
      <ImportClipModal
        jobId={jobId!}
        open={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={(_clipFilename, clipName) => {
          // Add a placeholder clip — will be replaced by the real one via SSE clip_ready
          setClips((prev) => [{
            timestamp_seconds: 0,
            timestamp_display: "",
            score: 0,
            final_score: null,
            signals: { rms: 0, spectral_flux: 0, pitch_variance: 0, spectral_centroid: 0, zcr: 0, chat_speed: 0 },
            clip_filename: null,
            vertical_filename: null,
            clip_name: clipName,
            clip_source: "manual",
            llm: null,
            chat_mood: null,
            chat_message_count: null,
          }, ...prev]);
        }}
      />
    </div>
  );
}
