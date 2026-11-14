import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Coins, Loader2, X } from "lucide-react";
import { submitVod, type LiveCompilations, type TwitchVod } from "../../lib/api";
import { useChannel } from "../../lib/ChannelContext";
import { liveWhen, plainDate, vodsToAnalyse } from "../../lib/compilationLibrary";
import { ANALYSIS_COST, aboutCost, analysisProgress, hoursMinutes, splitVodTitle, timeLeft } from "../../lib/format";
import { useToast } from "../Toast";

/** Lives still to analyse shown before "see the others" */
const SHOWN_TO_ANALYSE = 4;
/** How often the channel is asked again while a live is being analysed */
const WATCH_EVERY = 8000;

interface Props {
  title: string;
  hint: string;
  /** The analysed lives to choose from */
  lives: LiveCompilations[];
  /** A live's picture */
  coverOf: (live: LiveCompilations) => string | null;
  /** Several lives can be ticked (a compilation that takes from all of them); else a click picks one */
  multiple?: boolean;
  /** Most lives that can be ticked */
  max?: number;
  /** The button under the list, for the lives ticked */
  confirm?: (count: number) => string;
  /** The lives picked, newest first */
  onPick: (jobIds: string[]) => void;
  onClose: () => void;
  /** A live analysed from here is ready: the list of analysed lives is to be read again */
  onAnalysed?: () => void;
}

/**
 * Choosing the live (or the lives) a compilation is made from. The channel's lives that are not
 * analysed yet are listed too: they can be analysed from here, once the price was said.
 */
