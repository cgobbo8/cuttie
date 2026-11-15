import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";

interface Props {
  /** The template chosen (null: `fallback`, when there is one) */
  value: string | null;
  /** The templates to pick from, by name */
  templates: { key: string; name: string }[];
  /** A first choice that is no template of its own ("the channel's default"): what it is called */
  fallback?: string;
  onPick: (key: string | null) => void;
  onClose: () => void;
  /** What the menu is for, said to screen readers */
  label?: string;
  /** Where it sits against what opened it */
  className?: string;
}

/** The templates a video can be shown in, to pick one by name */
export default function TemplateMenu({ value, templates, fallback, onPick, onClose, label, className = "right-0 bottom-full mb-2" }: Props) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const escape = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  const option = (key: string | null, name: string) => (
    <button
      key={key ?? "default"}
      type="button"
      aria-pressed={key === value}
      onClick={() => onPick(key)}
      className={`w-full h-8 px-2.5 rounded-[8px] flex items-center gap-2 text-left text-[13px] transition-colors ${key === value ? "bg-accent-soft text-white" : "text-ink-2 hover:bg-white/[0.07]"}`}
    >
      <span className="flex-1 min-w-0 truncate">{name}</span>
      {key === value && <Check className="w-3.5 h-3.5 flex-none text-accent" strokeWidth={2.6} />}
    </button>
  );
  return (
    <div
      ref={box}
      role="dialog"
      aria-label={label ?? t("compilation.template")}
      data-nodrag
      onClick={(e) => e.stopPropagation()}
      className={`absolute z-40 w-[250px] max-h-[330px] overflow-y-auto p-1.5 rounded-[14px] bg-[#171a18]/[0.98] border border-white/[0.12] shadow-[0_24px_60px_-18px_rgba(0,0,0,0.9)] ${className}`}
    >
      {fallback && option(null, fallback)}
      {templates.map((tpl) => option(tpl.key, tpl.name))}
    </div>
  );
}
