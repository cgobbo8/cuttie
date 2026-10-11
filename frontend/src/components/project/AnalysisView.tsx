import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Check, Clock3, Scissors, Sparkles } from "lucide-react";
import { getStoryboard, type JobResponse, type TimelineCandidate, type TwitchStoryboard } from "../../lib/api";
import { analysisProgress, clock, timeLeft } from "../../lib/format";
import { evenFrames, frameAt, tileStyle } from "../../lib/storyboard";
import { stackLabels } from "../../lib/labels";
import { useFlip } from "../../lib/useFlip";

/** How many moments the analysis keeps in the end */
const KEEP = 20;

interface Props {
  job: JobResponse;
  vodId: string | null;
}

type Step = { key: string; statuses: string[] };
const STEPS: Step[] = [
  { key: "download", statuses: ["PENDING", "DOWNLOADING_AUDIO", "DOWNLOADING_CHAT"] },
  { key: "listen", statuses: ["ANALYZING_AUDIO"] },
  { key: "spot", statuses: ["ANALYZING_CHAT", "SCORING"] },
  { key: "watch", statuses: ["ANALYZING_CLIPS", "LLM_ANALYSIS"] },
  { key: "cut", statuses: ["CLIPPING"] },
];

function stepIndexOf(status: string): number {
  const i = STEPS.findIndex((s) => s.statuses.includes(status));
  return i === -1 ? 0 : i;
}

