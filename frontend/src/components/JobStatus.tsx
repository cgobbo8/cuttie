import { useState, useEffect, useCallback } from "react";
import { getJobStatus, type JobResponse, type JobStatusType, type StepTiming } from "../lib/api";

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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function JobStatus({ jobId, onComplete }: Props) {
  const [status, setStatus] = useState<JobStatusType>("PENDING");
  const [progress, setProgress] = useState("Demarrage...");
  const [stepTimings, setStepTimings] = useState<Record<string, StepTiming> | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

  const poll = useCallback(async () => {
    try {
      const job = await getJobStatus(jobId);
      setStatus(job.status);
      setProgress(job.progress || STATUS_LABELS[job.status]);
      if (job.step_timings) setStepTimings(job.step_timings);
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

  // Live clock for current-step elapsed time
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

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
            const isCompleted = currentIdx > i + 1;
            const isCurrent = currentIdx === i + 1;
            const timing = stepTimings?.[step];

            let durationLabel: string | null = null;
            if (timing?.duration_seconds != null) {
              durationLabel = formatDuration(timing.duration_seconds);
            } else if (isCurrent && timing?.start != null) {
              durationLabel = formatDuration(Math.max(0, now - timing.start));
            }

            return (
              <span
                key={step}
                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-all ${
                  isCurrent
                    ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                    : isCompleted
                      ? "text-zinc-400 bg-white/[0.03]"
                      : "text-zinc-700"
                }`}
              >
                {STATUS_LABELS[step]}
                {durationLabel && (
                  <span className={`font-mono tabular-nums ${isCurrent ? "text-purple-400" : "text-zinc-600"}`}>
                    {durationLabel}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
