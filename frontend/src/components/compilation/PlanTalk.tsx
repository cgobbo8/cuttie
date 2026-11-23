import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Brain, Check, Loader2, Minus, Plus, RotateCcw, Scissors, Sparkles } from "lucide-react";
import { Virality } from "./SuggestionCard";

export interface TalkTurn {
  ask: string;
  /** What the AI answered */
  note: string;
  /** Passages it added and took out */
  added?: number;
  removed?: number;
  /** Passages it cut otherwise (tighter, longer) */
  recut?: number;
  /** Lasting tastes the streamer stated in this request, that the AI noted in its memory for their next videos */
  remembered?: string[];
}

/** A video the AI proposed and nobody has had built yet: what it noticed, and the way to have it built */
export interface Proposal {
  pitch: string;
  tags: string[];
  /** 0-100: how well it should do as a short */
  score: number;
  /** About what building it costs, "≈ 0,04 $" */
  cost: string | null;
  /** It can't be built right now (no transcript, something else running) */
  disabled: boolean;
  onBuild: () => void;
  /** Rewrite the request before having it built */
  onEdit: () => void;
}

interface Props {
  /** What the streamer first described (or what the AI wrote in their place, see `byAi`) */
  brief: string;
  /** The video is one the AI proposed: the first request is its own, written as the streamer would have */
  byAi?: boolean;
  /** Who wrote it, when that isn't « the AI in your place » (a clip of the analysis: what the analysis saw) */
  wrote?: string;
  /** What can be asked, by example, when the video isn't a compilation (a clip: « coupe le début ») */
  example?: string;
  /** ...and it is not built yet: the AI says what it noticed and offers to build it */
  proposal?: Proposal | null;
  /** The answer on screen is one the AI kept from a time before (nothing was searched, nothing spent): ask it again */
  again?: { cost: string | null; disabled: boolean; onAgain: () => void } | null;
  /** What the AI answered to it: what it built and why (absent on videos made before it was kept) */
  answer?: string;
  /** Passages in the video now */
  passages?: number;
  /** The video is being built from the description: what the AI does shows as its answer */
  planning?: boolean;
  /** Each change asked since, with the AI's answer */
  turns: TalkTurn[];
  /** The change being worked on, and what the AI has done for it so far (one line per step, the last one in progress) */
  pending: string | null;
  trail: string[];
  /** The request being typed */
  value: string;
  onValue: (value: string) => void;
  onSend: () => void;
  /** The AI can't be asked right now (no transcript, something else running) */
  disabled: boolean;
  /** About what a change costs, "≈ 0,04 $" */
  cost: string | null;
  /** Light up in the video the passages a turn added */
  onReveal?: (turn: number) => void;
  /** Describe a new video instead */
  onAnother: () => void;
  /** What went wrong with the last request, in words */
  failure?: string | null;
}

/** Steps of the AI shown while it works: the last ones, the older ones fold away */
const SHOWN_STEPS = 4;

/**
 * The conversation about a video the AI planned: what was described, each
 * change asked and what the AI did about it, what it is doing right now, and
 * where to ask for the next one. What it adds shows up in the video beside.
 */