/** "Analyse IA : 31 sur 50 candidats" / "Extraction clips (16/20)" -> [31, 50] */
function counter(progress: string | null): [number, number] | null {
  const m = /(\d+)\s*(?:\/|sur)\s*(\d+)/.exec(progress ?? "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function areaPath(values: number[], width: number, top: number, base: number): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(base - (base - top) * v).toFixed(1)}`);
  const line = `M${pts.join(" ")}`;
  return { line, area: `${line} ${width},${base} 0,${base}Z` };
}

/** A frame of the live at time t, from Twitch's seek previews */
function LiveFrame({ storyboard, t, className = "" }: { storyboard: TwitchStoryboard | null; t: number; className?: string }) {
  return storyboard ? (
    <div className={`bg-white/5 ${className}`} style={tileStyle(storyboard, frameAt(storyboard, t))} />
  ) : (
    <div className={`skeleton ${className}`} />
  );
}

/**
 * The analysis as it happens: the live's intensity, the passages Cuttie
 * spotted, and each one as the AI rates it, with the best ones so far.
 */
export default function AnalysisView({ job, vodId }: Props) {
  const { t } = useTranslation();
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!vodId) return;
    getStoryboard(vodId).then(setStoryboard).catch(() => setStoryboard(null));
  }, [vodId]);
  // Running step's elapsed time
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(id);
  }, []);
  // The curve's width, to keep the passages' labels apart
  const stage = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(800);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const timeline = job.timeline ?? {};
  const duration = timeline.duration ?? job.vod_duration_seconds ?? 0;
  const candidates = timeline.candidates ?? [];
  const rated = candidates.filter((c) => c.state === "rated" || c.state === "kept" || c.state === "dropped");
  const clips = candidates.filter((c) => c.state === "clip");

  // Best ones so far: what would be kept if the analysis stopped now
  const leaders = useMemo(() => {
    const scored = candidates.filter((c) => c.score !== undefined && c.state !== "dropped" && c.state !== "clip");
    return [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, KEEP);
  }, [candidates]);
  const leaderSet = new Set(leaders.map((c) => c.t));

  // A batch of passages showing up pops in left to right; a single one, right away
  const seen = useRef(new Map<number, { at: number; delay: number }>());
  const nowMs = performance.now();
  const fresh = candidates.filter((c) => !seen.current.has(c.t));
  for (const c of fresh) {
    seen.current.set(c.t, { at: nowMs, delay: fresh.length >= 5 ? Math.round((c.t / Math.max(duration, 1)) * 500) : 0 });
  }
  const popDelay = (c: TimelineCandidate) => {
    const s = seen.current.get(c.t);
    return s && nowMs - s.at < 2000 ? s.delay : 0;
  };
  // Finds that move up or down the list glide there
  const finds = useRef<HTMLElement>(null);
  useFlip(finds);

  const stepIndex = stepIndexOf(job.status);
  const count = counter(job.progress);
  const { minutesLeft } = analysisProgress(job.status, job.progress, job.timeline?.eta, now);
  const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(duration, 1)) * 100))}%`;

  const W = 1200;
  const curve = areaPath(timeline.energy ?? [], W, 16, 120);
  const chat = timeline.chat ?? [];
  const chatMax = Math.max(1, ...chat);
  const barW = chat.length ? W / chat.length : 0;

  const title =
    stepIndex === 3 && candidates.length > 0
      ? t("analysis.title.watch")
      : t(`analysis.title.${STEPS[stepIndex].key}`);
  const subtitle =
    stepIndex === 3 && candidates.length > 0
      ? t("analysis.watched", { done: rated.length, total: candidates.length - clips.length, kept: Math.min(leaders.length, KEEP) })
      : stepIndex === 4 && count
        ? t("analysis.cutting", { done: count[0], total: count[1] })
        : t(`analysis.subtitle.${STEPS[stepIndex].key}`);

  const stepTime = (step: Step): number | null => {
    const timings = job.step_timings ?? {};
    let total = 0;
    let found = false;
    for (const s of step.statuses) {
      const timing = timings[s];
      if (!timing) continue;
      found = true;
      total += timing.duration_seconds ?? Math.max(0, now - timing.start);
    }
    return found ? total : null;
  };

  const labeled = leaders.slice(0, 3);
  // Close passages: their labels on separate rows (a label is up to ~210 px wide)
  const labelCenters = labeled.map((c) => Math.min(Math.max((c.t / Math.max(duration, 1)) * stageWidth, 80), stageWidth - 80));
  const labelRows = stackLabels(labelCenters, 215);

  return (
    <section className="flex flex-wrap gap-[18px] items-stretch">
      <article className="glass-strong rounded-[20px] p-6 flex-[1_1_640px] min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-[-0.025em] text-white">{title}</h2>
            <p className="mt-1.5 text-[14px] text-ink-2">{subtitle}</p>
          </div>
          <span className="chip chip-neutral h-8 px-3 text-[13px] font-[550]">
            <Clock3 className="w-[15px] h-[15px]" /> {t("analysis.left", { time: timeLeft(minutesLeft) })}
          </span>
        </div>

        {/* The live: voice energy, chat, frames, and the passages on it */}
        <div ref={stage} className="relative mt-[22px] h-[236px] rounded-[14px] overflow-hidden bg-black/30 border border-white/[0.06]">
          {curve.area ? (
            <svg viewBox={`0 0 ${W} 160`} preserveAspectRatio="none" aria-hidden className="absolute left-0 top-9 w-full h-[150px]">
              <defs>
                <linearGradient id="energy-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.55" />
                  <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={curve.area} fill="url(#energy-fill)" />
              <path d={curve.line} fill="none" stroke="#f5f5f2" strokeOpacity="0.9" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              {chat.map((c, i) =>
                c > 0 ? (
                  <rect key={i} x={i * barW + barW * 0.2} y={160 - Math.max(2, (c / chatMax) * 30)} width={barW * 0.6} height={Math.max(2, (c / chatMax) * 30)} fill="#f5f5f2" fillOpacity="0.34" />
                ) : null,
              )}
            </svg>
          ) : (
            <div className="absolute inset-x-0 top-9 h-[150px] grid place-items-center">
              <span className="text-[13px] text-ink-3">{t("analysis.curveSoon")}</span>
            </div>
          )}

          {storyboard && (
            <div className="absolute inset-x-0 top-[186px] h-6 flex opacity-85">
              {evenFrames(storyboard, 16).map((frame, k) => (
                <div key={k} className="flex-1 h-full" style={tileStyle(storyboard, frame)} />
              ))}
            </div>
          )}

          {labeled.map((c, i) => (
            <div key={`label-${c.t}`}>
              <div
                className="absolute bottom-[26px] w-px bg-[linear-gradient(180deg,var(--color-accent)_0%,var(--color-accent-soft)_100%)]"
                style={{ left: at(c.t), top: 40 + labelRows[i] * 32 }}
              />
              <span
                className="absolute -translate-x-1/2 chip glass-chip text-white h-[26px] border border-white/10"
                style={{ left: `clamp(80px, ${at(c.t)}, calc(100% - 80px))`, top: 12 + labelRows[i] * 32 }}
              >
                <span className="mono text-accent">{Math.round((c.score ?? 0) * 100)}</span>
                <span className="max-w-[160px] truncate">{c.name}</span>
              </span>
            </div>
          ))}

          {/* Candidate track */}
          <div className="absolute inset-x-0 bottom-0 h-[26px] bg-black/30 border-t border-white/[0.06]">
            {candidates.map((c) => {
              const state =
                c.state === "clip" ? "clip" : c.state === "pending" ? "pending" : leaderSet.has(c.t) || c.state === "kept" ? "lead" : "out";
              return (
                <span key={c.t} className="track-dot" data-state={state} style={{ left: at(c.t), "--d": `${popDelay(c)}ms` } as CSSProperties}>
                  <span />
                </span>
              );
            })}
          </div>
        </div>

        <div className="mono relative h-6 text-[11px] text-ink-3">
          <span className="absolute left-0 top-2">0:00</span>
          {Array.from({ length: Math.floor(duration / 3600) }, (_, i) => i + 1)
            .filter((h) => (h * 3600) / Math.max(duration, 1) < 0.94)
            .map((h) => (
              <span key={h} className="absolute top-2 -translate-x-1/2" style={{ left: at(h * 3600) }}>
                {h}:00
              </span>
            ))}
          {duration > 0 && <span className="absolute right-0 top-2">{clock(duration).replace(/:\d\d$/, "")}</span>}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-[18px] text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-[7px]"><span className="w-3.5 h-0.5 rounded-full bg-ink" />{t("analysis.legend.voice")}</span>
          <span className="inline-flex items-center gap-[7px]"><span className="w-1.5 h-2.5 rounded-[1px] bg-white/40" />{t("analysis.legend.chat")}</span>
          <span className="inline-flex items-center gap-[7px]"><span className="w-[9px] h-[9px] rounded-full bg-accent" />{t("analysis.legend.kept")}</span>
          <span className="inline-flex items-center gap-[7px]"><span className="w-2 h-2 rounded-full border-[1.5px] border-white/60" />{t("analysis.legend.pending")}</span>
          <span className="inline-flex items-center gap-[7px]"><span className="w-[5px] h-[5px] rounded-full bg-white/30" />{t("analysis.legend.dropped")}</span>
        </div>

        {/* Steps, in plain words */}
        <ol className="mt-6 grid gap-2.5 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
          {STEPS.map((step, i) => {
            const done = i < stepIndex;
            const current = i === stepIndex;
            const time = stepTime(step);
            return (
              <li key={step.key} className={`flex gap-[11px] p-3 rounded-[12px] ${current ? "bg-white/[0.08] border border-white/[0.08]" : done ? "bg-white/[0.04]" : "bg-white/[0.025]"}`}>
                <span
                  className={`w-[26px] h-[26px] rounded-[8px] flex-none grid place-items-center text-[12px] mono ${
                    done ? "bg-accent-soft text-accent" : current ? "bg-accent text-accent-ink" : "bg-white/[0.06] text-ink-3"
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : current ? <Sparkles className="w-3.5 h-3.5" fill="currentColor" /> : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-[13.5px] font-[550] ${i > stepIndex ? "text-ink-2" : "text-white"}`}>{t(`analysis.steps.${step.key}`)}</div>
                  {current && count ? (
                    <>
                      <div className="mt-[7px] h-1 rounded-full bg-white/[0.12] overflow-hidden">
                        <div className="h-full rounded-full bg-accent shadow-[0_0_10px_var(--color-accent-glow)] transition-[width] duration-700" style={{ width: `${(count[0] / Math.max(1, count[1])) * 100}%` }} />
                      </div>
                      <div className="mt-[5px] text-[12.5px] text-ink-3 mono">{count[0]} / {count[1]}</div>
                    </>
                  ) : (
                    <div className="mt-0.5 text-[12.5px] text-ink-3">
                      {time !== null ? <span className="mono">{time >= 60 ? `${Math.floor(time / 60)} min ${String(Math.round(time % 60)).padStart(2, "0")}` : `${Math.round(time)} s`}</span> : t("analysis.later")}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-[12.5px] text-ink-3">{t("analysis.keepUsing")}</p>
      </article>

      {/* Best finds so far */}
      <aside ref={finds} className="relative glass rounded-[20px] p-[18px] flex-[0_1_380px] min-w-0 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2.5 px-0.5 pb-1">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{t("analysis.finds")}</h2>
          <span key={leaders.length} className="chip chip-accent mono animate-bump">{leaders.length}</span>
        </div>

        {leaders.length === 0 && clips.length === 0 && (
          <p className="px-0.5 text-[13px] leading-relaxed text-ink-3">{t("analysis.findsSoon")}</p>
        )}

        {leaders.slice(0, 1).map((c) => (
          <article key={c.t} data-flip={c.t} className="animate-find p-2.5 rounded-[14px] bg-white/5 border border-white/[0.06]">
            <div className="relative aspect-video rounded-[10px] overflow-hidden">
              <LiveFrame storyboard={storyboard} t={c.t} className="absolute inset-0" />
              <span className="mono absolute top-2 left-2 chip bg-accent text-accent-ink h-[22px]">{Math.round((c.score ?? 0) * 100)}</span>
              {c.category && <span className="absolute top-2 right-2 chip glass-chip text-white h-[22px]">{t(`categories.${c.category}`, { defaultValue: c.category })}</span>}
            </div>
            <div className="mt-2.5 flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-semibold text-white truncate">{c.name}</span>
              <span className="mono text-[11.5px] text-ink-3">{clock(c.t)}</span>
            </div>
          </article>
        ))}

        {leaders.slice(1, 4).map((c, i) => (
          <article
            key={c.t}
            data-flip={c.t}
            className="animate-find flex gap-3 p-2.5 rounded-[14px] bg-white/5 border border-white/[0.06]"
            style={{ "--i": i + 1 } as CSSProperties}
          >
            <div className="relative w-[132px] flex-none aspect-video rounded-[9px] overflow-hidden">
              <LiveFrame storyboard={storyboard} t={c.t} className="absolute inset-0" />
              <span className="mono absolute top-1.5 left-1.5 chip bg-accent text-accent-ink h-5 px-1.5 text-[11.5px]">{Math.round((c.score ?? 0) * 100)}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold leading-snug text-white line-clamp-2">{c.name}</div>
              <div className="mt-[3px] text-[12px] text-ink-3">
                {c.category && `${t(`categories.${c.category}`, { defaultValue: c.category })} · `}
                <span className="mono">{clock(c.t)}</span>
              </div>
            </div>
          </article>
        ))}

        {clips.map((c: TimelineCandidate) => (
          <article
            key={`clip-${c.t}`}
            data-flip={`clip-${c.t}`}
            className="animate-find flex items-center gap-3 p-3 rounded-[14px] bg-white/[0.03] border border-dashed border-white/15"
          >
            <span className="w-[34px] h-[34px] rounded-[10px] flex-none grid place-items-center bg-white/[0.08]">
              <Scissors className="w-[17px] h-[17px]" />
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-white">
                {t("analysis.clipHeard")} <span className="mono">{clock(c.t)}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-ink-3">{t("analysis.clipHeardHint")}</div>
            </div>
          </article>
        ))}

        {leaders.length > 4 && <div className="mt-auto pt-1 px-0.5 text-[12.5px] text-ink-3">{t("analysis.more", { count: leaders.length - 4 })}</div>}
      </aside>
    </section>
  );
}
