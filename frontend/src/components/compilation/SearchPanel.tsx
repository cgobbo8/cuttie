import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, MessageCircle, Mic, Play, Plus, Search, Sparkles } from "lucide-react";
import {
  LiveError,
  planLiveVideo,
  searchLive,
  type LiveFailure,
  type LiveHit,
  type LiveSearchInfo,
  type TwitchStoryboard,
  type VideoPlan,
} from "../../lib/api";
import { liveClock } from "../../lib/compilation";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { useToast } from "../Toast";

interface Props {
  jobId: string;
  storyboard: TwitchStoryboard | null;
  /** What can be searched in this live, and what asking the AI costs */
  info: LiveSearchInfo | null;
  /** The result shown in the preview */
  previewed: LiveHit | null;
  /** The compilation already shows this moment */
  isAdded: (hit: LiveHit) => boolean;
  onPreview: (hit: LiveHit) => void;
  /** Add results to the compilation (`query`: the search they came from) */
  onAdd: (hits: LiveHit[], query: string) => void;
  /** The AI planned a whole video */
  onPlan: (plan: VideoPlan, target: number) => void;
  /** The results on screen changed (shown on the live's strip) */
  onResults: (hits: LiveHit[]) => void;
}

type Tab = "search" | "describe";
const TARGETS = [30, 60, 90, 180];

const SOURCE_ICON = { voice: Mic, chat: MessageCircle, ai: Sparkles } as const;

/** A few words of what is said around a result: enough to place it, the result itself stays in view */
const AROUND = 64;
const tail = (text: string) => (text.length > AROUND ? `…${text.slice(text.indexOf(" ", text.length - AROUND) + 1)}` : text);
const head = (text: string) => (text.length > AROUND ? `${text.slice(0, text.lastIndexOf(" ", AROUND))}…` : text);

/** Looking for moments in the whole live: by words, by asking the AI, or by describing the whole video */
export default function SearchPanel({ jobId, storyboard, info, previewed, isAdded, onPreview, onAdd, onPlan, onResults }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"words" | "ai" | "plan" | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [results, setResults] = useState<{ hits: LiveHit[]; total: number; query: string; mode: "words" | "ai" } | null>(null);
  const [brief, setBrief] = useState("");
  const [target, setTarget] = useState(90);

  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  const aiCost = info?.ai_cost != null ? `≈ ${dollars(info.ai_cost)}` : null;
  /** "Asked before: free" or what it cost */
  const paid = (answer: { cached?: boolean; cost?: number }) => (answer.cached ? t("compilation.alreadyAsked") : answer.cost ? dollars(answer.cost) : "");

  const run = async (mode: "words" | "ai") => {
    const asked = query.trim();
    if (!asked || busy) return;
    setBusy(mode);
    setFailure(null);
    try {
      const found = await searchLive(jobId, asked, mode);
      setResults({ hits: found.hits, total: found.total, query: asked, mode });
      onResults(found.hits);
      if (mode === "ai") toast.success([t("compilation.found", { count: found.hits.length }), paid(found)].filter(Boolean).join(" · "));
    } catch (err) {
      setFailure(err instanceof LiveError ? err.reason : "failed");
    } finally {
      setBusy(null);
    }
  };

  const plan = async (e: FormEvent) => {
    e.preventDefault();
    const asked = brief.trim();
    if (!asked || busy) return;
    setBusy("plan");
    setFailure(null);
    try {
      const planned = await planLiveVideo(jobId, asked, target);
      const count = planned.sections.reduce((sum, s) => sum + s.hits.length, 0);
      if (count === 0) {
        toast.info(t("compilation.planEmpty"));
        return;
      }
      onPlan(planned, target);
      toast.success([t("compilation.planned", { count }), paid(planned)].filter(Boolean).join(" · "));
    } catch (err) {
      setFailure(err instanceof LiveError ? err.reason : "failed");
    } finally {
      setBusy(null);
    }
  };

  const fresh = results?.hits.filter((hit) => !isAdded(hit)) ?? [];

  return (
    <aside aria-label={t("compilation.search")} className="glass rounded-[20px] p-3 flex-[1_1_400px] min-w-0 flex flex-col">
      <div role="tablist" className="seg">
        {(["search", "describe"] as const).map((key) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            <span className="inline-flex items-center justify-center gap-1.5">
              {key === "describe" && <Sparkles className="w-3.5 h-3.5" />}
              {t(`compilation.tab.${key}`)}
            </span>
          </button>
        ))}
      </div>

      {tab === "search" ? (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            run("words");
          }}
        >
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
      ) : (
        <form className="mt-3" onSubmit={plan}>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            placeholder={t("compilation.briefPlaceholder")}
            aria-label={t("compilation.tab.describe")}
            className="w-full p-3 rounded-[11px] bg-black/30 border border-white/10 text-[14px] leading-snug text-white outline-none focus:border-accent-line placeholder:text-ink-3 resize-y"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("compilation.length")} className="seg flex-1 min-w-[220px]">
              {TARGETS.map((seconds) => (
                <button key={seconds} type="button" aria-pressed={target === seconds} onClick={() => setTarget(seconds)}>
                  {t(`compilation.target.${seconds}`)}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={!brief.trim() || !!busy || !info?.transcript} className="btn btn-primary btn-sm mt-2.5">
            {busy === "plan" ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Sparkles className="w-3.5 h-3.5" />}
            {t("compilation.buildVideo")}
            {aiCost && <span className="mono text-[11.5px] opacity-60">{aiCost}</span>}
          </button>
          <p className="mt-2 px-0.5 text-[12px] leading-snug text-ink-3">{t(info && !info.transcript ? "compilation.noTranscript" : "compilation.describeHint")}</p>
        </form>
      )}

      {(busy === "ai" || busy === "plan") && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-[12px] inset animate-fade-in">
          <Loader2 className="w-4 h-4 spinner text-accent flex-none" />
          <p className="text-[12.5px] leading-snug text-ink-2">{t("compilation.aiReading")}</p>
        </div>
      )}
      {failure && (
        <p role="alert" className="mt-3 p-3 rounded-[12px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t(`compilation.failure.${failure}`)}
        </p>
      )}

      {tab === "search" && results && (
        <div className="mt-3 pt-3 border-t border-white/[0.08] flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
            <span className="text-[13px] text-ink-2">
              {results.total === 0
                ? t(results.mode === "ai" ? "compilation.nothingAi" : "compilation.nothingWords")
                : t("compilation.found", { count: results.total })}
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
                    style={storyboard ? tileStyle(storyboard, frameAt(storyboard, hit.start)) : undefined}
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
                    {hit.why && <span className="mt-0.5 block text-[12px] leading-snug text-accent">{hit.why}</span>}
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
