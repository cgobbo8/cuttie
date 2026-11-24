import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowUp, Check, Clapperboard, Download, Eye, Lightbulb, Loader2, MessageSquarePlus, Music2, Palette, PenLine, Plus, ScanSearch, Scissors, Search, Timer, TriangleAlert, Trophy, X, Zap, type LucideIcon } from "lucide-react";
import type { AssistantMessage, AssistantPlace } from "../lib/api";
import { ASSISTANT_WIDTH, useAssistant } from "../lib/AssistantContext";
import { suggestionsFor, type Suggestion, type SuggestionIcon } from "../lib/assistantSuggestions";
import { clock } from "../lib/format";
import Composer from "./assistant/Composer";
import AssistantMark from "./assistant/Mark";
import Widget from "./assistant/Widgets";

/**
 * The assistant, docked on the right of the window for its whole height. The page beside it
 * is narrower by its width while it is open (see Layout): the two are side by side.
 *
 * One conversation: what the streamer asks, what the assistant did to answer (a line each),
 * its answer and what it shows, and its questions before anything that costs. Under it, what
 * it offers to do next: read from the page on screen and from its last answer.
 */

const ICONS: Record<SuggestionIcon, LucideIcon> = {
  analyse: ScanSearch,
  ideas: Lightbulb,
  build: Clapperboard,
  cut: Scissors,
  search: Search,
  music: Music2,
  opening: Zap,
  length: Timer,
  more: Plus,
  export: Download,
  best: Trophy,
  look: Palette,
};

/** Its words: paragraphs, and **what it stresses** */
function Words({ text }: { text: string }) {
  return (
    <>
      {text
        .trim()
        .split(/\n{2,}/)
        .map((paragraph, n) => (
          <p key={n} className="whitespace-pre-line">
            {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <b key={i} className="font-[600] text-white">
                  {part.slice(2, -2)}
                </b>
              ) : (
                <Fragment key={i}>{part}</Fragment>
              ),
            )}
          </p>
        ))}
    </>
  );
}

const Step = ({ children, done = true }: { children: ReactNode; done?: boolean }) => (
  <div className="flex items-start gap-[7px] text-[12px] leading-snug text-ink-3">
    {done ? <Check className="flex-none mt-[2px] w-3 h-3 text-accent" strokeWidth={2.6} /> : <Loader2 className="flex-none mt-[2px] w-3 h-3 spinner text-accent" />}
    <span className="min-w-0">{children}</span>
  </div>
);

