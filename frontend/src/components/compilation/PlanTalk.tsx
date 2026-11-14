import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Check, Loader2, Minus, Plus, Sparkles } from "lucide-react";

export interface TalkTurn {
  ask: string;
  /** What the AI answered */
  note: string;
  /** Passages it added and took out */
  added?: number;
  removed?: number;
}

interface Props {
  /** What the streamer first described */
  brief: string;
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
export default function PlanTalk({ brief, turns, pending, trail, value, onValue, onSend, disabled, cost, onReveal, onAnother, failure }: Props) {
  const { t } = useTranslation();
  const thread = useRef<HTMLDivElement>(null);
  const busy = pending !== null;

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
      <div ref={thread} role="log" aria-label={t("compilation.changeTitle")} className="talk-thread flex flex-col gap-3 max-h-[340px] overflow-y-auto p-3">
        <Mine label={t("compilation.changeYou")} text={brief} folded />
        {turns.map((turn, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Mine label={t("compilation.changeAsk")} text={turn.ask} />
            <Theirs label={t("compilation.aiNote")}>
              <p className="text-[13px] leading-snug text-ink-2">{turn.note || t("compilation.changeNoNote")}</p>
              {(!!turn.added || !!turn.removed) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!!turn.added && (
                    <button type="button" onClick={() => onReveal?.(i)} className="talk-chip talk-chip-added" title={t("compilation.changeReveal")}>
                      <Plus className="w-3 h-3" strokeWidth={2.6} />
                      {t("compilation.changeAdded", { count: turn.added })}
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
            </Theirs>
          </div>
        ))}
        {busy && (
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

      <form
        className="talk-composer m-2 mt-0 flex items-end gap-2 rounded-[12px] border border-white/10 bg-black/35 p-1.5 pl-3 focus-within:border-accent-line transition-colors"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim() && !disabled && !busy) onSend();
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={key}
          rows={2}
          maxLength={4000}
          placeholder={t("compilation.changePlaceholder")}
          aria-label={t("compilation.changeTitle")}
          className="flex-1 min-w-0 py-1.5 bg-transparent text-[13.5px] leading-snug text-white outline-none placeholder:text-ink-3 resize-none"
        />
        <button type="submit" disabled={!value.trim() || disabled || busy} aria-label={t("compilation.changeButton")} title={t("compilation.changeButton")} className="talk-send flex-none">
          {busy ? <Loader2 className="w-4 h-4 spinner" /> : <ArrowUp className="w-4 h-4" strokeWidth={2.6} />}
        </button>
      </form>
      <div className="px-3 pb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
        <span>
          {t("compilation.changeEnter")}
          {cost && <span className="mono"> · {cost}</span>}
        </span>
        <button type="button" onClick={onAnother} disabled={busy} className="underline decoration-white/20 underline-offset-2 hover:text-ink-2 disabled:opacity-50">
          {t("compilation.changeNew")}
        </button>
      </div>
    </div>
  );
}

/** What the streamer wrote */
function Mine({ label, text, folded = false }: { label: string; text: string; folded?: boolean }) {
  return (
    <p
      className={`self-end max-w-[88%] px-3 py-2 rounded-[14px] rounded-br-[5px] bg-accent-soft border border-accent-line/40 text-[13px] leading-snug text-white whitespace-pre-line break-words ${folded ? "line-clamp-3" : ""}`}
      title={folded ? text : undefined}
    >
      <span className="sr-only">{label} : </span>
      {text}
    </p>
  );
}

/** What the AI answers, or what it is doing */
function Theirs({ label, working = false, children }: { label: string; working?: boolean; children: React.ReactNode }) {
  return (
    <div className="self-start max-w-[92%] flex gap-2">
      <span className={`talk-avatar flex-none ${working ? "talk-avatar-working" : ""}`} aria-hidden>
        <Sparkles className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0 px-3 py-2 rounded-[14px] rounded-tl-[5px] bg-white/[0.06] border border-white/[0.07]">
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
