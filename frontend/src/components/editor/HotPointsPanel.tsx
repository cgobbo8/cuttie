import { useTranslation } from "react-i18next";
import type { HotPoint } from "../../lib/api";

interface Props {
  hotPoint: HotPoint;
  currentTime: number;
  onSeek: (time: number) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function HotPointsPanel({ hotPoint, currentTime, onSeek }: Props) {
  const { t } = useTranslation();
  const keyMoments = hotPoint.llm?.key_moments ?? [];

  if (!hotPoint.llm) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-[11px] text-zinc-600 text-center">{t("editor.noLlmAnalysis")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Summary */}
      {hotPoint.llm.summary && (
        <div className="px-3 py-2.5 border-b border-white/[0.06]">
          <p className="text-[11px] text-zinc-400 leading-relaxed">{hotPoint.llm.summary}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {hotPoint.llm.category && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-400">{hotPoint.llm.category}</span>
            )}
            <span className="text-[10px] text-zinc-500">{t("editor.score")}: {hotPoint.llm.virality_score}/10</span>
          </div>
        </div>
      )}

      {/* Key moments */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">{t("editor.hotpoints")}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {keyMoments.length === 0 ? (
          <div className="px-3 py-4">
            <p className="text-[11px] text-zinc-600 text-center">{t("editor.noKeyMomentsDetected")}</p>
          </div>
        ) : (
          <div className="py-1">
            {keyMoments.map((km, i) => {
              const isActive = Math.abs(currentTime - km.time) < 2.5;
              return (
                <button
                  key={i}
                  onClick={() => onSeek(km.time)}
                  className={`w-full text-left px-3 py-2 transition-colors group ${
                    isActive
                      ? "bg-orange-500/[0.12] border-l-2 border-orange-400"
                      : "hover:bg-white/[0.04] border-l-2 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono tabular-nums shrink-0 ${
                      isActive ? "text-orange-400" : "text-zinc-500 group-hover:text-zinc-400"
                    }`}>
                      {formatTime(km.time)}
                    </span>
                    <span className={`text-[11px] font-medium truncate ${
                      isActive ? "text-orange-200" : "text-zinc-300"
                    }`}>
                      {km.label}
                    </span>
                  </div>
                  {km.description && (
                    <p className={`text-[10px] mt-0.5 leading-relaxed line-clamp-2 ${
                      isActive ? "text-orange-300/70" : "text-zinc-500"
                    }`}>
                      {km.description}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
