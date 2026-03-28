import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router";
import { clipUrl, type HotPoint } from "../lib/api";
import {
  ChevronDown,
  Pencil,
  Download,
  Clock,
  Flame,
  Sparkles,
  Zap,
  Play,
} from "lucide-react";

interface Props {
  hotPoints: HotPoint[];
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
}

interface SignalInfo {
  label: string;
  key: keyof HotPoint["signals"];
}

const SIGNALS: SignalInfo[] = [
  { label: "Volume", key: "rms" },
  { label: "Chat", key: "chat_speed" },
  { label: "Flux spectral", key: "spectral_flux" },
  { label: "Pitch", key: "pitch_variance" },
  { label: "Brillance", key: "spectral_centroid" },
  { label: "ZCR", key: "zcr" },
];

const CATEGORY_STYLES: Record<string, string> = {
  fun: "Fun",
  rage: "Rage",
  clutch: "Clutch",
  skill: "Skill",
  fail: "Fail",
  emotional: "Emotional",
  reaction: "Reaction",
  storytelling: "Story",
  awkward: "Awkward",
  hype: "Hype",
};

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
  return (
    <div className="space-y-2">
      {activeSignals.map((signal) => {
        const value = signals[signal.key];
        return (
          <div key={signal.key} className="flex items-center gap-3">
            <span className="text-[11px] text-zinc-500 w-20 text-right shrink-0">
              {signal.label}
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

function VideoPreview({ src, hovering }: { src: string; hovering: boolean }) {
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

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(src, "_blank");
  }, [src]);

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
}: {
  point: HotPoint;
  index: number;
  jobId: string;
  activeSignals: SignalInfo[];
  isNew?: boolean;
}) {
  const [showSkeleton, setShowSkeleton] = useState(isNew === true);
  const [expanded, setExpanded] = useState(false);
  const [activeMoment, setActiveMoment] = useState<number | null>(null);
  const [cardHover, setCardHover] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!showSkeleton) return;
    const t = setTimeout(() => setShowSkeleton(false), 2500);
    return () => clearTimeout(t);
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
      className={`surface-static rounded-xl overflow-hidden transition-all duration-200 relative animate-fade-in ${cardHover ? "opacity-100" : "opacity-60"}`}
      onMouseEnter={() => setCardHover(true)}
      onMouseLeave={() => setCardHover(false)}
    >
      {/* Rank badge — bottom right absolute */}
      <span className="absolute bottom-3 right-4 text-[11px] font-mono text-zinc-600">
        #{index + 1}
      </span>

      {/* CTA buttons — top right absolute */}
      {point.clip_filename && (
        <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
          <Link
            to={`/${jobId}/edit?clip=${encodeURIComponent(point.clip_filename)}`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-black bg-white hover:bg-zinc-200 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editer
          </Link>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Clip brut
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row">
        {/* Video preview (left) — muted, card hover triggers play, click opens */}
        {point.clip_filename && (
          <div className="sm:w-[200px] shrink-0 p-4 pb-0 sm:pb-4">
            <VideoPreview src={clipUrl(jobId, point.clip_filename)} hovering={cardHover} />
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
                {CATEGORY_STYLES[point.llm.category] || point.llm.category}
              </Tag>
            )}
            {point.chat_mood && <Tag>{point.chat_mood}</Tag>}
            {point.chat_message_count != null &&
              point.chat_message_count > 0 && (
                <Tag>{point.chat_message_count} msg</Tag>
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
              Score de viralite :{" "}
              <span className="text-white font-semibold">
                {Math.round(displayScore * 100)}%
              </span>
            </span>
            {point.llm && point.llm.virality_score > 0 && (
              <span>
                Potentiel viral :{" "}
                <span className="text-zinc-300">
                  {Math.round(point.llm.virality_score * 100)}%
                </span>
              </span>
            )}
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
            {expanded ? "Masquer les details" : "Voir les details"}
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
                    Recit
                  </h4>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    {point.llm.narrative}
                  </p>
                </div>
              )}

              {point.llm?.transcript && (
                <div>
                  <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                    Transcription
                  </h4>
                  <p className="text-sm text-zinc-500 leading-relaxed italic">
                    {point.llm.transcript}
                  </p>
                </div>
              )}

              {/* Score breakdown */}
              <div>
                <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                  Decomposition du score
                </h4>
                <div className="space-y-1.5 text-xs text-zinc-500">
                  <div className="flex justify-between">
                    <span>Score final</span>
                    <span className="text-white font-semibold">{Math.round(displayScore * 100)}%</span>
                  </div>
                  {point.final_score != null && (
                    <>
                      <div className="flex justify-between">
                        <span>Heuristique (x0.3)</span>
                        <span className="text-zinc-300">{Math.round(point.score * 100)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>LLM viralite (x0.7)</span>
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
                Signaux
              </h4>
              <SignalBars signals={point.signals} activeSignals={activeSignals} />
            </div>
          </div>

          {/* Key moments detail */}
          {moments.length > 0 && (
            <div className="px-5 pb-5">
              <h4 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                Moments cles
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

export default function HotPoints({
  hotPoints,
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
}: Props) {
  const activeSignals = SIGNALS.filter((signal) =>
    hotPoints.some((hp) => hp.signals[signal.key] > 0.01),
  );

  return (
    <div className="w-full">
      {/* VOD Header */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-2">{vodTitle}</h2>
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
          {viewCount > 0 && <span>{viewCount.toLocaleString()} vues</span>}
        </div>
        <p className="text-sm text-zinc-600 mt-2">
          {isStreaming ? (
            <span className="flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-zinc-400" />
              {hotPoints.length} clip
              {hotPoints.length > 1 ? "s" : ""} pret
              {hotPoints.length > 1 ? "s" : ""}
            </span>
          ) : (
            `${hotPoints.length} moments forts detectes`
          )}
        </p>
      </div>

      {/* Clips list */}
      <div className={`space-y-3 ${isFinalSort ? "" : ""}`}>
        {hotPoints.map((point, i) => {
          const clipKey = point.clip_filename || `rank-${i}`;
          return (
            <ClipCard
              key={point.clip_filename || i}
              point={point}
              index={i}
              jobId={jobId}
              activeSignals={activeSignals}
              isNew={animatedClips?.has(clipKey)}
            />
          );
        })}
      </div>
    </div>
  );
}
