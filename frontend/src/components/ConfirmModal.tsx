import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  loadingLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  /** "danger" (default) for destructive actions */
  variant?: "danger" | "default";
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  loadingLabel,
  onConfirm,
  onCancel,
  loading,
  variant = "danger",
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px] animate-fade-in" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-message`}
        className="relative glass-strong rounded-[20px] p-6 w-full max-w-[400px] animate-rise"
      >
        <div className="flex items-start gap-3.5">
          {variant === "danger" && (
            <span className="w-10 h-10 rounded-[12px] bg-[rgba(255,90,70,0.12)] grid place-items-center flex-none">
              <AlertTriangle className="w-[18px] h-[18px] text-[#ff8a7a]" />
            </span>
          )}
          <div className="min-w-0">
            <h3 id={`${id}-title`} className="text-[16px] font-semibold tracking-[-0.01em] text-white">
              {title}
            </h3>
            <p id={`${id}-message`} className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {message}
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button ref={cancelRef} onClick={onCancel} disabled={loading} className="btn btn-ghost">
            {t("common.cancel")}
          </button>
          <button onClick={onConfirm} disabled={loading} className={`btn ${variant === "danger" ? "btn-danger" : "btn-primary"}`}>
            {loading ? loadingLabel || t("common.loading") : confirmLabel || t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