export default function AssistantPanel() {
  const { t, i18n } = useTranslation();
  const { open, setOpen, messages, busy, doing, pending, send, approve, reset, place, composer, compose } = useAssistant();
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The last thing said stays in view
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, busy, doing.length, pending, open]);
  // Opened: ready to be typed in
  useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);
  // The box grows with what is typed, up to a few lines
  useLayoutEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "0px";
    box.style.height = `${Math.min(120, box.scrollHeight)}px`;
  }, [draft, open]);

  const say = (text: string) => {
    if (!text.trim() || busy) return;
    send(text);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      say(draft);
    }
  };

  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  /** What an answer cost: a fraction of a cent is said as such, never as « 0,00 $ » */
  const spent = (cost?: number) => (!cost ? null : cost < 0.01 ? `< ${dollars(0.01)}` : `≈ ${dollars(cost)}`);

  const crumbs = whereOf(place, t);
  const facts = factsOf(place, t);
  const last = messages?.[messages.length - 1];
  const waitsForYes = last?.role === "assistant" && last.action?.needs === "approval";
  const suggestions = useMemo(() => suggestionsFor(place, last), [place, last]);
  /** Something offered: sent as it is, or put in the box to be finished */
  const take = (suggestion: Suggestion) => {
    const words = t(`assistant.suggest.${suggestion.id}`, suggestion.params ?? {});
    if (!suggestion.fill) return say(words);
    setDraft(words.replace(/…$/, " ").replace(/\.\.\.$/, " "));
    window.requestAnimationFrame(() => {
      const box = input.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  };

  const answer = (message: AssistantMessage, isLast: boolean) => {
    const waits = isLast ? message.action : null;
    return (
      <div key={message.id} className="flex flex-col gap-[5px]">
        {(message.steps ?? []).map((step, n) => (
          <Step key={n}>{step}</Step>
        ))}
        {(message.reply ?? []).map((block, n) =>
          block.type === "text" ? (
            <div key={n} className="mt-1 text-[13.5px] leading-[1.5] text-ink flex flex-col gap-2">
              <Words text={block.text} />
            </div>
          ) : (
            <Widget key={n} block={block} />
          ),
        )}
        {message.failed && (
          <div className="mt-1 flex items-start gap-2 text-[13px] leading-snug text-ink-2">
            <TriangleAlert className="flex-none mt-0.5 w-3.5 h-3.5 text-warning" />
            <span>
              {t(`assistant.failed.${message.failed}`)}{" "}
              {(message.failed === "credits" || message.failed === "key") && (
                <Link to="/settings" className="text-accent hover:underline">
                  {t("assistant.failed.settings")}
                </Link>
              )}
            </span>
          </div>
        )}
        {waits?.needs === "approval" && !busy && (
          <div className="mt-1 p-3 rounded-[13px] bg-white/[0.05] border border-accent-line flex flex-col gap-2.5">
            <div>
              <b className="block text-[13px] font-[600] text-white">{waits.args.what === "analyse_live" ? t("assistant.approval.analyse") : String(waits.args.what ?? "")}</b>
              {waits.args.detail && <span className="block mt-0.5 text-[12.5px] text-ink-2">{String(waits.args.detail)}</span>}
              {Number(waits.args.cost) > 0 && (
                <span className="block mt-1 text-[12px] text-ink-3">
                  {t(waits.args.what === "analyse_live" ? "assistant.approval.analyseCost" : "assistant.approval.cost", { cost: dollars(Number(waits.args.cost)) })}
                </span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => approve(false)} className="btn btn-ghost btn-sm">
                {t("assistant.approval.no")}
              </button>
              <button onClick={() => approve(true)} className="btn btn-primary btn-sm">
                {t("assistant.approval.yes")}
              </button>
            </div>
          </div>
        )}
        {/* Something handed to the page that never came back (the app was closed meanwhile) */}
        {waits?.needs === "app" && !busy && <span className="text-[12px] text-ink-4">{t("assistant.interrupted")}</span>}
        {isLast && busy && !pending && (
          <>
            {doing.slice((message.steps ?? []).length).map((step, n) => (
              <Step key={`d${n}`} done={false}>
                {step}
              </Step>
            ))}
            {doing.length <= (message.steps ?? []).length && <Step done={false}>{t("assistant.thinking")}</Step>}
          </>
        )}
        {!message.action && !message.failed && spent(message.cost) && !(isLast && busy) && <span className="mono text-[10.5px] text-ink-4">{spent(message.cost)}</span>}
      </div>
    );
  };

  return (
    <aside
      aria-label={t("assistant.title")}
      aria-hidden={!open}
      // (closed: out of the window, and out of the way of the keyboard)
      inert={!open}
      // (beside the page on a wide window; over it, bars included, on a narrow one)
      style={{ ["--panel-w" as string]: `${ASSISTANT_WIDTH}px` }}
      className={`assistant-panel fixed z-50 lg:z-30 top-0 right-0 bottom-0 w-full lg:w-[var(--panel-w)] flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      <header className="relative flex-none h-[76px] pl-4 pr-3 flex items-center gap-3">
        <AssistantMark size={32} busy={busy} />
        <div className="flex-1 min-w-0">
          <h2 className="text-[15.5px] font-[650] tracking-[-0.015em] leading-tight text-white">{t("assistant.title")}</h2>
          {/* What it is doing, else what the streamer is looking at: what « this live », « this video », « this clip » mean */}
          <p title={busy ? undefined : t("assistant.whereHint")} className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-tight text-ink-3 cursor-default">
            {busy ? (
              <span className="truncate text-accent">{doing[doing.length - 1] ?? t("assistant.thinking")}</span>
            ) : crumbs.length > 0 ? (
              <>
                <Eye className="flex-none w-3 h-3" />
                <span className="truncate">{crumbs.join(" › ")}</span>
              </>
            ) : (
              <span className="truncate">{t("assistant.tagline")}</span>
            )}
          </p>
        </div>
        {!!messages?.length && (
          <button onClick={reset} disabled={busy} aria-label={t("assistant.new")} title={t("assistant.new")} className="btn btn-ghost btn-icon w-8 h-8 text-ink-3 hover:text-white disabled:opacity-40">
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => setOpen(false)} aria-label={t("assistant.close")} title={t("assistant.close")} className="btn btn-ghost btn-icon w-8 h-8 text-ink-3 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div ref={list} className="relative flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 [scrollbar-width:thin]">
        {messages === null ? (
          <Loader2 className="m-auto w-4 h-4 spinner text-ink-3" />
        ) : messages.length === 0 && !pending ? (
          // Nothing said yet: what it can see from here, and what it can do about it
          <div className="my-auto flex flex-col gap-4">
            <AssistantMark size={52} />
            <div>
              <p className="text-[21px] font-[680] tracking-[-0.025em] leading-[1.15] text-white">{t("assistant.helloTitle")}</p>
              <p className="mt-1.5 text-[13.5px] leading-[1.5] text-ink-2">{t("assistant.hello")}</p>
            </div>
            {(crumbs.length > 0 || facts.length > 0) && (
              <div className="p-3 rounded-[14px] bg-white/[0.045] border border-white/[0.08]">
                <p className="flex items-center gap-1.5 text-[11px] font-[600] uppercase tracking-[0.06em] text-ink-4">
                  <Eye className="w-3 h-3" /> {t("assistant.looking")}
                </p>
                <p className="mt-1.5 text-[13.5px] font-[600] leading-snug text-white">{crumbs[crumbs.length - 1]}</p>
                {crumbs.length > 1 && <p className="text-[12px] text-ink-3">{crumbs.slice(0, -1).join(" › ")}</p>}
                {facts.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {facts.map((fact) => (
                      <span key={fact} className="chip chip-neutral">
                        {fact}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((message, n) =>
              message.role === "user" ? (
                <div key={message.id} className="flex flex-col items-end gap-1">
                  <div className="assistant-said max-w-[88%] px-3 py-2 text-[13.5px] leading-[1.45] text-white whitespace-pre-line">{message.text}</div>
                  {!!message.where?.length && <span className="max-w-[88%] truncate text-[10.5px] text-ink-4">{message.where.join(" › ")}</span>}
                </div>
              ) : (
                answer(message, n === messages.length - 1)
              ),
            )}
            {pending && (
              <>
                <div className="flex justify-end">
                  <div className="assistant-said max-w-[88%] px-3 py-2 text-[13.5px] leading-[1.45] text-white whitespace-pre-line">{pending}</div>
                </div>
                <div className="flex flex-col gap-[5px]">
                  {doing.map((step, n) => (
                    <Step key={n} done={n < doing.length - 1}>
                      {step}
                    </Step>
                  ))}
                  {doing.length === 0 && <Step done={false}>{t("assistant.thinking")}</Step>}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="relative flex-none px-3 pb-3 flex flex-col gap-2">
        {/* A request the panel helps to write (passages to add): its own fields, in place of what it offers */}
        {composer && !waitsForYes && <Composer key={composer.kind} composer={composer} busy={busy} onSend={say} onClose={() => compose(null)} />}
        {/* What it offers to do from here: one tap, or a sentence to finish */}
        {!composer && !busy && !waitsForYes && suggestions.length > 0 && (
          <div className="flex flex-col gap-[5px]">
            {suggestions.map((suggestion) => {
              const Icon = ICONS[suggestion.icon];
              return (
                <button key={suggestion.id} onClick={() => take(suggestion)} className="assistant-ask group">
                  <span className="assistant-ask-icon">
                    <Icon className="w-[14px] h-[14px]" strokeWidth={2.2} />
                  </span>
                  <span className="flex-1 min-w-0 text-[12.5px] leading-snug text-ink-2 group-hover:text-white transition-colors">{t(`assistant.suggest.${suggestion.id}`, suggestion.params ?? {})}</span>
                  {suggestion.fill ? <PenLine className="flex-none w-3 h-3 text-ink-4" /> : suggestion.cost ? <span className="mono flex-none text-[10.5px] text-ink-4">≈ {dollars(suggestion.cost)}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        <label className="flex items-end gap-2 p-1.5 pl-3 rounded-[14px] bg-white/[0.06] border border-white/[0.1] focus-within:border-accent-line transition-colors">
          <textarea
            ref={input}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            maxLength={4000}
            placeholder={t("assistant.placeholder")}
            aria-label={t("assistant.placeholder")}
            className="flex-1 min-w-0 resize-none bg-transparent outline-none py-[5px] text-[13.5px] leading-[1.45] text-white placeholder:text-ink-4"
          />
          <button onClick={() => say(draft)} disabled={busy || !draft.trim()} aria-label={t("assistant.send")} className="flex-none w-[30px] h-[30px] rounded-[9px] grid place-items-center bg-accent text-accent-ink disabled:opacity-35 transition-opacity">
            {busy ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <ArrowUp className="w-4 h-4" strokeWidth={2.4} />}
          </button>
        </label>
      </div>
    </aside>
  );
}

type Say = (key: string, params?: Record<string, unknown>) => string;

/** Where the streamer is, in a few words: the page, or the live and what is open in it */
function whereOf(place: AssistantPlace | null, t: Say): string[] {
  if (!place) return [];
  const open = place.video?.name || place.clip?.name;
  if (!place.title) return [t(`assistant.page.${place.page}`)];
  return [place.title, ...(open ? [open] : [t(`assistant.page.${place.page}`)])];
}

/** What stands on that page, in a few short labels */
function factsOf(place: AssistantPlace | null, t: Say): string[] {
  const facts = place?.facts ?? {};
  const count = (key: string) => (typeof facts[key] === "number" ? (facts[key] as number) : 0);
  const said: string[] = [];
  if (place?.page === "live") {
    if (count("to_sort") > 0) said.push(t("assistant.fact.toSort", { count: count("to_sort") }));
    if (count("ideas") > 0) said.push(t("assistant.fact.ideas", { count: count("ideas") }));
    if (count("kept") > 0) said.push(t("assistant.fact.kept", { count: count("kept") }));
  } else if (place?.page === "edit" && place.video) {
    if (facts.waiting) said.push(t("assistant.fact.notBuilt"));
    else {
      said.push(`${t("assistant.fact.passages", { count: count("passages") })} · ${clock(count("seconds"))}`);
      if (!facts.music) said.push(t("assistant.fact.noMusic"));
      if (!facts.exported && count("passages") > 0) said.push(t("assistant.fact.notExported"));
    }
  } else if (place?.page === "export") {
    if (count("to_export") > 0) said.push(t("assistant.fact.toExport", { count: count("to_export") }));
  } else if (typeof facts.last_live === "string" && facts.last_live) {
    said.push(t("assistant.fact.lastLive", { name: facts.last_live }));
    if (!facts.last_live_analysed) said.push(t("assistant.fact.notAnalysed"));
  }
  return said;
}
