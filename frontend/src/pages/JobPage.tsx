import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { getJobStatus, retryJob, type JobResponse } from "../lib/api";
import JobStatus from "../components/JobStatus";
import HotPoints from "../components/HotPoints";

export default function JobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Initial fetch to determine current state
  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId)
      .then(setJob)
      .catch(() => navigate("/"))
      .finally(() => setLoading(false));
  }, [jobId, navigate]);

  const handleComplete = useCallback((completed: JobResponse) => {
    setJob(completed);
  }, []);

  const handleRetry = useCallback(async () => {
    if (!jobId) return;
    try {
      await retryJob(jobId);
      setJob(null);
      setLoading(true);
      const fresh = await getJobStatus(jobId);
      setJob(fresh);
      setLoading(false);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Retry failed");
    }
  }, [jobId]);

  if (loading || !job) {
    return (
      <div className="flex justify-center py-20">
        <svg className="w-8 h-8 spinner text-purple-400" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" opacity="0.3" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  const isProcessing = job.status !== "DONE" && job.status !== "ERROR";

  // Processing
  if (isProcessing) {
    return <JobStatus jobId={jobId!} onComplete={handleComplete} />;
  }

  // Error
  if (job.status === "ERROR") {
    return (
      <div className="text-center max-w-md mx-auto">
        <div className="glass rounded-2xl p-8">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-red-400 mb-6">{job.error || "Une erreur est survenue"}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={handleRetry}
              className="px-5 py-2.5 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-xl transition-colors border border-purple-500/20"
            >
              Reprendre
            </button>
            <Link
              to="/"
              className="px-5 py-2.5 glass rounded-xl text-zinc-400 hover:text-white transition-colors"
            >
              Nouvelle analyse
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Done — show results
  return (
    <>
      {job.hot_points && (
        <HotPoints
          hotPoints={job.hot_points}
          vodTitle={job.vod_title || "VOD"}
          vodGame={job.vod_game || ""}
          vodDuration={job.vod_duration_seconds || 0}
          jobId={job.job_id}
          streamer={job.streamer || ""}
          viewCount={job.view_count || 0}
          streamDate={job.stream_date || ""}
        />
      )}
    </>
  );
}
