import { useTranslation } from "react-i18next";
import { Sparkles, X } from "lucide-react";
import { ASSISTANT_WIDTH, useAssistant } from "../lib/AssistantContext";

/**
 * The assistant, docked on the right of the window for its whole height. The page beside it
 * is narrower by its width while it is open (see Layout): the two are side by side.
 */
export default function AssistantPanel() {
  const { t } = useTranslation();
  const { open, setOpen, setSlot, filled } = useAssistant();
  return (
    <aside
      aria-label={t("assistant.title")}
      aria-hidden={!open}
      // (closed: out of the window, and out of the way of the keyboard)
      inert={!open}
      style={{ width: ASSISTANT_WIDTH }}
      className={`assistant-panel fixed z-30 top-0 right-0 bottom-0 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-x-0" : "translate-x-full"}`}
    >
      <header className="flex-none h-[72px] px-4 flex items-center gap-2.5">
        <span className="w-7 h-7 rounded-[9px] grid place-items-center bg-accent text-accent-ink">
          <Sparkles className="w-[15px] h-[15px]" strokeWidth={2.2} />
        </span>
        <h2 className="flex-1 min-w-0 text-[15.5px] font-[620] tracking-[-0.01em] text-white">{t("assistant.title")}</h2>
        <button onClick={() => setOpen(false)} aria-label={t("assistant.close")} title={t("assistant.close")} className="btn btn-ghost btn-icon w-8 h-8 text-ink-3 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </header>
      {/* What the page on screen puts here */}
      <div ref={setSlot} className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 flex flex-col" />
      {filled === 0 && (
        <div className="absolute inset-x-0 top-[72px] bottom-0 px-6 grid place-items-center pointer-events-none">
          <p className="max-w-[30ch] text-center text-[13.5px] leading-relaxed text-ink-3">{t("assistant.empty")}</p>
        </div>
      )}
    </aside>
  );
}
