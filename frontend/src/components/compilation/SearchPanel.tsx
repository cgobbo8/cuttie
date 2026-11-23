import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, MessageCircle, Mic, Play, Plus, RotateCcw, Search, Sparkles, X } from "lucide-react";
import {
  LiveError,
  getLiveSearchProgress,
  searchLive,
  type LiveFailure,
  type LiveHit,
  type LiveSearchInfo,
  type LiveSearchStep,
  type TwitchStoryboard,
} from "../../lib/api";
import { isNear, liveClock, stepText } from "../../lib/compilation";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { useToast } from "../Toast";

interface Props {
  jobId: string;
  /** Each live's preview frames, by job id */
  storyboards: Record<string, TwitchStoryboard>;
  /** The lives the compilation takes passages from, its own first: the AI works on all of them, a search by hand looks in one */
  lives: { job: string; label: string }[];
  /** What can be searched in this live, and what asking the AI costs */
  info: LiveSearchInfo | null;
  /** The result shown in the preview */
  previewed: LiveHit | null;
  /** The compilation already shows this moment */
  isAdded: (hit: LiveHit) => boolean;
  onPreview: (hit: LiveHit) => void;
  /** Add results to the compilation (`query`: the search they came from) */
  onAdd: (hits: LiveHit[], query: string) => void;
  /** The results on screen changed (shown on the live's strip) */
  onResults: (hits: LiveHit[]) => void;
  /** Shown in a window of its own: what closes it */
  onClose?: () => void;
}

const SOURCE_ICON = { voice: Mic, chat: MessageCircle, ai: Sparkles } as const;

/** A few words of what is said around a result: enough to place it, the result itself stays in view */
const AROUND = 64;
const tail = (text: string) => (text.length > AROUND ? `…${text.slice(text.indexOf(" ", text.length - AROUND) + 1)}` : text);
const head = (text: string) => (text.length > AROUND ? `${text.slice(0, text.lastIndexOf(" ", AROUND))}…` : text);

/** How often the AI is asked what it is doing while its answer is awaited */
const PROGRESS_EVERY = 1200;

/**
 * Looking for passages in the whole live by hand: the words said or written in the chat (free,
 * at once), or a question the AI answers by reading, listening and checking each passage.
 * Building or changing a whole video is asked of the assistant.
 */
