import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, Brain, Loader2, X } from "lucide-react";
import { applyNoteProposal, ignoreNoteProposal, listNoteProposals, type NoteProposal } from "../lib/api";
import { MEMORY_READ, NOTE_CHANGED, changedWords } from "../lib/aiMemory";
import { useToast } from "./Toast";

/**
 * After reading a live, the AI may find that a sentence of the streamer's own notes is no longer true
 * (« plays GTA every evening », five lives on another game). It never changes their notes itself: it asks,
 * here, with what it saw, the sentence as it is and what it would write instead. Applied, refused for good,
 * or left for later (it comes back the next time the app is opened).
 */
export default function NoteProposals() {
  const { t } = useTranslation();
  const toast = useToast();
  const id = useId();
  const { pathname } = useLocation();
  const [waiting, setWaiting] = useState<NoteProposal[]>([]);
  // Those put off for now: not asked again until the app is opened anew
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState<"apply" | "ignore" | null>(null);

  const load = useCallback(
    () =>
      listNoteProposals()
        .then(setWaiting)
        .catch(() => {}),
    [],
  );
  // On each page (a live may have been read since), when the window is looked at again, and as soon as a live is read
  useEffect(() => {
    load();
  }, [load, pathname]);
  useEffect(() => {
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener(MEMORY_READ, load);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener(MEMORY_READ, load);
    };
  }, [load]);

  const proposal = waiting.find((p) => !later.includes(p.id));
  const putOff = useCallback(() => proposal && !busy && setLater((ids) => [...ids, proposal.id]), [proposal, busy]);
  useEffect(() => {
    if (!proposal) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && putOff();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [proposal, putOff]);
  if (!proposal) return null;

  const answer = async (apply: boolean) => {
    setBusy(apply ? "apply" : "ignore");
    try {
      if (apply) {
        await applyNoteProposal(proposal.id);
        window.dispatchEvent(new Event(NOTE_CHANGED));
        toast.success(t("memory.proposal.applied", { title: proposal.note_title }));
      } else {
        await ignoreNoteProposal(proposal.id);
        toast.success(t("memory.proposal.ignored"));
      }
    } catch (err) {
      toast.error(t(err instanceof Error && err.message === "note_changed" ? "memory.proposal.changed" : "memory.proposal.failed"));
    } finally {
      setBusy(null);
      setWaiting((all) => all.filter((p) => p.id !== proposal.id));
    }
  };

  const { head, was, now, tail } = changedWords(proposal.before, proposal.after);
  const left = waiting.filter((p) => !later.includes(p.id)).length;

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={putOff} />
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="relative glass-strong rounded-[20px] p-5 w-full max-w-[520px] max-h-[calc(100dvh-48px)] overflow-y-auto animate-rise">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Brain className="w-3.5 h-3.5 text-accent" /> {t("memory.proposal.from")}
              {left > 1 && <span className="tabular-nums">· {t("memory.proposal.more", { count: left - 1 })}</span>}
            </p>
            <h3 id={`${id}-title`} className="mt-1 text-[16px] font-semibold tracking-[-0.01em] text-white">
              {t("memory.proposal.title", { title: proposal.note_title })}
            </h3>
          </div>
          <button type="button" onClick={putOff} aria-label={t("memory.proposal.later")} title={t("memory.proposal.later")} className="flex-none w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/[0.07] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {proposal.why && <p className="mt-2.5 text-[13.5px] leading-[1.5] text-ink-2">{proposal.why}</p>}

        <div className="mt-4">
          <p className="pb-1 text-[11.5px] text-ink-3">{t("memory.proposal.before")}</p>
          <p className="rounded-[11px] border border-white/[0.09] bg-black/25 px-3 py-2.5 text-[13px] leading-[1.55] text-ink-2 whitespace-pre-wrap">
            {head}
            {was && <del className="rounded-[4px] bg-[#ff8a7a]/[0.16] text-[#ffb3a8] decoration-[#ff8a7a]/70">{was}</del>}
            {tail}
          </p>
          <ArrowDown className="mx-auto my-1.5 w-3.5 h-3.5 text-ink-4" />
          <p className="pb-1 text-[11.5px] text-ink-3">{t("memory.proposal.after")}</p>
          <p className="rounded-[11px] border border-accent-line bg-accent-soft px-3 py-2.5 text-[13px] leading-[1.55] text-white whitespace-pre-wrap">
            {head}
            {now && <ins className="rounded-[4px] bg-white/[0.14] no-underline">{now}</ins>}
            {tail}
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={() => answer(false)} disabled={!!busy} className="btn btn-ghost">
            {busy === "ignore" && <Loader2 className="w-3.5 h-3.5 spinner" />} {t("memory.proposal.ignore")}
          </button>
          <button type="button" onClick={() => answer(true)} disabled={!!busy} className="btn btn-primary" autoFocus>
            {busy === "apply" && <Loader2 className="w-3.5 h-3.5 spinner" />} {t("memory.proposal.apply")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
