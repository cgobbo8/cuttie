import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Check, Loader2, Plus, Search, Sparkles } from "lucide-react";
import type { LiveSearchStep } from "../../lib/api";
import { stepText } from "../../lib/compilation";

const STEPS = ["find", "ai", "results", "build"] as const;
/** How fast the AI's steps follow each other in the second picture */
const ACT_EVERY = 950;
const TARGETS = [30, 60, 90, 180];

interface Props {
  open: boolean;
  /** Skipped or read to the end: either way it has been seen */
  onClose: () => void;
}

/** The Compilation screen explained on the first visit: four pictures made of the screen's own pieces */
export default function CompilationGuide({ open, onClose }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const key = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  // Enter goes on: the main button holds the focus on every step
  useEffect(() => {
    if (open) primary.current?.focus();
  }, [open, index]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(STEPS.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      else if (e.key === "Tab") {
        // The focus stays in the guide (its pictures are not part of it)
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []).filter((b) => !b.closest("[inert]"));
        if (buttons.length === 0) return;
        const first = buttons[0];
        const end = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && document.activeElement === end) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // On the page's root: the screen's own layer sits under the top bar, the guide covers both
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[6px] animate-fade-in" onClick={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
        className="relative glass-strong rounded-[24px] w-full max-w-[560px] max-h-[calc(100dvh-32px)] overflow-y-auto animate-rise"
      >
        <div aria-hidden inert className="h-[248px] px-6 grid place-items-center border-b border-white/[0.08] bg-black/40 overflow-hidden select-none">
          {/* Keyed by step: each picture plays its entrance again */}
          <div key={key} className="w-full max-w-[430px] animate-fade-in">
            {key === "find" && <FindPicture />}
            {key === "ai" && <AiPicture />}
            {key === "results" && <ResultsPicture />}
            {key === "build" && <BuildPicture />}
          </div>
        </div>

        {/* A tint of its own: the text stays readable whatever shows through the glass */}
        <div className="p-6 pt-5 bg-black/30">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((step, i) => (
              <span key={step} className={`flex-1 h-1 rounded-[2px] transition-colors duration-500 ${i <= index ? "bg-accent" : "bg-white/[0.14]"}`} />
            ))}
          </div>
          <p className="sr-only">{t("compilation.guide.progress", { step: index + 1, total: STEPS.length })}</p>
          <h2 id={`${id}-title`} className="mt-4 text-[21px] leading-tight tracking-[-0.02em] font-[650] text-white">
            {t(`compilation.guide.${key}.title`)}
          </h2>
          <p id={`${id}-text`} className="mt-2 min-h-[88px] text-[13.5px] leading-relaxed text-ink-2">
            {t(`compilation.guide.${key}.text`)}
          </p>
          <div className="mt-5 flex items-center gap-2">
            {!last && (
              <button type="button" onClick={onClose} className="btn btn-ghost btn-sm -ml-2">
                {t("compilation.guide.skip")}
              </button>
            )}
            <span className="flex-1" />
            {index > 0 && (
              <button type="button" onClick={() => setIndex(index - 1)} className="btn btn-glass">
                {t("compilation.guide.back")}
              </button>
            )}
            <button ref={primary} type="button" onClick={last ? onClose : () => setIndex(index + 1)} className="btn btn-primary">
              {t(last ? "compilation.guide.done" : "compilation.guide.next")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const later = (i: number) => ({ "--i": i }) as CSSProperties;

/** 1. The two ways to search: the words, or an idea given to the AI */
function FindPicture() {
  const { t } = useTranslation();
  const way = (label: string, hint: string, cost: string) => (
    <p className="mt-2 px-0.5 text-[11.5px] leading-snug text-ink-3">
      <span className="text-ink-2 font-[550]">{label}</span> : {hint}
      <span className="block text-ink-2">{cost}</span>
    </p>
  );
  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
        <div className="h-11 pl-9 pr-3 flex items-center rounded-[11px] bg-black/30 border border-accent-line text-[14px] text-white">
          {t("compilation.guide.sample.query")}
          <span className="ml-0.5 w-px h-[18px] bg-white/85 animate-pulse" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="animate-find" style={later(1)}>
          <span className="btn btn-primary btn-sm w-full">
            <Search className="w-3.5 h-3.5" /> {t("compilation.searchWords")}
          </span>
          {way(t("compilation.guide.sample.words"), t("compilation.guide.sample.wordsHint"), t("compilation.guide.sample.wordsCost"))}
        </div>
        <div className="animate-find" style={later(4)}>
          <span className="btn btn-glass btn-sm w-full">
            <Sparkles className="w-3.5 h-3.5 text-accent" /> {t("compilation.askAi")}
          </span>
          {way(t("compilation.guide.sample.idea"), t("compilation.guide.sample.ideaHint"), t("compilation.guide.sample.ideaCost"))}
        </div>
      </div>
    </div>
  );
}

/** 2. What the AI does while it searches, as the screen shows it live */
function AiPicture() {
  const { t } = useTranslation();
  const acts: LiveSearchStep[] = [
    { step: "best_moments", detail: "", count: 1 },
    { step: "search_speech", detail: t("compilation.guide.sample.searched"), count: 2 },
    { step: "chat_peaks", detail: "", count: 3 },
    { step: "find_sounds", detail: "scream", count: 4 },
    { step: "listen", detail: t("compilation.guide.sample.listenedAt"), count: 5 },
  ];
  const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // How many steps are on screen: one more each beat, a pause once all are done, then again
  const [beat, setBeat] = useState(still ? acts.length + 1 : 1);
  useEffect(() => {
    if (still) return;
    const timer = window.setInterval(() => setBeat((n) => (n > acts.length + 1 ? 1 : n + 1)), ACT_EVERY);
    return () => window.clearInterval(timer);
  }, [still, acts.length]);
  const shown = Math.min(beat, acts.length);
  return (
    <div>
      <ul className="inset rounded-[12px] px-3.5 py-3 min-h-[146px] flex flex-col gap-[7px]">
        {acts.slice(0, shown).map((act, i) => {
          const doing = i === shown - 1 && beat <= acts.length;
          return (
            <li key={act.step} className="flex items-center gap-2.5 text-[12.5px] leading-snug animate-fade-in">
              {doing ? <Loader2 className="w-3.5 h-3.5 spinner text-accent flex-none" /> : <Check className="w-3.5 h-3.5 text-accent flex-none" strokeWidth={2.6} />}
              <span className={doing ? "text-white" : "text-ink-3"}>{stepText(t, act)}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <span className="chip chip-neutral">{t("compilation.guide.sample.time")}</span>
        <span className="chip chip-neutral">{t("compilation.underCent")}</span>
        <span className="chip chip-accent">{t("compilation.guide.sample.firstTime")}</span>
      </div>
    </div>
  );
}

/** 3. What comes back: the AI's note, a passage that matches, one that is only close */
function ResultsPicture() {
  const { t } = useTranslation();
  const row = (i: number, time: string, text: string, why: ReactNode, near = false) => (
    <li className="flex items-center gap-2.5 p-1.5 pr-2 rounded-[11px] bg-white/[0.05] animate-find" style={later(i)}>
      <span className="w-[62px] aspect-video rounded-[7px] bg-gradient-to-br from-white/[0.16] to-white/[0.04] flex-none" />
      <span className="flex-1 min-w-0">
        <span className="block mono text-[10.5px] text-ink-3">{time}</span>
        <span className="block text-[12.5px] leading-snug text-white font-[550] truncate">{text}</span>
        <span className={`block text-[11.5px] leading-snug truncate ${near ? "text-ink-2" : "text-accent"}`}>{why}</span>
      </span>
      <span className="w-7 h-7 rounded-full grid place-items-center bg-white/10 text-white flex-none">
        <Plus className="w-3.5 h-3.5" strokeWidth={2.4} />
      </span>
    </li>
  );
  return (
    <div>
      <p className="flex gap-2 p-2.5 rounded-[11px] bg-accent-soft border border-accent-line/50 text-[12px] leading-snug text-ink-2">
        <Sparkles className="w-3.5 h-3.5 text-accent flex-none mt-0.5" />
        {t("compilation.guide.sample.note")}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {row(2, "3:25:41 · 12 s", t("compilation.guide.sample.sureText"), t("compilation.guide.sample.sureWhy"))}
        {row(
          5,
          "3:04:04 · 9 s",
          t("compilation.guide.sample.nearText"),
          <>
            <span className="mr-1.5 inline-block px-1.5 rounded-[6px] border border-white/15 text-[10.5px] text-ink-3">≈ {t("compilation.nearTag")}</span>
            {t("compilation.guide.sample.nearWhy")}
          </>,
          true,
        )}
      </ul>
    </div>
  );
}

/** 4. The video being built: parts, their passages, the length to fit */
function BuildPicture() {
  const { t } = useTranslation();
  const part = (i: number, title: string, length: string, lines: string[]) => (
    <div className="inset rounded-[12px] p-2.5 animate-find" style={later(i)}>
      <p className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-[600] text-white truncate">{title}</span>
        <span className="mono text-[10.5px] text-ink-3">{length}</span>
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lines.map((line) => (
          <li key={line} className="flex items-center gap-2">
            <span className="w-9 aspect-video rounded-[5px] bg-gradient-to-br from-white/[0.16] to-white/[0.04] flex-none" />
            <span className="text-[11.5px] leading-snug text-ink-2 truncate">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 items-start">
        {part(1, t("compilation.guide.sample.part1"), "0:12", [t("compilation.guide.sample.item1"), t("compilation.guide.sample.item2")])}
        {part(4, t("compilation.guide.sample.part2"), "0:16", [t("compilation.guide.sample.item3")])}
      </div>
      <div className="mt-3 flex items-center gap-3 animate-find" style={later(7)}>
        <div className="seg">
          {TARGETS.map((seconds) => (
            <button key={seconds} type="button" tabIndex={-1} aria-pressed={seconds === 30}>
              {t(`compilation.target.${seconds}`)}
            </button>
          ))}
        </div>
        <span className="mono text-[11.5px] text-ink-3 ml-auto">0:28 · {t("compilation.guide.sample.total")}</span>
      </div>
    </div>
  );
}
