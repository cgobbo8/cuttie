import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { X, Loader2 } from "lucide-react";
import { startBatchRender } from "../lib/api";
import type { EditorTheme } from "../lib/editorThemes";
import { fetchAllThemes, fetchDefaultTheme } from "../lib/editorThemes";
import { useToast } from "./Toast";

interface Props {
  jobId: string;
  clipFilenames: string[];
  onClose: () => void;
  onDone: () => void;
}

export default function BatchExportModal({ jobId, clipFilenames, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();

  const [themes, setThemes] = useState<EditorTheme[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<EditorTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    Promise.all([fetchAllThemes(), fetchDefaultTheme()]).then(([all, defaultTheme]) => {
      setThemes(all);
      setSelectedTheme(defaultTheme ?? all[0] ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleExport = useCallback(async () => {
    if (!selectedTheme) return;
    setExporting(true);
    try {
      await startBatchRender(jobId, clipFilenames, selectedTheme.layers);

      toast.success(t("batchExport.started", { count: clipFilenames.length }));
      onDone();
      navigate("/exports");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("batchExport.error"));
    } finally {
      setExporting(false);
    }
  }, [selectedTheme, jobId, clipFilenames, toast, t, onDone, navigate]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg mx-4 bg-zinc-900 border border-white/[0.08] rounded-2xl shadow-2xl animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white">{t("batchExport.modalTitle")}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            </div>
          ) : (
            <>
              {/* Theme picker */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3 block">
                  {t("batchExport.chooseTheme")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {themes.map((theme) => {
                    const isSelected = selectedTheme?.id === theme.id;
                    return (
                      <button
                        key={theme.id}
                        onClick={() => setSelectedTheme(theme)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                          isSelected
                            ? "border-white/20 bg-white/[0.06]"
                            : "border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]"
                        }`}
                      >
                        {/* Mini layer dots */}
                        <div className="shrink-0 w-8 h-8 rounded-md bg-white/[0.04] border border-white/[0.06] flex items-center justify-center gap-0.5 flex-wrap p-0.5">
                          {theme.layers.map((l, i) => (
                            <div
                              key={i}
                              className="w-2 h-2 rounded-full"
                              style={{
                                backgroundColor:
                                  l.type === "gameplay" ? "#a855f7" :
                                  l.type === "facecam" ? "#3b82f6" :
                                  l.type === "subtitles" ? "#f59e0b" :
                                  l.type === "shape" ? "#10b981" :
                                  "#6b7280",
                              }}
                            />
                          ))}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-zinc-200 truncate">{theme.name}</div>
                          <div className="text-[10px] text-zinc-600">
                            {t("editor.layerCount", { count: theme.layers.length })}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Summary */}
              {selectedTheme && (
                <p className="text-sm text-zinc-500">
                  {t("batchExport.summary", {
                    count: clipFilenames.length,
                    theme: selectedTheme.name,
                  })}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/[0.06]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            {t("batchExport.cancel")}
          </button>
          <button
            onClick={handleExport}
            disabled={!selectedTheme || exporting}
            className="px-5 py-2 text-sm font-medium text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exporting && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("batchExport.startExport")}
          </button>
        </div>
      </div>
    </div>
  );
}