export default function PlanTalk({ brief, byAi = false, wrote, example, proposal = null, again = null, answer, passages, planning = false, turns, pending, trail, value, onValue, onSend, disabled, cost, onReveal, onAnother, failure }: Props) {
  const { t } = useTranslation();
  const thread = useRef<HTMLDivElement>(null);
  const busy = pending !== null || planning;

  // The newest message stays in view
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns.length, pending, trail.length, failure]);

  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim() && !disabled && !busy) onSend();
    }
  };

  const steps = trail.slice(-SHOWN_STEPS);
  return (
    <div className="mt-3 flex flex-col rounded-[14px] border border-white/[0.08] bg-black/20 overflow-hidden">
      <div ref={thread} role="log" aria-label={t("compilation.changeTitle")} className="talk-thread flex flex-col gap-3.5 h-[max(360px,calc(100dvh-390px))] overflow-y-auto p-4">
        {byAi && (
          <p className="self-end -mb-2 flex items-center gap-1.5 text-[11.5px] text-accent">
            <Sparkles className="w-3 h-3" /> {wrote ?? t("suggestions.wrote")}
          </p>
        )}
        <Mine label={byAi ? (wrote ?? t("suggestions.wrote")) : t("compilation.changeYou")} text={brief} folded={!proposal} />
        {proposal && !planning && (
          <Theirs label={t("compilation.aiNote")}>
            <div className="flex items-start gap-3">
              <p className="flex-1 min-w-0 text-[13.5px] leading-[1.45] text-ink-2">
                <span className="text-white">{t("suggestions.noticed")}</span> {proposal.pitch}
              </p>
              <Virality score={proposal.score} size={42} />
            </div>
            {proposal.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {proposal.tags.map((tag) => (
                  <span key={tag} className="talk-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <button type="button" onClick={proposal.onBuild} disabled={proposal.disabled} className="btn btn-primary btn-sm">
                <Sparkles className="w-3.5 h-3.5" /> {t("suggestions.build")}
                {proposal.cost && <span className="mono text-[11.5px] opacity-60">{proposal.cost}</span>}
              </button>
              <button type="button" onClick={proposal.onEdit} disabled={proposal.disabled} className="text-[12px] text-ink-3 underline decoration-white/20 underline-offset-2 hover:text-ink-2 disabled:opacity-50">
                {t("suggestions.edit")}
              </button>
            </div>
            <p className="mt-2 text-[12px] leading-snug text-ink-3">{t("suggestions.buildHint", { cost: proposal.cost ?? "" })}</p>
          </Theirs>
        )}
        {planning && (
          <Theirs label={t("compilation.aiNote")} working>
            <ol role="status" aria-live="polite" className="flex flex-col gap-1.5">
              {steps.length === 0 && <Step text={t("compilation.step.thinking")} doing />}
              {steps.map((text, i) => (
                <Step key={`${trail.length - steps.length + i}-${text}`} text={text} doing={i === steps.length - 1} />
              ))}
            </ol>
          </Theirs>
        )}
        {!planning && answer && (
          <Theirs label={t("compilation.aiNote")}>
            <p className="text-[13.5px] leading-[1.45] text-ink-2 whitespace-pre-line">{answer}</p>
            {!!passages && turns.length === 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="talk-chip">{t("compilation.changePassages", { count: passages })}</span>
              </div>
            )}
            {/* Nothing was searched: the same description had been answered before. One click has the AI search again */}
            {again && turns.length === 0 && (
              <div className="mt-2.5 pt-2.5 border-t border-white/[0.08] flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="flex-1 min-w-[160px] text-[12px] leading-snug text-ink-3">{t("compilation.keptAnswer")}</span>
                <button type="button" onClick={again.onAgain} disabled={again.disabled} title={t("compilation.askAgainHint")} className="btn btn-glass btn-sm flex-none">
                  <RotateCcw className="w-3.5 h-3.5" /> {t("compilation.askAgain")}
                  {again.cost && <span className="mono text-[11.5px] text-ink-3">{again.cost}</span>}
                </button>
              </div>
            )}
          </Theirs>
        )}
        {turns.map((turn, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Mine label={t("compilation.changeAsk")} text={turn.ask} />
            <Theirs label={t("compilation.aiNote")}>
              <p className="text-[13.5px] leading-[1.45] text-ink-2">{turn.note || t("compilation.changeNoNote")}</p>
              {(!!turn.added || !!turn.removed || !!turn.recut) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!!turn.added && (
                    <button type="button" onClick={() => onReveal?.(i)} className="talk-chip talk-chip-added" title={t("compilation.changeReveal")}>
                      <Plus className="w-3 h-3" strokeWidth={2.6} />
                      {t("compilation.changeAdded", { count: turn.added })}
                    </button>
                  )}
                  {!!turn.recut && (
                    <button type="button" onClick={() => onReveal?.(i)} className="talk-chip talk-chip-added" title={t("compilation.changeReveal")}>
                      <Scissors className="w-3 h-3" strokeWidth={2.4} />
                      {t("compilation.changeRecut", { count: turn.recut })}
                    </button>
                  )}
                  {!!turn.removed && (
                    <span className="talk-chip">
                      <Minus className="w-3 h-3" strokeWidth={2.6} />
                      {t("compilation.changeRemoved", { count: turn.removed })}
                    </span>
                  )}
                </div>
              )}
              {/* « I don't like it when you... »: what the AI keeps of it for the next videos (Ma chaîne, « Mémoire ») */}
              {turn.remembered?.map((said) => (
                <p key={said} className="mt-2 flex items-start gap-1.5 text-[12px] leading-[1.4] text-accent">
                  <Brain className="w-3.5 h-3.5 flex-none mt-px" />
                  <span>{t("memory.rememberedLine", { said })}</span>
                </p>
              ))}
            </Theirs>
          </div>
        ))}
        {pending !== null && (
          <div className="flex flex-col gap-3 animate-fade-in">
            <Mine label={t("compilation.changeAsk")} text={pending!} />
            <Theirs label={t("compilation.aiNote")} working>
              <ol role="status" aria-live="polite" className="flex flex-col gap-1.5">
                {steps.length === 0 && <Step text={t("compilation.step.thinking")} doing />}
                {steps.map((text, i) => (
                  <Step key={`${trail.length - steps.length + i}-${text}`} text={text} doing={i === steps.length - 1} />
                ))}
              </ol>
            </Theirs>
          </div>
        )}
        {failure && !busy && (
          <p role="alert" className="self-start max-w-[92%] px-3 py-2 rounded-[12px] bg-[rgba(245,177,76,0.10)] border border-[rgba(245,177,76,0.30)] text-[12.5px] leading-snug text-[#f7d9a8]">
            {failure}
          </p>
        )}
      </div>

      {/* A change is asked on a video: one that is not built yet has nothing to change */}
      <form
        hidden={!!proposal}
        className={`talk-composer m-3 mt-0 items-end gap-2 rounded-[14px] border border-white/10 bg-black/35 p-2 pl-3.5 focus-within:border-accent-line transition-colors ${proposal ? "" : "flex"}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !disabled && !busy) onSend();
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={key}
          rows={3}
          maxLength={4000}
          placeholder={t("compilation.changePlaceholder")}
          aria-label={t("compilation.changeTitle")}
          className="flex-1 min-w-0 py-1 bg-transparent text-[14px] leading-[1.45] text-white outline-none placeholder:text-ink-3 resize-none"
        />
        <button type="submit" disabled={!value.trim() || disabled || busy} aria-label={t("compilation.changeButton")} title={t("compilation.changeButton")} className="talk-send flex-none">
          {busy ? <Loader2 className="w-4 h-4 spinner" /> : <ArrowUp className="w-4 h-4" strokeWidth={2.6} />}
        </button>
      </form>
      <div hidden={!!proposal} className={`px-4 pb-3 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] text-ink-3 ${proposal ? "" : "flex"}`}>
        <span>
          {example ?? t("compilation.changeEnter")}
          {cost && <span className="mono"> · {cost}</span>}
        </span>
        <button type="button" onClick={onAnother} disabled={busy} className="underline decoration-white/20 underline-offset-2 hover:text-ink-2 disabled:opacity-50">
          {t("compilation.changeNew")}
        </button>
      </div>
    </div>
  );
}

/** Lines of a long first description shown before it is unfolded */
const FOLD_OVER = 220;

/** What the streamer wrote. `folded`: a long text shows its first lines, and unfolds when clicked */
function Mine({ label, text, folded = false }: { label: string; text: string; folded?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = folded && text.length > FOLD_OVER;
  return (
    <div className="self-end max-w-[85%] px-3.5 py-2.5 rounded-[16px] rounded-br-[5px] bg-accent-soft border border-accent-line/40 text-[13.5px] leading-[1.45] text-white">
      <span className="sr-only">{label} : </span>
      {/* The clamp sits on the text itself: on the padded box, half a line would show under the last one */}
      <p className={`whitespace-pre-line break-words ${long && !open ? "line-clamp-3" : ""}`}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-[12px] text-ink-2 underline decoration-white/25 underline-offset-2 hover:text-white">
          {t(open ? "compilation.changeFold" : "compilation.changeUnfold")}
        </button>
      )}
    </div>
  );
}

/** What the AI answers, or what it is doing */
function Theirs({ label, working = false, children }: { label: string; working?: boolean; children: React.ReactNode }) {
  return (
    <div className="self-start max-w-[90%] flex gap-2.5">
      <span className={`talk-avatar flex-none ${working ? "talk-avatar-working" : ""}`} aria-hidden>
        <Sparkles className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 px-3.5 py-2.5 rounded-[16px] rounded-tl-[5px] bg-white/[0.06] border border-white/[0.07]">
        <span className="sr-only">{label} : </span>
        {children}
      </div>
    </div>
  );
}

/** One thing the AI did (or is doing) for the request */
function Step({ text, doing = false }: { text: string; doing?: boolean }) {
  return (
    <li className={`talk-step flex items-start gap-2 text-[12.5px] leading-snug ${doing ? "text-white" : "text-ink-3"}`}>
      {doing ? <Loader2 className="w-3.5 h-3.5 spinner text-accent flex-none mt-px" /> : <Check className="w-3.5 h-3.5 text-accent/70 flex-none mt-px" strokeWidth={2.4} />}
      <span className="min-w-0 break-words">{text}</span>
    </li>
  );
}