export default function SearchPanel({ jobId, storyboards, lives, info, previewed, isAdded, onPreview, onAdd, onResults, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [query, setQuery] = useState("");
  // The live a search by hand looks in (the compilation's own unless another one is chosen)
  const [where, setWhere] = useState(jobId);
  const searched = lives.some((live) => live.job === where) ? where : jobId;
  const [busy, setBusy] = useState<"words" | "ai" | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [results, setResults] = useState<{ hits: LiveHit[]; total: number; query: string; mode: "words" | "ai"; note?: string; cached?: boolean } | null>(null);
  /** What the AI is doing while its answer is awaited */
  const [step, setStep] = useState<LiveSearchStep | null>(null);

  const asking = busy === "ai";
  useEffect(() => {
    if (!asking) return;
    setStep(null);
    let stopped = false;
    const ask = async () => {
      const doing = await getLiveSearchProgress(searched);
      if (!stopped && doing) setStep(doing);
    };
    const timer = window.setInterval(ask, PROGRESS_EVERY);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [asking, searched]);

  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  /** A question to the AI costs a fraction of a cent: said as such, never as "0.00 $" */
  const about = (cost?: number | null) => (cost == null ? null : cost < 0.01 ? `< ${dollars(0.01)}` : `≈ ${dollars(cost)}`);
  const aiCost = about(info?.ai_cost);
  /** "Asked before: free" or what it cost */
  const paid = (answer: { cached?: boolean; cost?: number }) =>
    answer.cached ? t("compilation.alreadyAsked") : answer.cost ? (answer.cost < 0.01 ? t("compilation.underCent") : dollars(answer.cost)) : "";

  /** "3 passages found · 2 close", or that nothing really matches */
  const summary = (hits: LiveHit[], total = hits.length) => {
    const near = hits.filter(isNear).length;
    const sure = total - near;
    if (total === 0) return "";
    if (sure === 0) return t("compilation.onlyNear", { count: near });
    return [t("compilation.found", { count: sure }), near > 0 && t("compilation.near", { count: near })].filter(Boolean).join(" · ");
  };

  /** `again`: the question on screen asked again on purpose (the AI searches anew instead of giving the answer it kept) */
  const run = async (mode: "words" | "ai", again = false) => {
    const asked = again && results ? results.query : query.trim();
    if (!asked || busy) return;
    setBusy(mode);
    setFailure(null);
    try {
      const found = await searchLive(searched, asked, mode, again);
      // What is found in another live says so: its times are that live's
      const hits = searched === jobId ? found.hits : found.hits.map((hit) => ({ ...hit, job: searched }));
      setResults({ hits, total: found.total, query: asked, mode, note: mode === "ai" ? found.note : undefined, cached: mode === "ai" && !!found.cached });
      onResults(hits);
      if (mode === "ai") toast.success([summary(found.hits), paid(found)].filter(Boolean).join(" · "));
    } catch (err) {
      setFailure(err instanceof LiveError ? err.reason : "failed");
    } finally {
      setBusy(null);
    }
  };

  // "Add all" takes what matches, not what is only close
  const fresh = results?.hits.filter((hit) => !isAdded(hit) && !isNear(hit)) ?? [];

  return (
    <aside aria-label={t("compilation.search")} className="glass rounded-[20px] p-3 min-w-0 flex flex-col">
      <header className="flex items-center gap-2 px-1 pb-1">
        <Search className="w-4 h-4 text-ink-3" />
        <h2 className="flex-1 text-[15px] font-[620] text-white">{t("compilation.search")}</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("common.close")} title={t("common.close")} className="btn btn-ghost btn-icon w-8 h-8 text-ink-3 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        )}
      </header>
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run("words");
          }}
        >
          {lives.length > 1 && (
            <select
              value={searched}
              onChange={(e) => setWhere(e.target.value)}
              aria-label={t("compilation.lives.searchIn")}
              className="select-arrow w-full h-9 mb-2 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line"
            >
              {lives.map((live) => (
                <option key={live.job} value={live.job}>
                  {t("compilation.lives.searchIn")} : {live.label}
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("compilation.queryPlaceholder")}
              aria-label={t("compilation.search")}
              className="w-full h-11 pl-9 pr-3 rounded-[11px] bg-black/30 border border-white/10 text-[14px] text-white outline-none focus:border-accent-line placeholder:text-ink-3"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" disabled={!query.trim() || !!busy} className="btn btn-primary btn-sm">
              {busy === "words" ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Search className="w-3.5 h-3.5" />}
              {t("compilation.searchWords")}
            </button>
            <button type="button" onClick={() => run("ai")} disabled={!query.trim() || !!busy || !info?.transcript} className="btn btn-glass btn-sm">
              {busy === "ai" ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Sparkles className="w-3.5 h-3.5 text-accent" />}
              {t("compilation.askAi")}
              {aiCost && <span className="mono text-[11.5px] text-ink-3">{aiCost}</span>}
            </button>
          </div>
          <p className="mt-2 px-0.5 text-[12px] leading-snug text-ink-3">{t(info && !info.transcript ? "compilation.noTranscript" : "compilation.searchHint")}</p>
        </form>

      {asking && (
        <div role="status" aria-live="polite" className="mt-3 flex items-start gap-3 p-3 rounded-[12px] inset animate-fade-in">
          <Loader2 className="w-4 h-4 spinner text-accent flex-none mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] leading-snug text-white break-words">{stepText(t, step)}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
              {t(step?.step === "relistening" ? "compilation.aiRelistening" : step?.step === "hearing" ? "compilation.aiHearing" : "compilation.aiReading")}
            </p>
          </div>
        </div>
      )}
      {failure && (
        <p role="alert" className="mt-3 p-3 rounded-[12px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t(`compilation.failure.${failure}`)}
        </p>
      )}

      {results && (
        <div className="mt-3 pt-3 border-t border-white/[0.08] flex-1 min-h-0 flex flex-col">
          {results.note && <AiNote label={t("compilation.aiNote")} note={results.note} className="mb-2.5" />}
          {/* Nothing was searched: the same question had been answered before. One click has the AI search again */}
          {results.cached && (
            <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-0.5">
              <span className="flex-1 min-w-[160px] text-[12px] leading-snug text-ink-3">{t("compilation.keptAnswer")}</span>
              <button type="button" onClick={() => run("ai", true)} disabled={!!busy || !info?.transcript} title={t("compilation.askAgainHint")} className="btn btn-glass btn-sm flex-none">
                {busy === "ai" ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <RotateCcw className="w-3.5 h-3.5" />}
                {t("compilation.askAgain")}
                {aiCost && <span className="mono text-[11.5px] text-ink-3">{aiCost}</span>}
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
            <span className="text-[13px] text-ink-2">
              {results.total === 0 ? t(results.mode === "ai" ? "compilation.nothingAi" : "compilation.nothingWords") : summary(results.hits, results.total)}
              {results.total > results.hits.length && <span className="text-ink-3"> · {t("compilation.firstShown", { count: results.hits.length })}</span>}
            </span>
            {fresh.length > 1 && (
              <button onClick={() => onAdd(fresh, results.query)} className="btn btn-ghost btn-sm h-7 px-2 flex-none">
                <Plus className="w-3.5 h-3.5" strokeWidth={2.4} /> {t("compilation.addAll", { count: fresh.length })}
              </button>
            )}
          </div>
          <ul className="flex-1 min-h-0 max-h-[560px] overflow-y-auto -mx-1 px-1 flex flex-col gap-0.5">
            {results.hits.map((hit) => {
              const added = isAdded(hit);
              const selected = previewed === hit;
              return (
                <li key={`${hit.start}-${hit.end}`} className={`flex gap-2.5 p-2 rounded-[12px] transition-colors ${selected ? "bg-white/10" : "hover:bg-white/[0.05]"}`}>
                  <button
                    type="button"
                    onClick={() => onPreview(hit)}
                    aria-label={t("compilation.watch")}
                    className="group/frame relative w-[96px] aspect-video rounded-[8px] overflow-hidden flex-none bg-white/[0.05] self-start"
                    style={storyboards[hit.job ?? jobId] ? tileStyle(storyboards[hit.job ?? jobId], frameAt(storyboards[hit.job ?? jobId], hit.start)) : undefined}
                  >
                    <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 group-hover/frame:opacity-100 transition-opacity">
                      <Play className="w-4 h-4 text-white" fill="currentColor" />
                    </span>
                  </button>
                  <button type="button" onClick={() => onPreview(hit)} className="flex-1 min-w-0 text-left">
                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-ink-3">
                      <span className="mono text-ink-2">{liveClock(hit.start)}</span>
                      <span>· {(hit.end - hit.start).toFixed(1)} s</span>
                      {hit.sources.map((source) => {
                        const Icon = SOURCE_ICON[source as keyof typeof SOURCE_ICON];
                        return Icon ? (
                          <span key={source} className="inline-flex items-center gap-1">
                            <Icon className="w-3 h-3" /> {t(`compilation.source.${source}`)}
                          </span>
                        ) : null;
                      })}
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug line-clamp-3">
                      {hit.before && <span className="text-ink-3">{tail(hit.before)} </span>}
                      <span className="text-white font-[550]">{hit.text}</span>
                      {hit.after && <span className="text-ink-3"> {head(hit.after)}</span>}
                    </span>
                    {hit.why && (
                      <span className={`mt-0.5 block text-[12px] leading-snug ${isNear(hit) ? "text-ink-2" : "text-accent"}`}>
                        {isNear(hit) && (
                          <span title={t("compilation.nearTitle")} className="mr-1.5 inline-block px-1.5 rounded-[6px] border border-white/15 text-[11px] text-ink-3 align-[1px]">
                            ≈ {t("compilation.nearTag")}
                          </span>
                        )}
                        {hit.why}
                      </span>
                    )}
                    {hit.chat.length > 0 && <span className="mt-0.5 block text-[12px] text-ink-3 truncate">{hit.chat.join("  ·  ")}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => !added && onAdd([hit], results.query)}
                    disabled={added}
                    aria-label={t(added ? "compilation.added" : "compilation.add")}
                    title={t(added ? "compilation.added" : "compilation.add")}
                    className={`btn btn-icon w-8 h-8 rounded-full flex-none self-center ${added ? "bg-accent/20 text-accent" : "btn-glass"}`}
                  >
                    {added ? <Check className="w-4 h-4" strokeWidth={2.6} /> : <Plus className="w-4 h-4" strokeWidth={2.4} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}

/** What the AI says of its own search: what it looked for, how sure it is, what is missing */
function AiNote({ label, note, className = "mt-3" }: { label: string; note: string; className?: string }) {
  return (
    <p className={`${className} flex gap-2 p-2.5 rounded-[11px] bg-accent-soft border border-accent-line/50 text-[12.5px] leading-snug text-ink-2 animate-fade-in`}>
      <Sparkles className="w-3.5 h-3.5 text-accent flex-none mt-0.5" aria-hidden />
      <span>
        <span className="sr-only">{label} : </span>
        {note}
      </span>
    </p>
  );
}