export default function LivePicker({ title, hint, lives, coverOf, multiple = false, max = 5, confirm, onPick, onClose, onAnalysed }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { channel, refreshChannel } = useChannel();
  const [ticked, setTicked] = useState<string[]>([]);
  // The live whose price is being read before its analysis is launched, the one being launched, and whether all are listed
  const [asking, setAsking] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const cost = aboutCost(ANALYSIS_COST, i18n.language);

  const toAnalyse = vodsToAnalyse(channel?.vods ?? []);
  const anyRunning = toAnalyse.some(({ state }) => state === "running");
  // While a live is being analysed, its progress stays fresh
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => refreshChannel(), WATCH_EVERY);
    return () => window.clearInterval(timer);
  }, [anyRunning, refreshChannel]);
  // A live that was being analysed is done: it can be picked
  const watched = useRef(new Set<string>());
  useEffect(() => {
    for (const vod of channel?.vods ?? []) {
      if (vod.job && vodsToAnalyse([vod])[0]?.state === "running") watched.current.add(vod.id);
      else if (watched.current.has(vod.id)) {
        watched.current.delete(vod.id);
        if (vod.job?.status === "DONE") {
          toast.success(t("compilations.analysed", { name: splitVodTitle(vod.title).title }));
          onAnalysed?.();
        }
      }
    }
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const analyse = async (vod: TwitchVod) => {
    setStarting(vod.id);
    try {
      await submitVod(vod.url);
      toast.success(t("compilations.analyseStarted", { cost }));
      setAsking(null);
      await refreshChannel();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("analyze.submitError"));
    } finally {
      setStarting(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sorted = [...lives].sort((a, b) => Date.parse(liveWhen(b) ?? "") - Date.parse(liveWhen(a) ?? ""));
  const toggle = (id: string) => setTicked((prev) => (prev.includes(id) ? prev.filter((other) => other !== id) : prev.length < max ? [...prev, id] : prev));
  // Picked in the order of the list (newest first), whatever the order they were ticked in
  const picked = sorted.filter((live) => ticked.includes(live.job_id)).map((live) => live.job_id);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative glass-strong rounded-[20px] p-5 w-full max-w-[540px] max-h-[80vh] flex flex-col animate-rise">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-2">{hint}</p>
          </div>
          <button onClick={onClose} aria-label={t("common.cancel")} className="w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/10 flex-none">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-4 -mx-1.5 px-1.5 overflow-y-auto min-h-0">
        {sorted.length === 0 ? (
          <p className="text-[13px] text-ink-3">{t("compilations.noOtherLive")}</p>
        ) : (
          <ul className="-mx-1.5 flex flex-col gap-0.5">
            {sorted.map((live) => {
              const on = ticked.includes(live.job_id);
              const when = liveWhen(live);
              return (
                <li key={live.job_id}>
                  <button
                    type="button"
                    role={multiple ? "checkbox" : undefined}
                    aria-checked={multiple ? on : undefined}
                    onClick={() => (multiple ? toggle(live.job_id) : onPick([live.job_id]))}
                    className={`w-full flex items-center gap-3 p-1.5 rounded-[12px] text-left transition-colors ${on ? "bg-accent-soft" : "hover:bg-white/[0.07]"}`}
                  >
                    {multiple && (
                      <span className={`w-[18px] h-[18px] rounded-[6px] grid place-items-center flex-none border ${on ? "bg-accent border-accent text-ground" : "border-white/25"}`}>
                        {on && <Check className="w-3 h-3" strokeWidth={3.2} />}
                      </span>
                    )}
                    <span className="w-[96px] aspect-video rounded-[8px] overflow-hidden flex-none bg-white/[0.05]">
                      {coverOf(live) && <img src={coverOf(live)!} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-[550] text-white truncate">{splitVodTitle(live.title).title || t("compilations.untitledLive")}</span>
                      <span className="block text-[12px] text-ink-3 truncate">
                        {[when ? plainDate(when, i18n.language) : null, live.game, live.duration ? hoursMinutes(live.duration) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {live.compilations.length > 0 && <span className="chip chip-neutral h-[22px] flex-none">{t("compilations.has", { count: live.compilations.length })}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* The channel's lives that can't be picked yet: analysing one is not free, and says so */}
        {toAnalyse.length > 0 && (
          <section className="mt-4 pt-3.5 border-t border-white/[0.08]">
            <h4 className="text-[13px] font-[600] text-white">{t("compilations.notAnalysed")}</h4>
            <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-ink-3">
              <Coins className="w-3.5 h-3.5 flex-none mt-px text-amber-300/80" />
              {t("compilations.notAnalysedHint", { cost })}
            </p>
            <ul className="mt-2 -mx-1.5 flex flex-col gap-0.5">
              {(all ? toAnalyse : toAnalyse.slice(0, SHOWN_TO_ANALYSE)).map(({ vod, state }) => {
                const progress = state === "running" && vod.job ? analysisProgress(vod.job.status, vod.job.progress, vod.job.eta) : null;
                return (
                  <li key={vod.id} className={`rounded-[12px] ${asking === vod.id ? "bg-white/[0.05]" : ""}`}>
                    <div className="flex items-center gap-3 p-1.5">
                      <span className="w-[96px] aspect-video rounded-[8px] overflow-hidden flex-none bg-white/[0.05]">
                        {vod.thumbnail_url && <img src={vod.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover opacity-70" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-[550] text-ink-2 truncate">{splitVodTitle(vod.title).title || t("compilations.untitledLive")}</span>
                        <span className="block text-[12px] text-ink-3 truncate">
                          {progress
                            ? t("compilations.analysing", { percent: progress.percent, left: timeLeft(progress.minutesLeft) })
                            : [state === "failed" ? t("compilations.analyseStopped") : null, plainDate(vod.published_at, i18n.language), vod.game, hoursMinutes(vod.duration_seconds)].filter(Boolean).join(" · ")}
                        </span>
                        {progress && (
                          <span className="mt-1 block h-[3px] rounded-full bg-white/10 overflow-hidden" aria-hidden>
                            <span className="block h-full bg-accent transition-[width] duration-700" style={{ width: `${progress.percent}%` }} />
                          </span>
                        )}
                      </span>
                      {state === "running" ? (
                        <Loader2 className="w-4 h-4 spinner text-accent flex-none mr-1" />
                      ) : (
                        asking !== vod.id && (
                          <button type="button" onClick={() => setAsking(vod.id)} className="btn btn-glass btn-sm flex-none">
                            {t(state === "failed" ? "compilations.analyseAgain" : "compilations.analyseVod")}
                            <span className="mono text-[11.5px] text-ink-3">{cost}</span>
                          </button>
                        )
                      )}
                    </div>
                    {asking === vod.id && state !== "running" && (
                      <div className="px-2.5 pb-2.5">
                        <p className="text-[12.5px] leading-snug text-ink-2">{t("compilations.analysePrice", { cost })}</p>
                        <div className="mt-2 flex items-center justify-end gap-2">
                          <button type="button" onClick={() => setAsking(null)} disabled={starting === vod.id} className="btn btn-ghost btn-sm">
                            {t("common.cancel")}
                          </button>
                          <button type="button" onClick={() => analyse(vod)} disabled={starting !== null} className="btn btn-primary btn-sm">
                            {starting === vod.id && <Loader2 className="w-3.5 h-3.5 spinner" />}
                            {t("compilations.analyseConfirm", { cost })}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {!all && toAnalyse.length > SHOWN_TO_ANALYSE && (
              <button type="button" onClick={() => setAll(true)} className="mt-1.5 text-[12px] text-ink-2 underline decoration-white/20 underline-offset-2 hover:text-white">
                {t("compilations.showMore", { count: toAnalyse.length - SHOWN_TO_ANALYSE })}
              </button>
            )}
          </section>
        )}
        </div>
        {multiple && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12px] text-ink-3">{t("compilations.pickSeveral", { max })}</p>
            <button type="button" disabled={picked.length === 0} onClick={() => onPick(picked)} className="btn btn-primary btn-sm flex-none">
              {confirm ? confirm(picked.length) : t("compilation.new")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
