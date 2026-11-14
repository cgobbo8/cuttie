import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2, MessageCircle, Mic, Play, Plus, Search, Sparkles } from "lucide-react";
import {
  LiveError,
  getLiveSearchProgress,
  planLiveVideo,
  searchLive,
  type LiveFailure,
  type LiveHit,
  type LiveSearchInfo,
  type LiveSearchStep,
  type TwitchStoryboard,
  type PlanChange,
  type VideoPlan,
} from "../../lib/api";
import { isNear, liveClock, stepText } from "../../lib/compilation";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { useToast } from "../Toast";
import PlanTalk, { type TalkTurn } from "./PlanTalk";

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
  /** The AI planned a whole video from `brief` */
  onPlan: (plan: VideoPlan, target: number, brief: string) => void;
  /** The video on screen was described to the AI: what was asked first, each change since and its answer */
  talk?: { brief: string; answer?: string; passages?: number; asks: TalkTurn[] } | null;
  /** The video as it is now, as the AI is told about it when a change is asked */
  current?: () => PlanChange["current"];
  /** The AI changed the video as asked (`ask`) */
  onChange?: (plan: VideoPlan, ask: string) => void;
  /** Light up in the video the passages a change added (its place in `talk.asks`) */
  onReveal?: (turn: number) => void;
  /** The results on screen changed (shown on the live's strip) */
  onResults: (hits: LiveHit[]) => void;
}

type Tab = "search" | "describe";
const TARGETS = [30, 60, 90, 180];
/** Longest description of a video the app takes (the API's own limit) */
const MAX_BRIEF = 4000;

const SOURCE_ICON = { voice: Mic, chat: MessageCircle, ai: Sparkles } as const;

/** A few words of what is said around a result: enough to place it, the result itself stays in view */
const AROUND = 64;
const tail = (text: string) => (text.length > AROUND ? `…${text.slice(text.indexOf(" ", text.length - AROUND) + 1)}` : text);
const head = (text: string) => (text.length > AROUND ? `${text.slice(0, text.lastIndexOf(" ", AROUND))}…` : text);

/** How often the AI is asked what it is doing while its answer is awaited */
const PROGRESS_EVERY = 1200;

