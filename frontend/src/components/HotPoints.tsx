import { useState, useRef, useCallback } from "react";
import { Link } from "react-router";
import { clipUrl, type HotPoint } from "../lib/api";

interface Props {
  hotPoints: HotPoint[];
  vodTitle: string;
  vodGame: string;
  vodDuration: number;
  jobId: string;
  streamer: string;
  viewCount: number;
  streamDate: string;
}

interface SignalInfo {
  label: string;
  color: string;
  key: keyof HotPoint["signals"];
}

const SIGNALS: SignalInfo[] = [
  { label: "Volume", color: "#ef4444", key: "rms" },
  { label: "Chat", color: "#a855f7", key: "chat_speed" },
  { label: "Flux spectral", color: "#f97316", key: "spectral_flux" },
  { label: "Pitch", color: "#3b82f6", key: "pitch_variance" },
  { label: "Brillance", color: "#22c55e", key: "spectral_centroid" },
  { label: "ZCR", color: "#a1a1aa", key: "zcr" },
];

const CATEGORY_STYLES: Record<string, { label: string; color: string }> = {
  fun: { label: "Fun", color: "#eab308" },
  rage: { label: "Rage", color: "#ef4444" },
  clutch: { label: "Clutch", color: "#10b981" },
  skill: { label: "Skill", color: "#3b82f6" },
  fail: { label: "Fail", color: "#f97316" },
  emotional: { label: "Emotional", color: "#ec4899" },
  reaction: { label: "Reaction", color: "#a855f7" },
  storytelling: { label: "Story", color: "#06b6d4" },
  awkward: { label: "Awkward", color: "#f59e0b" },
  hype: { label: "Hype", color: "#d946ef" },
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

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score > 0.7 ? "from-red-500 to-orange-500" :
    score > 0.5 ? "from-orange-500 to-yellow-500" :
    "from-zinc-500 to-zinc-400";
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg bg-gradient-to-r ${color} text-white`}>
      {pct}%
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const style = CATEGORY_STYLES[category] || { label: category, color: "#71717a" };
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-lg"
      style={{ backgroundColor: `${style.color}20`, color: style.color }}
    >
      {style.label}
    </span>
  );
}

function SignalBars({ signals, activeSignals }: { signals: HotPoint["signals"]; activeSignals: SignalInfo[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
      {activeSignals.map((signal) => {
        const value = signals[signal.key];
        return (
          <div key={signal.key} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 w-14 text-right shrink-0">{signal.label}</span>
            <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.round(value * 100)}%`,
                  backgroundColor: signal.color,
                  boxShadow: value > 0.5 ? `0 0 8px ${signal.color}60` : "none",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClipCard({
  point,
  index,
  jobId,
  activeSignals,
}: {
  point: HotPoint;
  index: number;
  jobId: string;
  activeSignals: SignalInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [showVertical, setShowVertical] = useState(false);
  const [activeMoment, setActiveMoment] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const displayScore = point.final_score ?? point.score;
  const moments = point.llm?.key_moments ?? [];

  const seekTo = useCallback((time: number, momentIdx: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      videoRef.current.play();
    }
    setActiveMoment(momentIdx);
  }, []);

  return (
    <div className="glass rounded-2xl overflow-hidden ambient-glow transition-all">
      {/* Header row */}
      <button
        className="w-full p-5 text-left cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-zinc-600 bg-white/[0.04] w-7 h-7 rounded-full flex items-center justify-center shrink-0">
              {index + 1}
            </span>
            <div className="flex items-center flex-wrap gap-2">
              <span className="text-base font-mono text-white">{point.timestamp_display}</span>
              <ScoreBadge score={displayScore} />
              {point.llm?.category && <CategoryBadge category={point.llm.category} />}
              {point.chat_mood && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.04] text-zinc-400 capitalize">
                  {point.chat_mood}
                </span>
              )}
              {point.llm && point.llm.virality_score > 0 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-fuchsia-500/10 text-fuchsia-400">
                  Viral {Math.round(point.llm.virality_score * 100)}%
                </span>
              )}
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-zinc-600 transition-transform shrink-0 mt-1 ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Summary */}
        {point.llm?.summary && (
          <p className="text-sm text-zinc-400 mb-3 line-clamp-2">{point.llm.summary}</p>
        )}

        {/* Signal bars */}
        <SignalBars signals={point.signals} activeSignals={activeSignals} />
      </button>

      {/* Expanded view */}
      {expanded && (
        <div className="border-t border-white/[0.04]">
          {/* Video */}
          {point.clip_filename && (
            <div className="p-4">
              {/* Format toggle + Edit link */}
              <div className="flex items-center gap-2 mb-3">
                {point.vertical_filename && (
                  <>
                    {[
                      { label: "Clip brut (16:9)", vertical: false },
                      { label: "Vertical (9:16)", vertical: true },
                    ].map(({ label, vertical }) => (
                      <button
                        key={label}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                          showVertical === vertical
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                            : "glass text-zinc-500 hover:text-white"
                        }`}
                        onClick={() => setShowVertical(vertical)}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
                {point.vertical_filename && (
                  <Link
                    to={`/${jobId}/edit`}
                    className="text-xs px-3 py-1.5 rounded-lg glass text-zinc-500 hover:text-purple-300 hover:border-purple-500/30 transition-all ml-auto flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 4.879l5 5m-11.5 2.5L16 4l4 4-8.379 8.379a2 2 0 01-1.414.586H7v-3.207a2 2 0 01.586-1.414z" />
                    </svg>
                    Editer
                  </Link>
                )}
              </div>

              {showVertical && point.vertical_filename ? (
                <div className="flex justify-center">
                  <video
                    controls
                    className="max-h-[500px] rounded-xl"
                    src={clipUrl(jobId, point.vertical_filename)}
                  />
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    controls
                    className="w-full max-h-[400px] rounded-xl"
                    src={clipUrl(jobId, point.clip_filename)}
                  />

                  {/* Key moments timeline */}
                  {moments.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {moments.map((moment, mi) => (
                        <button
                          key={mi}
                          className={`text-xs px-3 py-1.5 rounded-lg transition-all ${
                            activeMoment === mi
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                              : "glass text-zinc-400 hover:text-white"
                          }`}
                          onClick={() => seekTo(moment.time, mi)}
                          title={moment.description}
                        >
                          <span className="font-mono text-zinc-600 mr-1">{formatTime(moment.time)}</span>
                          {moment.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* LLM Analysis */}
          {point.llm && (
            <div className="p-5 border-t border-white/[0.04] space-y-4">
              {/* Narrative */}
              {point.llm.narrative && (
                <div>
                  <h4 className="text-[10px] font-semibold text-zinc-600 uppercase tracking-widest mb-2">
                    Recit du clip
                  </h4>
                  <p className="text-sm text-zinc-300 leading-relaxed">{point.llm.narrative}</p>
                </div>
              )}

              {/* Tags */}
              <div className="flex flex-wrap gap-2 text-xs">
                {point.llm.category && <CategoryBadge category={point.llm.category} />}
                {point.llm.virality_score > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
                    Potentiel viral : {Math.round(point.llm.virality_score * 100)}%
                  </span>
                )}
                {!point.llm.is_clipable && (
                  <span className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-zinc-500">
                    Necessite du contexte
                  </span>
                )}
                {point.llm.speech_rate > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-white/[0.04] text-zinc-500">
                    {point.llm.speech_rate.toFixed(1)} mots/s
                  </span>
                )}
              </div>

              {/* Key moments detail */}
              {moments.length > 0 && (
                <details className="text-xs group">
                  <summary className="text-zinc-600 cursor-pointer hover:text-zinc-300 transition-colors">
                    Moments cles ({moments.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {moments.map((moment, mi) => (
                      <button
                        key={mi}
                        className="w-full text-left flex gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors"
                        onClick={() => seekTo(moment.time, mi)}
                      >
                        <span className="font-mono text-purple-400 shrink-0">
                          {formatTime(moment.time)}
                        </span>
                        <div>
                          <span className="text-zinc-200 font-medium">{moment.label}</span>
                          {moment.description && (
                            <p className="text-zinc-600 mt-0.5">{moment.description}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              {/* Transcript */}
              {point.llm.transcript && (
                <details className="text-xs group">
                  <summary className="text-zinc-600 cursor-pointer hover:text-zinc-300 transition-colors">
                    Transcription
                  </summary>
                  <p className="mt-2 text-zinc-500 italic leading-relaxed">{point.llm.transcript}</p>
                </details>
              )}
            </div>
          )}

          {/* Score detail */}
          <div className="p-5 border-t border-white/[0.04] space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-600">Score final</span>
              <span className="text-sm font-bold text-white">{Math.round(displayScore * 100)}%</span>
            </div>

            {point.final_score != null && (
              <div className="flex gap-4 text-[10px] text-zinc-600">
                <span>Heuristique : {Math.round(point.score * 100)}% (x0.3)</span>
                <span>
                  LLM : {point.llm ? Math.round(point.llm.virality_score * 100) : 0}% (x0.7)
                </span>
              </div>
            )}

            {/* Detailed signals */}
            <details className="text-xs">
              <summary className="text-zinc-600 cursor-pointer hover:text-zinc-300 transition-colors">
                Detail des signaux
              </summary>
              <div className="space-y-3 mt-3">
                {activeSignals.map((signal) => {
                  const value = point.signals[signal.key];
                  return (
                    <div key={signal.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium" style={{ color: signal.color }}>
                          {signal.label}
                        </span>
                        <span className="text-xs font-mono text-zinc-400">
                          {Math.round(value * 100)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(value * 100)}%`,
                            backgroundColor: signal.color,
                            boxShadow: value > 0.5 ? `0 0 12px ${signal.color}40` : "none",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
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
}: Props) {
  const activeSignals = SIGNALS.filter((signal) =>
    hotPoints.some((hp) => hp.signals[signal.key] > 0.01),
  );

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* VOD Header */}
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold text-white mb-3">{vodTitle}</h2>
        <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
          {streamer && (
            <span className="text-purple-400 font-semibold">{streamer}</span>
          )}
          {vodGame && <span className="text-zinc-400">{vodGame}</span>}
          {streamDate && <span className="text-zinc-600">{streamDate}</span>}
          <span className="text-zinc-600">{formatDuration(vodDuration)}</span>
          {viewCount > 0 && (
            <span className="text-zinc-600">{viewCount.toLocaleString()} vues</span>
          )}
        </div>
        <p className="text-zinc-600 text-sm mt-2">
          {hotPoints.length} moments forts detectes
        </p>
      </div>

      {/* Clips grid */}
      <div className="space-y-3">
        {hotPoints.map((point, i) => (
          <ClipCard
            key={i}
            point={point}
            index={i}
            jobId={jobId}
            activeSignals={activeSignals}
          />
        ))}
      </div>
    </div>
  );
}
