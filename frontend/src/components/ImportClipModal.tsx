import { useState, useRef, useCallback, useEffect, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { X, Loader2, Upload, FileVideo } from "lucide-react";
import { importClip } from "../lib/api";
import { useTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACCEPTED_VIDEO = ".mp4,.mov,.webm,.mkv,.avi";

export default function ImportClipModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === backdropRef.current && !loading) onClose();
    },
    [loading, onClose],
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const { job_id } = await importClip(file);
      setFile(null);
      onClose();
      navigate(`/${job_id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (!loading) {
      setFile(null);
      setError("");
      onClose();
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setError(""); }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) { setFile(selected); setError(""); }
  }, []);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in"
    >
      <div className="w-full max-w-lg mx-4 surface-static rounded-xl overflow-hidden animate-modal-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <h2 className="text-base font-semibold text-white">{t("importClip.title")}</h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="px-5 pb-5">
          <input ref={fileInputRef} type="file" accept={ACCEPTED_VIDEO} onChange={handleFileSelect} className="hidden" />
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => !loading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragActive
                ? "border-white/30 bg-white/[0.06]"
                : file
                  ? "border-white/[0.15] bg-white/[0.04]"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
            } ${loading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileVideo className="w-8 h-8 text-zinc-400" />
                <div className="text-left">
                  <p className="text-sm text-white font-medium truncate max-w-[280px]">{file.name}</p>
                  <p className="text-xs text-zinc-500">{(file.size / 1024 / 1024).toFixed(1)} Mo</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="text-zinc-600 hover:text-zinc-300 transition-colors p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <>
                <Upload className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm text-zinc-400 mb-1">
                  {dragActive ? t("importClip.dropZoneActive") : t("importClip.dropZoneHint")}
                </p>
                <p className="text-xs text-zinc-600">.mp4, .mov, .webm, .mkv</p>
              </>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400 mt-2 px-1">{error}</p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !file}
              className="px-5 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("importClip.uploading")}
                </>
              ) : (
                t("importClip.import")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