/** Looking for moments in the whole live: by words, by asking the AI, or by describing the whole video */
export default function SearchPanel({ jobId, storyboard, info, previewed, isAdded, onPreview, onAdd, onPlan, onResults, talk, current, onChange, onReveal }: Props) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  // Describing the video to the AI is the main way in; searching by hand comes second
  const [tab, setTab] = useState<Tab>("describe");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"words" | "ai" | "plan" | null>(null);
  const [failure, setFailure] = useState<LiveFailure | null>(null);
  const [results, setResults] = useState<{ hits: LiveHit[]; total: number; query: string; mode: "words" | "ai"; note?: string } | null>(null);
  const [brief, setBrief] = useState("");
  const [target, setTarget] = useState(90);
  /** What the AI is doing while its answer is awaited */
  const [step, setStep] = useState<LiveSearchStep | null>(null);
  /** What the AI said of the last video it planned */
  const [planNote, setPlanNote] = useState("");
  /** A change asked on the video on screen, and the form of a new video shown anyway */
  const [request, setRequest] = useState("");
  const [another, setAnother] = useState(false);
  const talking = !!talk && !!onChange && !another;
  /** The change being worked on, and each thing the AI did for it so far */
  const [pending, setPending] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  /** A video is being built from its description: watched in the conversation, like a change */
  const planning = busy === "plan" && pending === null;
  const inTalk = tab === "describe" && (talking || planning);

  const asking = busy === "ai" || busy === "plan";
  useEffect(() => {
    if (!asking) return;
    setStep(null);
    setTrail([]);
    let stopped = false;
    const ask = async () => {
      const doing = await getLiveSearchProgress(jobId);
      if (stopped || !doing) return;
      setStep(doing);
      // One line per thing done, in the conversation
      const line = stepText(t, doing);
      setTrail((lines) => (lines[lines.length - 1] === line ? lines : [...lines, line]));
    };
    const timer = window.setInterval(ask, PROGRESS_EVERY);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [asking, jobId, t]);

  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  /** A question to the AI costs a fraction of a cent: said as such, never as "0.00 $" */
  const about = (cost?: number | null) => (cost == null ? null : cost < 0.01 ? `< ${dollars(0.01)}` : `≈ ${dollars(cost)}`);
  const aiCost = about(info?.ai_cost);
  const planCost = about(info?.plan_cost ?? info?.ai_cost);
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

  const run = async (mode: "words" | "ai") => {
    const asked = query.trim();
    if (!asked || busy) return;
    setBusy(mode);
    setFailure(null);
    try {
      const found = await searchLive(jobId, asked, mode);
      setResults({ hits: found.hits, total: found.total, query: asked, mode, note: mode === "ai" ? found.note : undefined });
      onResults(found.hits);
      if (mode === "ai") toast.success([summary(found.hits), paid(found)].filter(Boolean).join(" · "));
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
      setPlanNote(planned.note ?? "");
      if (count === 0) {
        toast.info(t("compilation.planEmpty"));
        return;
      }
      onPlan(planned, target, asked);
      setAnother(false);
      setBrief("");
      setPlanNote("");
      toast.success([t("compilation.planned", { count }), paid(planned)].filter(Boolean).join(" · "));
    } catch (err) {
      setFailure(err instanceof LiveError ? err.reason : "failed");
    } finally {
      setBusy(null);
    }
  };

  /** A change asked on the video the AI planned: it starts from the video as it is and from what was asked before */
  const change = async () => {
    const asked = request.trim();
    if (!asked || busy || !talk || !current || !onChange) return;
    setBusy("plan");
    setPending(asked);
    setRequest("");
    setFailure(null);
    try {
      const planned = await planLiveVideo(jobId, talk.brief, target, { request: asked, current: current(), asks: talk.asks.map((a) => a.ask) });
      onChange(planned, asked);
    } catch (err) {
      setFailure(err instanceof LiveError ? err.reason : "failed");
      // What was typed is not lost
      setRequest(asked);
    } finally {
      setBusy(null);
      setPending(null);
    }
  };

  // "Add all" takes what matches, not what is only close
  const fresh = results?.hits.filter((hit) => !isAdded(hit) && !isNear(hit)) ?? [];

  return (
    <aside
      aria-label={t("compilation.search")}
      // A conversation stays in view while the list of passages scrolls beside it
      className={`glass rounded-[20px] p-3 min-w-0 flex flex-col ${inTalk ? "flex-[1_1_400px] lg:sticky lg:top-[84px] self-start" : "flex-[1_1_400px]"}`}
    >
      <div role="tablist" className="seg">
        {(["describe", "search"] as const).map((key) => (
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
      ) : talking || planning ? (
        <PlanTalk
          brief={planning ? brief.trim() : talk!.brief}
          answer={planning ? undefined : talk!.answer}
          passages={planning ? undefined : talk!.passages}
          planning={planning}
          turns={planning ? [] : talk!.asks}
          pending={busy === "plan" ? pending : null}
          trail={trail}
          value={request}
          onValue={setRequest}
          onSend={change}
          disabled={!info?.transcript || (!!busy && busy !== "plan")}
          cost={planCost}
          onReveal={onReveal}
          onAnother={() => setAnother(true)}
          failure={failure ? t(`compilation.failure.${failure}`) : null}
        />
      ) : (
        <form className="mt-3" onSubmit={plan}>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={4}
            maxLength={MAX_BRIEF}
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
            {planCost && <span className="mono text-[11.5px] opacity-60">{planCost}</span>}
          </button>
          <p className="mt-2 px-0.5 text-[12px] leading-snug text-ink-3">{t(info && !info.transcript ? "compilation.noTranscript" : "compilation.describeHint")}</p>
          {!!talk && !!onChange && (
            <button type="button" onClick={() => setAnother(false)} className="btn btn-ghost btn-sm mt-1.5">
              {t("compilation.changeBack")}
            </button>
          )}
        </form>
      )}

      {asking && !inTalk && (
        <div role="status" aria-live="polite" className="mt-3 flex items-start gap-3 p-3 rounded-[12px] inset animate-fade-in">
          <Loader2 className="w-4 h-4 spinner text-accent flex-none mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] leading-snug text-white break-words">{stepText(t, step)}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
              {t(step?.step === "hearing" ? "compilation.aiHearing" : busy === "plan" ? "compilation.aiPlanning" : "compilation.aiReading")}
            </p>
          </div>
        </div>
      )}
      {tab === "describe" && !talking && planNote && !asking && <AiNote label={t("compilation.aiNote")} note={planNote} />}
      {failure && !(talking && tab === "describe") && !planning && (
        <p role="alert" className="mt-3 p-3 rounded-[12px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
          {t(`compilation.failure.${failure}`)}
        </p>
      )}

      {tab === "search" && results && (
        <div className="mt-3 pt-3 border-t border-white/[0.08] flex-1 min-h-0 flex flex-col">
          {results.note && <AiNote label={t("compilation.aiNote")} note={results.note} className="mb-2.5" />}
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
