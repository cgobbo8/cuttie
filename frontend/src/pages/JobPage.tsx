import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  getJobStatus,
  retryJob,
  deleteClip,
  type JobResponse,
  type JobStatusType,
  type HotPoint,
  type StepTiming,
  mapSSEHotPoint,
} from "../lib/api";
import { useTransmitChannel } from "../lib/TransmitContext";
import JobStatus from "../components/JobStatus";
import HotPoints from "../components/HotPoints";
import { ArrowLeft, RotateCcw, Loader2, X, PackageCheck, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToast } from "../components/Toast";
import { useCreatorWorkspace } from "../lib/CreatorWorkspaceContext";
import BatchExportModal from "../components/BatchExportModal";
import ImportClipModal from "../components/ImportClipModal";
import ConfirmModal from "../components/ConfirmModal";

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
  const [clipToDelete, setClipToDelete] = useState<string | null>(null);

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

  // SSE via Transmit — single tunnel at app level, subscribe to job channel
  useTransmitChannel(jobId ? `jobs/${jobId}` : null, (raw: unknown) => {
    const data = raw as Record<string, any>;

    if (data.type === "clip_ready" && data.hot_point) {
      const hp = mapSSEHotPoint(data.hot_point);
      setClips((prev) => {
        const existing = prev.findIndex(
          (c) =>
            (c.clip_filename && c.clip_filename === hp.clip_filename) ||
            (!c.clip_filename && c.clip_name && c.clip_name === hp.clip_name),
        );
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = hp;
          return next;
        }
        return [hp, ...prev];
      });
      if (hp.clip_filename) {
        setAnimatedClips((prev) => new Set(prev).add(hp.clip_filename!));
      }
      return;
    }

    // Status update
    if (data.status) setStatus(data.status);
    if (data.progress) {
      setProgress(data.progress);
      const match = data.progress.match(/(\d+)\/(\d+)/);
      if (match) setClipsTotal(parseInt(match[2], 10));
    }
    if (data.step_timings) setStepTimings(data.step_timings);
    if (data.vod_title) setVodTitle(data.vod_title);
    if (data.vod_game) setVodGame(data.vod_game);
    if (data.vod_duration_seconds) setVodDuration(data.vod_duration_seconds);
    if (data.streamer) {
      setStreamer(data.streamer);
      selectByStreamer(data.streamer);
    }
    if (data.view_count) setViewCount(data.view_count);
    if (data.stream_date) setStreamDate(data.stream_date);
    if (data.error) setError(data.error);

    if (data.status === "DONE" && data.hot_points?.length) {
      setIsFinalSort(true);
      setClips((prev) => {
        if (prev.length > 0 && prev.some((c) => c.clip_filename)) return prev;
        return data.hot_points.map(mapSSEHotPoint);
      });
    }
  });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    getJobStatus(jobId)
      .then((job) => {
        if (cancelled) return;
        applyJobData(job);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) navigate("/");
      });
    return () => { cancelled = true; };
  }, [jobId, navigate, applyJobData]);

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
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t("job.retryFailed"));
    }
  }, [jobId, t]);

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

  const handleConfirmDeleteClip = useCallback(() => {
    if (!jobId || !clipToDelete) return;
    const filename = clipToDelete;

    // Optimistic: remove from UI + close modal immediately
    let removedClip: HotPoint | undefined;
    let removedIndex = -1;
    setClips((prev) => {
      removedIndex = prev.findIndex((c) => c.clip_filename === filename);
      if (removedIndex >= 0) removedClip = prev[removedIndex];
      return prev.filter((c) => c.clip_filename !== filename);
    });
    setClipToDelete(null);

    // Fire API in background, toast on success, rollback on failure
    deleteClip(jobId, filename).then(() => {
      toast.success(t("hotPoints.clipDeleted"));
    }).catch((e: unknown) => {
      if (removedClip) {
        setClips((prev) => {
          const next = [...prev];
          next.splice(removedIndex, 0, removedClip!);
          return next;
        });
      }
      toast.error(e instanceof Error ? e.message : t("common.error"));
    });
  }, [jobId, clipToDelete, t]);

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
          onDeleteClip={(filename) => setClipToDelete(filename)}
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

      {/* Delete clip confirmation */}
      <ConfirmModal
        open={!!clipToDelete}
        title={t("hotPoints.deleteClipTitle")}
        message={t("hotPoints.deleteClipMessage")}
        onConfirm={handleConfirmDeleteClip}
        onCancel={() => setClipToDelete(null)}
      />

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
