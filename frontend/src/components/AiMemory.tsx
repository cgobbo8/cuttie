import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { BookOpen, Brain, Check, Loader2, Pencil, Square, Trash2, X } from "lucide-react";
import { MEMORY_SECTIONS, clearMemory, getMemory, readLivesIntoMemory, saveMemory, stopReadingLives, type AiMemory, type MemoryLive, type MemorySection } from "../lib/api";
import { MEMORY_READ, eventParts, isEmptyMemory, liveDay, memoryLines, readingOutcome } from "../lib/aiMemory";
import { aboutCost } from "../lib/format";
import ConfirmModal from "./ConfirmModal";
import { useToast } from "./Toast";

const MAX_SECTION = 3000;
/** How often the window asks where the reading of the earlier lives is, ms */
const POLL = 1500;

/** One section of the memory: its lines, and a pencil to correct them */
function Section({ name, text, saving, onSave }: { name: MemorySection; text: string; saving: boolean; onSave: (text: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const lines = memoryLines(text);
  const title = t(`memory.section.${name}`);

  return (
    <section className="group py-3.5 first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-white">{title}</h4>
        {draft === null && (
          <button
            type="button"
            onClick={() => setDraft(text)}
            aria-label={t("memory.editSection", { section: title })}
            className="w-7 h-7 grid place-items-center rounded-[8px] text-ink-4 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-white hover:bg-white/[0.07] transition"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {draft === null ? (
        lines.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {lines.map((line, i) => (
              <li key={i} className="relative pl-3.5 text-[13px] leading-[1.5] text-ink-2 before:absolute before:left-0 before:top-[0.62em] before:w-1 before:h-1 before:rounded-full before:bg-accent">
                {line}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12.5px] text-ink-4">{t("memory.nothing")}</p>
        )
      ) : (
        <form
          className="mt-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSave(draft)) setDraft(null);
          }}
        >
          <textarea
            value={draft}
            maxLength={MAX_SECTION}
            autoFocus
            aria-label={title}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="block w-full h-[150px] px-3 py-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] leading-[1.55] text-white outline-none focus:border-accent-line resize-y"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} disabled={saving} className="btn btn-ghost btn-sm">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary btn-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Check className="w-3.5 h-3.5" />} {t("common.save")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** What the AI noted of one live: the day, what it was, what happened in it, who was there */
function Live({ live }: { live: MemoryLive }) {
  const { t, i18n } = useTranslation();
  return (
    <article className="py-3.5 first:pt-0 last:pb-0">
      <p className="text-[12px] text-ink-3">
        {[liveDay(live.date, i18n.language), live.game].filter(Boolean).join(" · ")}
        {live.source === "analysis" && <span title={t("memory.live.fromAnalysisHint")}> · {t("memory.live.fromAnalysis")}</span>}
      </p>
      <h4 className="mt-0.5 text-[13.5px] font-[550] text-white">{live.title}</h4>
      <p className="mt-1 text-[13px] leading-[1.5] text-ink-2">{live.summary}</p>
      {live.events.length > 0 && (
        <ul className="mt-2 space-y-1">
          {live.events.map((event, i) => {
            const { at, text } = eventParts(event);
            return (
              <li key={i} className="flex gap-2 text-[12.5px] leading-[1.5] text-ink-2">
                <span className="flex-none w-[52px] pt-px text-right tabular-nums text-[11.5px] text-ink-4">{at ?? "·"}</span>
                <span>{text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {live.people.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {live.people.map((person) => (
            <span key={person.name} title={person.who} className="h-6 px-2 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] text-[11.5px] text-ink-2">
              {person.name}
            </span>
          ))}
        </div>
      )}
      {live.said.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-ink-3">
          {t("memory.live.said")} {live.said.join(" · ")}
        </p>
      )}
    </article>
  );
}

/**
 * Everything the AI remembers of the streamer: what it knows (five sections it rewrites after each live,
 * each one correctable), and what it noted of every live it read. From here the streamer has it read the
 * lives analysed before (the price is on the button), stops it from reading the next ones, or wipes it.
 */
function MemoryWindow({ memory, onChange, onClose }: { memory: AiMemory; onChange: (next: AiMemory) => void; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const id = useId();
  const [tab, setTab] = useState<"knows" | "lives">("knows");
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [starting, setStarting] = useState(false);
  const wasReading = useRef(!!memory.reading);

  const refresh = useCallback(() => getMemory().then(onChange), [onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !clearing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, clearing]);

  // While the AI reads the earlier lives, the window follows it; when it is done, it says how it went
  const reading = memory.reading;
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => refresh().catch(() => {}), POLL);
    return () => clearInterval(timer);
  }, [!!reading, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wasReading.current && !reading && memory.last) {
      const { key, ok } = readingOutcome(memory.last);
      (ok ? toast.success : toast.error)(t(`memory.read.${key}`, { count: memory.last.read, failed: memory.last.failed }));
      // What it read may contradict one of the streamer's notes: the app asks them now
      window.dispatchEvent(new Event(MEMORY_READ));
    }
    wasReading.current = !!reading;
  }, [reading, memory.last]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSection = async (name: MemorySection, text: string) => {
    setSaving(true);
    try {
      onChange({ ...memory, ...(await saveMemory({ sections: { [name]: text } })) });
      toast.success(t("memory.saved"));
      return true;
    } catch {
      toast.error(t("memory.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const setPaused = async (paused: boolean) => {
    try {
      onChange({ ...memory, ...(await saveMemory({ paused })) });
      toast.success(t(paused ? "memory.pausedDone" : "memory.resumedDone"));
    } catch {
      toast.error(t("memory.saveFailed"));
    }
  };
  const read = async () => {
    setStarting(true);
    try {
      wasReading.current = true;
      onChange({ ...memory, reading: await readLivesIntoMemory() });
    } catch {
      toast.error(t("memory.read.unreachable"));
    } finally {
      setStarting(false);
    }
  };
  const stop = async () => {
    try {
      await stopReadingLives();
      onChange({ ...memory, reading: reading ? { ...reading, stopping: true } : null });
    } catch {
      toast.error(t("memory.saveFailed"));
    }
  };
  const clear = async () => {
    setSaving(true);
    try {
      await clearMemory();
      await refresh();
      setClearing(false);
      toast.success(t("memory.cleared"));
    } catch {
      toast.error(t("memory.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const empty = isEmptyMemory(memory);
  const unread = memory.unread.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={() => !clearing && onClose()} />
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="relative glass-strong rounded-[20px] w-full max-w-[680px] max-h-[calc(100dvh-48px)] flex flex-col animate-rise">
        <header className="flex-none p-5 pb-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id={`${id}-title`} className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em] text-white">
                <Brain className="w-[18px] h-[18px] text-accent" /> {t("memory.title")}
              </h3>
              <p className="mt-0.5 text-[12.5px] text-ink-3">{t("memory.hint")}</p>
            </div>
            <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex-none w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/[0.07] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Lives analysed before the memory existed (or while it was paused): read when asked, the price said first */}
          {reading ? (
            <div className="mt-4 rounded-[12px] border border-white/[0.09] bg-black/25 p-3" role="status">
              <div className="flex items-center gap-2.5">
                <Loader2 className="w-4 h-4 flex-none spinner text-accent" />
                <p className="flex-1 min-w-0 truncate text-[13px] text-white">{reading.stopping ? t("memory.stopping") : t("memory.reading", { title: reading.title })}</p>
                <span className="flex-none tabular-nums text-[12px] text-ink-3">
                  {Math.min(reading.done + 1, reading.total)} / {reading.total}
                </span>
                {!reading.stopping && (
                  <button type="button" onClick={stop} className="btn btn-ghost btn-sm flex-none">
                    <Square className="w-3 h-3" /> {t("memory.stop")}
                  </button>
                )}
              </div>
              <div className="mt-2.5 h-1 rounded-full bg-white/[0.08] overflow-hidden">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((100 * reading.done) / Math.max(1, reading.total))}%` }} />
              </div>
            </div>
          ) : (
            unread > 0 && (
              <div className="mt-4 rounded-[12px] border border-white/[0.09] bg-black/25 p-3 flex items-center gap-3">
                <BookOpen className="w-4 h-4 flex-none text-accent" />
                <p className="flex-1 min-w-0 text-[13px] text-ink-2">{t("memory.unread", { count: unread })}</p>
                <button type="button" onClick={read} disabled={starting} className="btn btn-primary btn-sm flex-none">
                  {starting && <Loader2 className="w-3.5 h-3.5 spinner" />} {t("memory.readThem", { count: unread })} · {aboutCost(memory.cost, i18n.language)}
                </button>
              </div>
            )
          )}

          <div role="tablist" aria-label={t("memory.title")} className="seg mt-4">
            <button type="button" role="tab" aria-selected={tab === "knows"} onClick={() => setTab("knows")}>
              {t("memory.tab.knows")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "lives"} onClick={() => setTab("lives")}>
              {t("memory.tab.lives", { count: memory.lives.length })}
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {empty ? (
            <p className="py-10 text-center text-[13px] text-ink-3">{t(unread > 0 || reading ? "memory.emptyUnread" : "memory.empty")}</p>
          ) : tab === "knows" ? (
            <div className="divide-y divide-white/[0.07]">
              {MEMORY_SECTIONS.map((name) => (
                <Section key={name} name={name} text={memory.sections[name]} saving={saving} onSave={(text) => saveSection(name, text)} />
              ))}
            </div>
          ) : memory.lives.length > 0 ? (
            <div className="divide-y divide-white/[0.07]">
              {memory.lives.map((live) => (
                <Live key={live.job} live={live} />
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[13px] text-ink-3">{t("memory.noLives")}</p>
          )}
        </div>

        <footer className="flex-none px-5 py-3.5 border-t border-white/[0.07] flex items-center gap-3">
          <button role="switch" aria-checked={!memory.paused} aria-label={t("memory.auto")} onClick={() => setPaused(!memory.paused)} className="switch flex-none">
            <span />
          </button>
          <span className="flex-1 min-w-0 text-[12.5px] text-ink-2">{t("memory.auto")}</span>
          <button type="button" onClick={() => setClearing(true)} disabled={empty || !!reading} className="btn btn-ghost btn-sm text-[#ff8a7a]">
            <Trash2 className="w-3.5 h-3.5" /> {t("memory.clear")}
          </button>
        </footer>
      </div>
      <ConfirmModal open={clearing} title={t("memory.clearTitle")} message={t("memory.clearMessage")} confirmLabel={t("memory.clear")} loading={saving} onConfirm={clear} onCancel={() => setClearing(false)} />
    </div>
  );
}

/**
 * The way into the AI's memory, on the card of the notes (« Ce que l'IA sait de toi »): the notes are what the
 * streamer writes for the AI, the memory is what the AI writes for itself after each live. The button says how
 * many lives it has read.
 */
export default function MemoryButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const [memory, setMemory] = useState<AiMemory | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    getMemory()
      .then(setMemory)
      .catch(() => {});
  }, []);

  const show = async () => {
    setOpen(true);
    try {
      setMemory(await getMemory());
    } catch {
      if (!memory) {
        setOpen(false);
        toast.error(t("memory.loadFailed"));
      }
    }
  };
  const read = memory?.lives.length ?? 0;

  return (
    <>
      <button type="button" onClick={show} className="btn btn-glass btn-sm flex-none">
        <Brain className="w-3.5 h-3.5 text-accent" /> {t("memory.button")}
        {read > 0 && <span className="ml-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full bg-white/[0.12] text-[11px] tabular-nums text-ink-2">{read}</span>}
      </button>
      {/* Over the whole page, not inside the card: a blurred card holds what is "fixed" inside it */}
      {open && memory && createPortal(<MemoryWindow memory={memory} onChange={setMemory} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
