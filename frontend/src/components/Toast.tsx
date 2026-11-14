import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  success: (message: string) => void;
  error: (message: string) => void;
  /** Something to know that is neither a success nor a failure (nothing to cut here...) */
  info: (message: string) => void;
}

const LOOK = {
  success: { background: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.15)", icon: "text-emerald-400", text: "text-emerald-300" },
  error: { background: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.15)", icon: "text-red-400", text: "text-red-300" },
  info: { background: "rgba(255, 255, 255, 0.06)", border: "rgba(255, 255, 255, 0.12)", icon: "text-zinc-300", text: "text-zinc-200" },
} as const;

const ToastContext = createContext<ToastContextType | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const success = useCallback((message: string) => addToast(message, "success"), [addToast]);
  const error = useCallback((message: string) => addToast(message, "error"), [addToast]);
  const info = useCallback((message: string) => addToast(message, "info"), [addToast]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}

      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border animate-fade-in min-w-[280px] max-w-[400px]"
            style={{
              background: LOOK[toast.type].background,
              borderColor: LOOK[toast.type].border,
              backgroundColor: "rgb(24, 24, 27)",
            }}
          >
            {toast.type === "success" ? (
              <CheckCircle className={`w-4 h-4 shrink-0 ${LOOK.success.icon}`} />
            ) : toast.type === "error" ? (
              <AlertCircle className={`w-4 h-4 shrink-0 ${LOOK.error.icon}`} />
            ) : (
              <Info className={`w-4 h-4 shrink-0 ${LOOK.info.icon}`} />
            )}
            <span className={`text-sm flex-1 ${LOOK[toast.type].text}`}>{toast.message}</span>
            <button
              onClick={() => dismiss(toast.id)}
              className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
