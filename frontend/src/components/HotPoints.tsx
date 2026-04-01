import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router";
import { clipUrl, type HotPoint } from "../lib/api";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Download,
  Upload,
  Trash2,
  Clock,
  Flame,
  Sparkles,
  Zap,
  Play,
  ExternalLink,
  Check,
  X,
} from "lucide-react";

interface Props {
  hotPoints: HotPoint[];
  vodUrl: string;
  vodTitle: string;
  vodGame: string;
  vodDuration: number;
  jobId: string;
  streamer: string;
  viewCount: number;
  streamDate: string;
  isStreaming?: boolean;
  animatedClips?: Set<string>;
  isFinalSort?: boolean;
  selectionMode?: boolean;
  selectedClips?: Set<string>;
  onToggleClip?: (filename: string) => void;
  onQuickExport?: (clipFilename: string) => void;
  onDeleteClip?: (clipFilename: string) => void;
}

interface SignalInfo {
  labelKey: string;
  key: keyof HotPoint["signals"];
}

const SIGNALS: SignalInfo[] = [
  { labelKey: "signals.rms", key: "rms" },
  { labelKey: "signals.chat_speed", key: "chat_speed" },
  { labelKey: "signals.spectral_flux", key: "spectral_flux" },
  { labelKey: "signals.pitch_variance", key: "pitch_variance" },
  { labelKey: "signals.spectral_centroid", key: "spectral_centroid" },
  { labelKey: "signals.zcr", key: "zcr" },
];

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}` : `${m}min`;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-white/[0.05] text-zinc-400">
      {children}
    </span>
  );
}

function SignalBars({
  signals,
  activeSignals,
}: {
  signals: HotPoint["signals"];
  activeSignals: SignalInfo[];
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      {activeSignals.map((signal) => {
        const value = signals[signal.key];
        return (
          <div key={signal.key} className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-500 w-20 text-right shrink-0">
              {t(signal.labelKey)}
            </span>
            <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-white/40 transition-all"
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-600 font-mono w-8 text-right tabular-nums">
              {Math.round(value * 100)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function VideoPreview({
  src,
  hovering,
  onOpen,
}: {
  src: string;
  hovering: boolean;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Play/pause based on card hover
  const prevHovering = useRef(false);
  if (hovering !== prevHovering.current) {
    prevHovering.current = hovering;
    if (hovering) {
      videoRef.current?.play().catch(() => {});
    } else {
      videoRef.current?.pause();
    }
  }

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen();
    },
    [onOpen],
  );

  return (
    <div className="relative cursor-pointer" onClick={handleClick}>
      <video
        ref={videoRef}
        muted
        loop
        playsInline
        preload="metadata"
        className={`w-full aspect-[9/16] object-cover rounded-lg bg-zinc-900 transition-all duration-300 ${
          hovering ? "brightness-100" : "brightness-[0.6]"
        }`}
        src={src}
      />
      {/* Play icon overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
          hovering ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="w-10 h-10 rounded-full bg-white/[0.15] backdrop-blur-sm flex items-center justify-center">
          <Play className="w-4 h-4 text-white ml-0.5" />
        </div>
      </div>
    </div>
  );
}

function ClipLightbox({
  clips,
  currentIndex,
  jobId,
  onClose,
  onNavigate,
}: {
  clips: HotPoint[];
  currentIndex: number;
  jobId: string;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = clips[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < clips.length - 1;

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) onNavigate(currentIndex - 1);
      if (e.key === "ArrowRight" && hasNext) onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate, currentIndex, hasPrev, hasNext]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Autoplay on clip change
  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, [currentIndex]);

  const handleDownload = useCallback(async () => {
    if (!clip.clip_filename) return;
    const url = clipUrl(jobId, clip.clip_filename);
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = clip.clip_name ? `${clip.clip_name}.mp4` : clip.clip_filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }, [jobId, clip]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-xl"
        onClick={onClose}
      />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-10 w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-colors"
      >
        <X className="w-5 h-5 text-white" />
      </button>

      {/* Prev arrow */}
      {hasPrev && (
        <button
          onClick={() => onNavigate(currentIndex - 1)}
          className="absolute left-5 z-10 w-11 h-11 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Next arrow */}
      {hasNext && (
        <button
          onClick={() => onNavigate(currentIndex + 1)}
          className="absolute right-5 z-10 w-11 h-11 rounded-full bg-white/[0.08] hover:bg-white/[0.15] flex items-center justify-center transition-colors"
        >
          <ChevronRight className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-4 max-h-[90vh] px-16">
        {/* Title + counter */}
        <div className="text-center">
          <h3 className="text-base font-semibold text-white">
            {clip.clip_name || clip.timestamp_display}
          </h3>
          <span className="text-xs text-zinc-500">
            {t("hotPoints.clipOf", {
              index: currentIndex + 1,
              total: clips.length,
            })}
          </span>
        </div>

        {/* Video */}
        <video
          ref={videoRef}
          controls
          autoPlay
          loop
          playsInline
          className="max-h-[70vh] max-w-[90vw] rounded-2xl bg-black"
          src={clipUrl(jobId, clip.clip_filename!)}
        />

        {/* Download button */}
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.08] rounded-lg transition-colors"
        >
          <Download className="w-4 h-4" />
          {t("hotPoints.download")}
        </button>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="surface-static rounded-xl p-5 animate-clip-enter">
      <div className="flex items-start gap-4">
        {/* Fake thumbnail */}
        <div className="w-24 h-16 rounded-lg skeleton shrink-0" />
        <div className="flex-1 space-y-2.5">
          <div className="h-4 w-48 rounded skeleton" />
          <div className="h-3 w-72 rounded skeleton" />
          <div className="flex gap-2">
            <div className="h-5 w-14 rounded-md skeleton" />
            <div className="h-5 w-16 rounded-md skeleton" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ClipCard({
  point,
  index,
  jobId,
  activeSignals,
  isNew,
  selectionMode,
  selected,
  onToggle,
  onOpenLightbox,
  onQuickExport,
  onDeleteClip,
}: {
  point: HotPoint;
  index: number;
  jobId: string;
  activeSignals: SignalInfo[];
  isNew?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onOpenLightbox?: () => void;
  onQuickExport?: () => void;
  onDeleteClip?: () => void;
}) {
  const { t } = useTranslation();
  const [showSkeleton, setShowSkeleton] = useState(isNew === true);
  const [expanded, setExpanded] = useState(false);
  const [activeMoment, setActiveMoment] = useState<number | null>(null);
  const [cardHover, setCardHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!showSkeleton) return;
    const timer = setTimeout(() => setShowSkeleton(false), 2500);
    return () => clearTimeout(timer);
  }, [showSkeleton]);

  const displayScore = point.final_score ?? point.score;
  const moments = point.llm?.key_moments ?? [];

  const seekTo = useCallback((time: number, momentIdx: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
    setActiveMoment(momentIdx);
  }, []);

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!point.clip_filename) return;
    const url = clipUrl(jobId, point.clip_filename);
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = point.clip_name ? `${point.clip_name}.mp4` : point.clip_filename;
    a.click();
    URL.revokeObjectURL(blobUrl);
  }, [jobId, point.clip_filename, point.clip_name]);

  if (showSkeleton) return <SkeletonCard />;

  return (
    <div
      className={`surface-static rounded-xl overflow-hidden transition-all duration-200 relative animate-fade-in ${cardHover ? "opacity-100" : "opacity-60"} ${selectionMode ? "cursor-pointer" : ""} ${selectionMode && selected ? "ring-1 ring-white/20" : ""}`}
      onMouseEnter={() => setCardHover(true)}
      onMouseLeave={() => setCardHover(false)}
      onClick={selectionMode ? onToggle : undefined}
    >
      {/* Selection checkbox — top left absolute */}
      {selectionMode && (
        <div className="absolute top-4 left-4 z-10">
          <div
            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
              selected
                ? "bg-white border-white text-black"
                : "border-zinc-600 bg-white/[0.04] hover:border-zinc-400"
            }`}
          >
            {selected && <Check className="w-4 h-4" strokeWidth={3} />}
          </div>
        </div>
      )}

      {/* Rank badge — bottom right absolute */}
      <span className="absolute bottom-3 right-4 text-[11px] font-mono text-zinc-600">
        #{index + 1}
      </span>

      {/* CTA buttons — top right absolute (hidden in selection mode) */}
      {point.clip_filename && !selectionMode && (
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <Link
            to={`/${jobId}/edit?clip=${encodeURIComponent(point.clip_filename)}`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            {t("hotPoints.edit")}
          </Link>
          <button
            onClick={(e) => { e.stopPropagation(); onQuickExport?.(); }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            {t("hotPoints.quickExport")}
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {t("hotPoints.rawClip")}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteClip?.(); }}
            className="inline-flex items-center justify-center w-9 h-9 text-red-400 bg-red-500/[0.06] hover:bg-red-500/[0.12] border border-red-500/[0.12] rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row">
        {/* Video preview (left) — muted, card hover triggers play, click opens */}
        {point.clip_filename && (
          <div className="sm:w-[200px] shrink-0 p-4 pb-0 sm:pb-4">
            <VideoPreview
              src={clipUrl(jobId, point.clip_filename)}
              hovering={cardHover}
              onOpen={onOpenLightbox ?? (() => {})}
            />
          </div>
        )}

        {/* Content (right) */}
        <div className="flex-1 min-w-0 p-5 pr-48">
          {/* Title */}
          <h3 className="text-sm font-semibold text-white mb-1.5">
            {point.clip_name || point.timestamp_display}
          </h3>

          {/* Tags row */}
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {point.llm?.category && (
              <Tag>
                {t(`categories.${point.llm.category}`, { defaultValue: point.llm.category })}
              </Tag>
            )}
            {point.chat_mood && <Tag>{point.chat_mood}</Tag>}
            {point.chat_message_count != null &&
              point.chat_message_count > 0 && (
                <Tag>{point.chat_message_count} {t("hotPoints.msg")}</Tag>
              )}
            {point.clip_name && (
              <span className="text-[11px] font-mono text-zinc-600">
                {point.timestamp_display}
              </span>
            )}
          </div>

          {/* Summary */}
          {point.llm?.summary && (
            <p className="text-sm text-zinc-400 leading-relaxed mb-3 line-clamp-2">
              {point.llm.summary}
            </p>
          )}

          {/* Score line — descriptive */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-4">
            <span>
              {t("hotPoints.viralityScore")}{" "}
              <span className="text-white font-semibold">
                {Math.round(displayScore * 100)}%
              </span>
            </span>
          </div>

          {/* Key moments (inline) */}
          {moments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {moments.map((moment, mi) => (
                <button
                  key={mi}
                  className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                    activeMoment === mi
                      ? "bg-white/[0.1] text-white"
                      : "bg-white/[0.03] text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                  onClick={() => seekTo(moment.time, mi)}
                  title={moment.description}
                >
                  <span className="font-mono text-zinc-600 mr-1">
                    {formatTime(moment.time)}
                  </span>
                  {moment.label}
                </button>
              ))}
            </div>
          )}

          {/* Expand toggle */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded ? t("hotPoints.hideDetails") : t("hotPoints.showDetails")}
          </button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-white/[0.06] animate-fade-in">
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: LLM analysis */}
            <div className="space-y-4">
              {point.llm?.narrative && (
                <div>
                  <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    {t("hotPoints.narrative")}
                  </h4>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    {point.llm.narrative}
                  </p>
                </div>
              )}

              {point.llm?.transcript && (
                <div>
                  <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    {t("hotPoints.transcript")}
                  </h4>
                  <p className="text-sm text-zinc-500 leading-relaxed italic">
                    {point.llm.transcript}
                  </p>
                </div>
              )}

              {/* Score breakdown */}
              <div>
                <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  {t("hotPoints.scoreBreakdown")}
                </h4>
                <div className="space-y-1.5 text-xs text-zinc-500">
                  <div className="flex justify-between">
                    <span>{t("hotPoints.finalScore")}</span>
                    <span className="text-white font-semibold">{Math.round(displayScore * 100)}%</span>
                  </div>
                  {point.final_score != null && (
                    <>
                      <div className="flex justify-between">
                        <span>{t("hotPoints.heuristic")}</span>
                        <span className="text-zinc-300">{Math.round(point.score * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>{t("hotPoints.llmVirality")}</span>
                        <span className="text-zinc-300">
                          {point.llm
                            ? Math.round(point.llm.virality_score * 100)
                            : 0}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Signal bars */}
            <div>
              <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">
                {t("hotPoints.signals")}
              </h4>
              <SignalBars signals={point.signals} activeSignals={activeSignals} />
            </div>
          </div>

          {/* Key moments detail */}
          {moments.length > 0 && (
            <div className="px-5 pb-5">
              <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                {t("hotPoints.keyMoments")}
              </h4>
              <div className="space-y-1">
                {moments.map((moment, mi) => (
                  <button
                    key={mi}
                    className="w-full text-left flex gap-3 p-2.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                    onClick={() => seekTo(moment.time, mi)}
                  >
                    <span className="font-mono text-[11px] text-zinc-500 shrink-0 pt-0.5">
                      {formatTime(moment.time)}
                    </span>
                    <div>
                      <span className="text-xs text-zinc-200 font-medium">
                        {moment.label}
                      </span>
                      {moment.description && (
                        <p className="text-[11px] text-zinc-600 mt-0.5">
                          {moment.description}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Clips list with optional auto/manual grouping ─────── */

function ClipsList({
  hotPoints,
  clipsWithFiles,
  jobId,
  activeSignals,
  animatedClips,
  isFinalSort,
  selectionMode,
  selectedClips,
  onToggleClip,
  onQuickExport,
  onDeleteClip,
  onOpenLightbox,
  t,
}: {
  hotPoints: HotPoint[];
  clipsWithFiles: HotPoint[];
  jobId: string;
  activeSignals: SignalInfo[];
  animatedClips?: Set<string>;
  isFinalSort?: boolean;
  selectionMode?: boolean;
  selectedClips?: Set<string>;
  onToggleClip?: (filename: string) => void;
  onQuickExport?: (clipFilename: string) => void;
  onDeleteClip?: (clipFilename: string) => void;
  onOpenLightbox: (idx: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const autoClips = hotPoints.filter((hp) => hp.clip_source !== "manual");
  const manualClips = hotPoints.filter((hp) => hp.clip_source === "manual");
  const hasBoth = autoClips.length > 0 && manualClips.length > 0;

  const [autoCollapsed, setAutoCollapsed] = useState(false);
  const [manualCollapsed, setManualCollapsed] = useState(false);

  const renderClip = (point: HotPoint, i: number) => {
    if (!point.clip_filename) {
      // Import placeholder (has clip_name but no file yet) → skeleton
      if (point.clip_name) {
        return <SkeletonCard key={`pending-${point.clip_name}`} />;
      }
      // Failed extraction (no filename, no name) → hide
      return null;
    }
    const clipKey = point.clip_filename;
    const lightboxIdx = clipsWithFiles.findIndex((c) => c.clip_filename === point.clip_filename);
    return (
      <ClipCard
        key={point.clip_filename}
        point={point}
        index={i}
        jobId={jobId}
        activeSignals={activeSignals}
        isNew={animatedClips?.has(clipKey)}
        selectionMode={selectionMode}
        selected={selectedClips?.has(point.clip_filename) ?? false}
        onToggle={() => onToggleClip?.(point.clip_filename!)}
        onOpenLightbox={lightboxIdx >= 0 ? () => onOpenLightbox(lightboxIdx) : undefined}
        onQuickExport={() => onQuickExport?.(point.clip_filename!)}
        onDeleteClip={() => onDeleteClip?.(point.clip_filename!)}
      />
    );
  };

  if (!hasBoth) {
    // No grouping needed — flat list
    return (
      <div className={`space-y-3 ${isFinalSort ? "" : ""}`}>
        {hotPoints.map(renderClip)}
      </div>
    );
  }

  // Both types present — show collapsible groups
  return (
    <div className="space-y-6">
      {/* Auto clips */}
      <div>
        <button
          onClick={() => setAutoCollapsed(!autoCollapsed)}
          className="flex items-center gap-2 mb-3 group"
        >
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${autoCollapsed ? "-rotate-90" : ""}`} />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider group-hover:text-zinc-300 transition-colors">
            {t("hotPoints.autoClips")}
          </span>
          <span className="text-[10px] text-zinc-600 tabular-nums">{autoClips.length}</span>
        </button>
        {!autoCollapsed && (
          <div className="space-y-3">
            {autoClips.map((point) => renderClip(point, hotPoints.indexOf(point)))}
          </div>
        )}
      </div>

      {/* Manual clips */}
      <div>
        <button
          onClick={() => setManualCollapsed(!manualCollapsed)}
          className="flex items-center gap-2 mb-3 group"
        >
          <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${manualCollapsed ? "-rotate-90" : ""}`} />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider group-hover:text-zinc-300 transition-colors">
            {t("hotPoints.manualClips")}
          </span>
          <span className="text-[10px] text-zinc-600 tabular-nums">{manualClips.length}</span>
        </button>
        {!manualCollapsed && (
          <div className="space-y-3">
            {manualClips.map((point) => renderClip(point, hotPoints.indexOf(point)))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function HotPoints({
  hotPoints,
  vodUrl,
  vodTitle,
  vodGame,
  vodDuration,
  jobId,
  streamer,
  viewCount,
  streamDate,
  isStreaming,
  animatedClips,
  isFinalSort,
  selectionMode,
  selectedClips,
  onToggleClip,
  onQuickExport,
  onDeleteClip,
}: Props) {
  const { t } = useTranslation();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const activeSignals = SIGNALS.filter((signal) =>
    hotPoints.some((hp) => hp.signals[signal.key] > 0.01),
  );

  // Only clips with files are eligible for lightbox navigation
  const clipsWithFiles = hotPoints.filter((hp) => hp.clip_filename);

  return (
    <div className="w-full">
      {/* VOD Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-semibold text-white">{vodTitle}</h2>
          {vodUrl && (
            <a
              href={vodUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-400 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 hover:border-white/20 hover:text-zinc-200 transition-all duration-200 shrink-0"
            >
              <ExternalLink className="w-3 h-3" />
              {t("hotPoints.vodLink")}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-500">
          {streamer && (
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              {streamer}
            </span>
          )}
          {vodGame && (
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              {vodGame}
            </span>
          )}
          {streamDate && (
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {streamDate}
            </span>
          )}
          <span>{formatDuration(vodDuration)}</span>
          {viewCount > 0 && <span>{viewCount.toLocaleString()} {t("hotPoints.views")}</span>}
        </div>
        <p className="text-sm text-zinc-600 mt-2">
          {isStreaming ? (
            <span className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-zinc-400" />
              {t("hotPoints.clipsReady", { count: hotPoints.length })}
            </span>
          ) : (
            t("hotPoints.hotPointsDetected", { count: hotPoints.length })
          )}
        </p>
      </div>

      {/* Clips list */}
      <ClipsList
        hotPoints={hotPoints}
        clipsWithFiles={clipsWithFiles}
        jobId={jobId}
        activeSignals={activeSignals}
        animatedClips={animatedClips}
        isFinalSort={isFinalSort}
        selectionMode={selectionMode}
        selectedClips={selectedClips}
        onToggleClip={onToggleClip}
        onQuickExport={onQuickExport}
        onDeleteClip={onDeleteClip}
        onOpenLightbox={setLightboxIndex}
        t={t}
      />

      {/* Clip lightbox */}
      {lightboxIndex !== null && (
        <ClipLightbox
          clips={clipsWithFiles}
          currentIndex={lightboxIndex}
          jobId={jobId}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
