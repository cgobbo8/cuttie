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
import { ArrowLeft, RotateCcw, Loader2, X } from "lucide-react";

export default function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);

  // Job metadata
  const [status, setStatus] = useState<JobStatusType>("PENDING");
  const [progress, setProgress] = useState("Demarrage...");
  const [stepTimings, setStepTimings] = useState<Record<string, StepTiming> | null>(null);
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

  const sseCleanupRef = useRef<(() => void) | null>(null);

  const applyJobData = useCallback((job: JobResponse) => {
    setStatus(job.status);
    setProgress(job.progress || "");
    if (job.step_timings) setStepTimings(job.step_timings);
    if (job.vod_title) setVodTitle(job.vod_title);
    if (job.vod_game) setVodGame(job.vod_game);
    if (job.vod_duration_seconds) setVodDuration(job.vod_duration_seconds);
    if (job.streamer) setStreamer(job.streamer);
    if (job.view_count) setViewCount(job.view_count);
    if (job.stream_date) setStreamDate(job.stream_date);
    if (job.error) setError(job.error);
    if (job.hot_points?.length) {
      setClips(job.hot_points);
    }
  }, []);

  const parseClipsTotal = useCallback((prog: string) => {
    const match = prog.match(/(\d+)\/(\d+)/);
    if (match) return parseInt(match[2], 10);
    return null;
  }, []);

  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if ("type" in event && event.type === "clip_ready") {
      setClips((prev) => {
        const existing = prev.findIndex(
          (c) => c.clip_filename === event.hot_point.clip_filename,
        );
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = event.hot_point;
          return next;
        }
        return [...prev, event.hot_point];
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
    if (update.streamer) setStreamer(update.streamer);
    if (update.view_count) setViewCount(update.view_count);
    if (update.stream_date) setStreamDate(update.stream_date);
    if (update.error) setError(update.error);

    if (update.status === "DONE" && update.hot_points?.length) {
      setIsFinalSort(true);
      setTimeout(() => setClips(update.hot_points!), 300);
    }
  }, [parseClipsTotal]);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    getJobStatus(jobId)
      .then((job) => {
        if (cancelled) return;
        applyJobData(job);
        setLoading(false);
        if (job.status !== "DONE" && job.status !== "ERROR") {
          const cleanup = subscribeJobSSE(jobId, handleSSEEvent);
          sseCleanupRef.current = cleanup;
        }
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
      setProgress("Demarrage...");
      setError(null);
      setIsFinalSort(false);
      setAnimatedClips(new Set());
      const cleanup = subscribeJobSSE(jobId, handleSSEEvent);
      sseCleanupRef.current = cleanup;
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Retry failed");
    }
  }, [jobId, handleSSEEvent]);

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
      {/* Back link */}
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Projets
      </Link>

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
                {error || "Une erreur est survenue"}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reprendre
                </button>
                <Link
                  to="/"
                  className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Retour
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      {clipsWithFiles.length > 0 && (
        <HotPoints
          hotPoints={clipsWithFiles}
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
        />
      )}
    </div>
  );
}
