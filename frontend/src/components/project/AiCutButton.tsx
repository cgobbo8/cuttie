import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Loader2, RotateCcw, WandSparkles } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { CUT_TARGETS, type CutTarget } from "../../lib/cutTarget";

interface Props {
  /** The AI is cutting this clip */
  busy: boolean;
  /** Nothing to cut from (the clip has no words yet), or another clip is being cut */
  disabled: boolean;
  /** The length its montage aims for (null: left to the AI) */
  target: CutTarget;
  onTarget: (target: CutTarget) => void;
  onCut: () => void;
  /** Back to the cut the analysis advised, when the clip is cut otherwise */
  onReset?: () => void;
  /** Several passages are picked: it cuts each of them */
  many?: boolean;
}

/**
 * Everything the AI does to a clip's cut, in one control: the button cuts, and what hangs
 * from it says how long (its menu), and takes the cut back to the one the analysis advised.
 */
export default function AiCutButton({ busy, disabled, target, onTarget, onCut, onReset, many = false }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const length = (value: CutTarget) => (value === null ? t("project.cutTarget.free") : t(`project.cutTarget.${value}`));
  const option = (value: CutTarget) => (
    <button
      key={value ?? "free"}
      type="button"
      role="menuitemradio"
      aria-checked={value === target}
      onClick={() => {
        onTarget(value);
        setOpen(false);
      }}
      className={`w-full h-8 px-2.5 rounded-[8px] flex items-center gap-2 text-left text-[13px] transition-colors ${value === target ? "bg-accent-soft text-white" : "text-ink-2 hover:bg-white/[0.07]"}`}
    >
      <span className="flex-1 min-w-0 truncate">{length(value)}</span>
      {value === null && <span className="text-[11.5px] text-ink-3">{t("project.cutTarget.freeRange")}</span>}
      {value === target && <Check className="w-3.5 h-3.5 flex-none text-accent" strokeWidth={2.6} />}
    </button>
  );

  return (
    <div ref={box} className="relative inline-flex items-center h-7 -ml-1 rounded-[9px] bg-accent-soft">
      <Tooltip content={t(many ? "project.aiCutHintMany" : "project.aiCutHint")}>
        <button type="button" onClick={onCut} disabled={disabled || busy} className="h-7 pl-2 pr-1.5 inline-flex items-center gap-1.5 rounded-l-[9px] text-[12.5px] font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <WandSparkles className="w-3.5 h-3.5 text-accent" />}
          {t("project.aiCut")}
        </button>
      </Tooltip>
      <span aria-hidden className="w-px h-3.5 bg-white/15" />
      <Tooltip content={t("project.cutTarget.hint")}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${t("project.cutTarget.label")} : ${length(target)}`}
          onClick={() => setOpen((was) => !was)}
          className="h-7 pl-1.5 pr-1.5 inline-flex items-center gap-1 rounded-r-[9px] text-[12.5px] text-ink-2 hover:text-white"
        >
          {length(target)}
          <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.4} />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          aria-label={t("project.cutTarget.label")}
          className="absolute z-40 left-0 bottom-full mb-2 w-[230px] p-1.5 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)]"
        >
          <p className="px-2.5 pt-1 pb-1.5 text-[11.5px] uppercase tracking-[0.06em] text-ink-3">{t("project.cutTarget.label")}</p>
          {option(null)}
          {CUT_TARGETS.map((seconds) => option(seconds))}
          {onReset && (
            <>
              <div className="my-1.5 h-px bg-white/[0.08]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="w-full h-8 px-2.5 rounded-[8px] flex items-center gap-2 text-left text-[13px] text-ink-2 hover:bg-white/[0.07] transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5 flex-none" />
                {t("project.backToSuggestedTrim")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
