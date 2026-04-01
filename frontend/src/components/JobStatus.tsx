import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { JobStatusType, StepTiming } from "../lib/api";

interface Props {
  status: JobStatusType;
  progress: string;
  stepTimings: Record<string, StepTiming> | null;
  clipsReady: number;
  clipsTotal: number | null;
}

const STATUS_ORDER: JobStatusType[] = [
  "PENDING",
  "DOWNLOADING_AUDIO",
  "DOWNLOADING_CHAT",
  "ANALYZING_AUDIO",
  "ANALYZING_CHAT",
  "SCORING",
  "ANALYZING_CLIPS",
  "CLIPPING",
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

export default function JobStatus({ status, progress, stepTimings, clipsReady, clipsTotal }: Props) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);

  const pct = getProgress(status);
  const currentIdx = STATUS_ORDER.indexOf(status);
  const showClipCount = clipsReady > 0 || (status === "CLIPPING" || status === "LLM_ANALYSIS");

  return (
    <div className="w-full">
      <div className="surface-static rounded-xl p-5">
        <div className="flex items-center gap-4 mb-4">
          {/* Spinner */}
          <div className="relative w-7 h-7 shrink-0">
            <svg className="w-7 h-7 spinner" viewBox="0 0 50 50">
              <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
              <circle cx="25" cy="25" r="20" fill="none" stroke="white" strokeWidth="3" strokeDasharray="80" strokeLinecap="round" opacity="0.5" />
            </svg>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-sm text-white font-medium truncate">{progress}</p>
              {showClipCount && clipsTotal && (
                <span className="text-xs text-zinc-400 font-mono tabular-nums shrink-0 ml-3">
                  {clipsReady}/{clipsTotal} clips
                </span>
              )}
            </div>
            {/* Progress bar */}
            <div className="w-full bg-white/[0.04] rounded-full h-1 overflow-hidden">
              <div
                className="progress-shimmer h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Step pills */}
        <div className="flex flex-wrap gap-1.5">
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
                className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-0.5 rounded-full transition-all ${
                  isCurrent
                    ? "bg-white/[0.1] text-white border border-white/[0.15]"
                    : isCompleted
                      ? "text-zinc-400 bg-white/[0.03]"
                      : "text-zinc-700"
                }`}
              >
                {t(`jobStatus.${step}`)}
                {durationLabel && (
                  <span className={`font-mono tabular-nums ${isCurrent ? "text-zinc-300" : "text-zinc-600"}`}>
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
