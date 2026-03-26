import { useState, useEffect, useCallback } from "react";
import { getJobStatus, type JobResponse, type JobStatusType } from "../lib/api";

interface Props {
  jobId: string;
  onComplete: (job: JobResponse) => void;
}

const STATUS_LABELS: Record<JobStatusType, string> = {
  PENDING: "En attente...",
  DOWNLOADING_AUDIO: "Telechargement audio",
  DOWNLOADING_CHAT: "Telechargement chat",
  ANALYZING_AUDIO: "Analyse audio",
  ANALYZING_CHAT: "Analyse du chat",
  SCORING: "Calcul des scores",
  TRIAGE: "Pre-analyse LLM",
  CLIPPING: "Extraction des clips",
  TRANSCRIBING: "Transcription",
  LLM_ANALYSIS: "Analyse IA",
  DONE: "Termine !",
  ERROR: "Erreur",
};

const STATUS_ORDER: JobStatusType[] = [
  "PENDING",
  "DOWNLOADING_AUDIO",
  "DOWNLOADING_CHAT",
  "ANALYZING_AUDIO",
  "ANALYZING_CHAT",
  "SCORING",
  "TRIAGE",
  "CLIPPING",
  "TRANSCRIBING",
  "LLM_ANALYSIS",
  "DONE",
];

function getProgress(status: JobStatusType): number {
  const idx = STATUS_ORDER.indexOf(status);
  if (idx < 0) return 0;
  return Math.round((idx / (STATUS_ORDER.length - 1)) * 100);
}

export default function JobStatus({ jobId, onComplete }: Props) {
  const [status, setStatus] = useState<JobStatusType>("PENDING");
  const [progress, setProgress] = useState("Demarrage...");

  const poll = useCallback(async () => {
    try {
      const job = await getJobStatus(jobId);
      setStatus(job.status);
      setProgress(job.progress || STATUS_LABELS[job.status]);
      if (job.status === "DONE" || job.status === "ERROR") {
        onComplete(job);
        return true;
      }
    } catch {
      // keep polling
    }
    return false;
  }, [jobId, onComplete]);

  useEffect(() => {
    let active = true;
    const interval = setInterval(async () => {
      if (!active) return;
      const done = await poll();
      if (done) clearInterval(interval);
    }, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [poll]);

  const pct = getProgress(status);
  const currentIdx = STATUS_ORDER.indexOf(status);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="glass rounded-2xl p-8 text-center">
        {/* Animated spinner */}
        <div className="relative w-16 h-16 mx-auto mb-6">
          <svg className="w-16 h-16 spinner" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(168,85,247,0.15)" strokeWidth="3" />
            <circle cx="25" cy="25" r="20" fill="none" stroke="url(#grad)" strokeWidth="3" strokeDasharray="80" strokeLinecap="round" />
            <defs>
              <linearGradient id="grad">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        <p className="text-lg text-white font-medium mb-1">{progress}</p>
        <p className="text-sm text-zinc-500 mb-8">{STATUS_LABELS[status]}</p>

        {/* Progress bar */}
        <div className="w-full bg-white/[0.04] rounded-full h-1.5 overflow-hidden mb-6">
          <div
            className="progress-shimmer h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Step pills */}
        <div className="flex flex-wrap justify-center gap-2">
          {STATUS_ORDER.slice(1, -1).map((step, i) => {
            const isActive = currentIdx > i;
            const isCurrent = currentIdx === i + 1;
            return (
              <span
                key={step}
                className={`text-xs px-3 py-1 rounded-full transition-all ${
                  isCurrent
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : isActive
                      ? "text-zinc-400 bg-white/[0.03]"
                      : "text-zinc-700"
                }`}
              >
                {STATUS_LABELS[step]}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
