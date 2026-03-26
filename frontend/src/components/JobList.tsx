import { useState, useEffect } from "react";
import { listJobs, type JobSummary } from "../lib/api";

interface Props {
  onSelect: (jobId: string) => void;
  onRetry: (jobId: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;
}

export default function JobList({ onSelect, onRetry }: Props) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listJobs()
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p className="text-zinc-600 text-center text-sm">Chargement...</p>;
  }

  if (jobs.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-semibold text-zinc-600 uppercase tracking-widest mb-4 px-1">
        Analyses precedentes
      </h3>
      <div className="space-y-2">
        {jobs.map((job) => (
          <div
            key={job.job_id}
            onClick={() => onSelect(job.job_id)}
            role="button"
            className="w-full text-left p-4 rounded-xl glass ambient-glow transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-200 truncate group-hover:text-white transition-colors">
                  {job.vod_title || "VOD sans titre"}
                </p>
                <p className="text-xs text-zinc-600 mt-1 flex items-center gap-2">
                  <span>{formatDate(job.created_at)}</span>
                  {job.vod_duration_seconds && (
                    <span className="text-zinc-700">{formatDuration(job.vod_duration_seconds)}</span>
                  )}
                </p>
              </div>
              {job.status === "ERROR" ? (
                <button
                  className="text-xs px-3 py-1.5 text-orange-400 hover:text-orange-300 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(job.job_id);
                  }}
                >
                  Reprendre
                </button>
              ) : (
                <span
                  className={`text-xs px-3 py-1.5 rounded-lg ${
                    job.status === "DONE"
                      ? "text-emerald-400 bg-emerald-500/10"
                      : "text-yellow-400 bg-yellow-500/10"
                  }`}
                >
                  {job.status === "DONE" ? "Voir" : "En cours..."}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
