import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { X, Loader2, Link as LinkIcon, Upload, MonitorPlay } from "lucide-react";
import { submitVod } from "../lib/api";
import { useTranslation } from "react-i18next";

type ImportTab = "twitch" | "youtube" | "upload";

interface Tab {
  id: ImportTab;
  labelKey: string;
  icon: React.ReactNode;
  enabled: boolean;
}

const TABS: Tab[] = [
  { id: "twitch", labelKey: "newProject.twitchVod", icon: <MonitorPlay className="w-4 h-4" />, enabled: true },
  { id: "youtube", labelKey: "newProject.youtube", icon: <MonitorPlay className="w-4 h-4" />, enabled: false },
  { id: "upload", labelKey: "newProject.upload", icon: <Upload className="w-4 h-4" />, enabled: false },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function NewProjectModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ImportTab>("twitch");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, activeTab]);

  // Close on Escape
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
    setError("");

    if (activeTab === "twitch") {
      if (!url.includes("twitch.tv/videos/")) {
        setError(t("newProject.invalidUrl"));
        return;
      }
      setLoading(true);
      try {
        const { job_id } = await submitVod(url);
        setUrl("");
        onClose();
        navigate(`/${job_id}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("common.error"));
      } finally {
        setLoading(false);
      }
    }
  }

  function handleClose() {
    if (!loading) {
      setUrl("");
      setError("");
      onClose();
    }
  }

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
          <h2 className="text-base font-semibold text-white">{t("newProject.title")}</h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors rounded-lg hover:bg-white/[0.06]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => tab.enabled && setActiveTab(tab.id)}
              disabled={!tab.enabled}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === tab.id
                  ? "bg-white/[0.1] text-white font-medium"
                  : tab.enabled
                    ? "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.04]"
                    : "text-zinc-700 cursor-not-allowed"
              }`}
            >
              {tab.icon}
              {t(tab.labelKey)}
              {!tab.enabled && (
                <span className="text-[10px] font-medium text-zinc-500 bg-white/[0.06] border border-white/[0.08] px-1.5 py-px rounded-full leading-none">{t("common.comingSoon")}</span>
              )}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 pb-5">
          {activeTab === "twitch" && (
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
              <input
                ref={inputRef}
                type="text"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(""); }}
                placeholder={t("newProject.placeholder")}
                disabled={loading}
                className="w-full pl-10 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-white/[0.2] disabled:opacity-50 transition-colors"
              />
            </div>
          )}

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
              {t("newProject.cancel")}
            </button>
            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="px-5 py-2 bg-white text-black text-sm font-medium rounded-lg hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("newProject.analyzing")}
                </>
              ) : (
                t("newProject.analyze")
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
