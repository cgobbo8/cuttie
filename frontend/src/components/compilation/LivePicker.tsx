import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X } from "lucide-react";
import type { LiveCompilations } from "../../lib/api";
import { liveWhen, plainDate } from "../../lib/compilationLibrary";
import { hoursMinutes, splitVodTitle } from "../../lib/format";

interface Props {
  title: string;
  hint: string;
  /** The analysed lives to choose from */
  lives: LiveCompilations[];
  /** A live's picture */
  coverOf: (live: LiveCompilations) => string | null;
  /** Several lives can be ticked (a compilation that takes from all of them); else a click picks one */
  multiple?: boolean;
  /** Most lives that can be ticked */
  max?: number;
  /** The button under the list, for the lives ticked */
  confirm?: (count: number) => string;
  /** The lives picked, newest first */
  onPick: (jobIds: string[]) => void;
  onClose: () => void;
}

/** Choosing the live (or the lives) a compilation is made from */
export default function LivePicker({ title, hint, lives, coverOf, multiple = false, max = 5, confirm, onPick, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [ticked, setTicked] = useState<string[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sorted = [...lives].sort((a, b) => Date.parse(liveWhen(b) ?? "") - Date.parse(liveWhen(a) ?? ""));
  const toggle = (id: string) => setTicked((prev) => (prev.includes(id) ? prev.filter((other) => other !== id) : prev.length < max ? [...prev, id] : prev));
  // Picked in the order of the list (newest first), whatever the order they were ticked in
  const picked = sorted.filter((live) => ticked.includes(live.job_id)).map((live) => live.job_id);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative glass-strong rounded-[20px] p-5 w-full max-w-[540px] max-h-[80vh] flex flex-col animate-rise">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h3>
            <p className="mt-1 text-[13px] leading-snug text-ink-2">{hint}</p>
          </div>
          <button onClick={onClose} aria-label={t("common.cancel")} className="w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/10 flex-none">
            <X className="w-4 h-4" />
          </button>
        </div>
        {sorted.length === 0 ? (
          <p className="mt-4 text-[13px] text-ink-3">{t("compilations.noOtherLive")}</p>
        ) : (
          <ul className="mt-4 -mx-1.5 overflow-y-auto flex flex-col gap-0.5">
            {sorted.map((live) => {
              const on = ticked.includes(live.job_id);
              const when = liveWhen(live);
              return (
                <li key={live.job_id}>
                  <button
                    type="button"
                    role={multiple ? "checkbox" : undefined}
                    aria-checked={multiple ? on : undefined}
                    onClick={() => (multiple ? toggle(live.job_id) : onPick([live.job_id]))}
                    className={`w-full flex items-center gap-3 p-1.5 rounded-[12px] text-left transition-colors ${on ? "bg-accent-soft" : "hover:bg-white/[0.07]"}`}
                  >
                    {multiple && (
                      <span className={`w-[18px] h-[18px] rounded-[6px] grid place-items-center flex-none border ${on ? "bg-accent border-accent text-ground" : "border-white/25"}`}>
                        {on && <Check className="w-3 h-3" strokeWidth={3.2} />}
                      </span>
                    )}
                    <span className="w-[96px] aspect-video rounded-[8px] overflow-hidden flex-none bg-white/[0.05]">
                      {coverOf(live) && <img src={coverOf(live)!} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-[550] text-white truncate">{splitVodTitle(live.title).title || t("compilations.untitledLive")}</span>
                      <span className="block text-[12px] text-ink-3 truncate">
                        {[when ? plainDate(when, i18n.language) : null, live.game, live.duration ? hoursMinutes(live.duration) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {live.compilations.length > 0 && <span className="chip chip-neutral h-[22px] flex-none">{t("compilations.has", { count: live.compilations.length })}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {multiple && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-[12px] text-ink-3">{t("compilations.pickSeveral", { max })}</p>
            <button type="button" disabled={picked.length === 0} onClick={() => onPick(picked)} className="btn btn-primary btn-sm flex-none">
              {confirm ? confirm(picked.length) : t("compilation.new")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
