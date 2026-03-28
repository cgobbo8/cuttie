import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  loading,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-zinc-900 border border-white/[0.08] rounded-xl p-6 w-full max-w-sm shadow-2xl animate-fade-in">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={loading}
            className="text-xs px-3.5 py-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors font-medium"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="text-xs px-3.5 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 hover:text-red-300 transition-colors font-medium border border-red-500/20 disabled:opacity-50"
          >
            {loading ? t("common.loading") : confirmLabel || t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
