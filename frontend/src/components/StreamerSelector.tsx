import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useStreamer } from "../lib/StreamerContext";
import { useTranslation } from "react-i18next";

function StreamerAvatar({ name, avatarUrl, size = 28 }: { name: string; avatarUrl?: string | null; size?: number }) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="rounded-full bg-white/[0.08] flex items-center justify-center text-[11px] font-semibold text-zinc-300 shrink-0 uppercase"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 2)}
    </div>
  );
}

export default function StreamerSelector() {
  const { t } = useTranslation();
  const { streamers, activeStreamer, setActiveStreamer, loading } = useStreamer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  if (loading || streamers.length === 0) return null;

  return (
    <div ref={ref} className="relative px-3 mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]"
      >
        {activeStreamer && (
          <StreamerAvatar name={activeStreamer.display_name} avatarUrl={activeStreamer.avatar_url} />
        )}
        <span className="flex-1 text-left text-zinc-200 truncate font-medium text-[13px]">
          {activeStreamer?.display_name ?? t("streamer.select")}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-[#18181b] border border-white/[0.08] rounded-lg shadow-xl overflow-hidden animate-fade-in">
          {streamers.map((streamer) => (
            <button
              key={streamer.id}
              onClick={() => {
                setActiveStreamer(streamer);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-white/[0.06] ${
                activeStreamer?.id === streamer.id ? "bg-white/[0.04]" : ""
              }`}
            >
              <StreamerAvatar name={streamer.display_name} avatarUrl={streamer.avatar_url} size={24} />
              <span className="flex-1 text-left text-zinc-300 truncate text-[13px]">
                {streamer.display_name}
              </span>
              {activeStreamer?.id === streamer.id && (
                <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
