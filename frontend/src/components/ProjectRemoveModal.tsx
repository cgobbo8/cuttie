import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { fileSize } from "../lib/format";

type Choice = "free" | "delete";

/**
 * What to do with a project taking space: free its clips (the project and its
 * exports stay, the clips can come back from Twitch) or delete it all.
 */
export default function ProjectRemoveModal({
  open,
  clipsBytes,
  onFree,
  onDelete,
  onCancel,
  loading,
}: {
  open: boolean;
  /** What freeing its clips gives back */
  clipsBytes: number;
  onFree: () => void;
  onDelete: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [choice, setChoice] = useState<Choice>("free");
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setChoice("free");
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const options: { id: Choice; label: string; hint: string }[] = [
    { id: "free", label: t("projects.remove.free", { size: fileSize(clipsBytes, i18n.language) }), hint: t("projects.remove.freeHint") },
    { id: "delete", label: t("projects.remove.delete"), hint: t("projects.remove.deleteHint") },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onCancel} />
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="relative glass-strong rounded-[20px] p-6 w-full max-w-[440px] animate-rise">
        <h3 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.01em] text-white">
          {t("projects.remove.title")}
        </h3>
        <div role="radiogroup" aria-labelledby={`${id}-title`} className="mt-4 flex flex-col gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={choice === o.id}
              onClick={() => setChoice(o.id)}
              className={`text-left rounded-[14px] p-3.5 border transition-colors ${
                choice === o.id ? "bg-white/[0.08] border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-white/[0.08] hover:bg-white/[0.05]"
              }`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-white">{o.label}</span>
                {choice === o.id && <Check className="w-4 h-4 text-accent flex-none" />}
              </span>
              <span className="mt-1 block text-[12.5px] leading-snug text-ink-3">{o.hint}</span>
            </button>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={loading} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
          <button onClick={choice === "free" ? onFree : onDelete} disabled={loading} className={`btn ${choice === "delete" ? "btn-danger" : "btn-primary"}`}>
            {loading ? t("common.loading") : choice === "free" ? t("projects.remove.freeCta") : t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
