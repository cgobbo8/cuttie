import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStoryboard, type TwitchStoryboard } from "../../lib/api";
import type { Moment } from "../../lib/moments";
import { evenFrames, tileStyle } from "../../lib/storyboard";

interface Props {
  vodId: string | null;
  durationSeconds: number;
  moments: Moment[];
  selected: number;
  onSelect: (index: number) => void;
}

/** The whole live as a strip of frames, with every moment pinned where it happened */
export default function VodTimeline({ vodId, durationSeconds, moments, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null>(null);
  const tiles = 24;

  useEffect(() => {
    if (!vodId) return;
    getStoryboard(vodId).then(setStoryboard).catch(() => setStoryboard(null));
  }, [vodId]);

  const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(durationSeconds, 1)) * 100))}%`;
  const current = moments[selected];
  const hours = Array.from({ length: Math.floor(durationSeconds / 3600) }, (_, i) => i + 1).filter((h) => (h * 3600) / durationSeconds < 0.97);

  return (
    <div className="glass rounded-[16px] px-3 pt-2.5 pb-1">
      <div className="relative h-[58px]">
        <div className="absolute inset-x-0 top-0 h-10 rounded-[8px] overflow-hidden flex bg-white/[0.04]">
          {storyboard &&
            evenFrames(storyboard, tiles).map((frame, k) => (
              <div key={k} className="flex-1 h-full brightness-[0.5] saturate-[0.9]" style={tileStyle(storyboard, frame)} />
            ))}
        </div>
        {moments.map((m, i) => {
          const isSelected = i === selected;
          const look = isSelected
            ? "w-[15px] h-[15px] bg-ink shadow-[0_0_0_3px_var(--color-accent-line),0_0_18px_var(--color-accent)] z-[3]"
            : m.state === "kept"
              ? "w-2.5 h-2.5 bg-accent shadow-[0_0_0_2px_rgba(11,11,12,0.85)] z-[2]"
              : m.state === "passed"
                ? "w-1.5 h-1.5 bg-white/35"
                : "w-[9px] h-[9px] bg-black/60 border-[1.5px] border-white/80";
          return (
            <button
              key={m.filename}
              onClick={() => onSelect(i)}
              aria-label={`#${m.rank} ${m.hp.clip_name}`}
              title={`#${m.rank} · ${m.hp.clip_name}`}
              className={`absolute top-5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-125 ${look}`}
              style={{ left: at((m.start + m.end) / 2) }}
            />
          );
        })}
        {current && (
          <span
            className="absolute top-[42px] -translate-x-1/2 text-[11px] font-semibold text-white whitespace-nowrap"
            style={{ left: `clamp(60px, ${at((current.start + current.end) / 2)}, calc(100% - 60px))` }}
          >
            {current.hp.clip_name}
          </span>
        )}
      </div>
      <div className="mono relative h-[18px] text-[11px] text-ink-3">
        <span className="absolute left-0 top-0.5">0:00</span>
        {hours.map((h) => (
          <span key={h} className="absolute top-0.5 -translate-x-1/2" style={{ left: at(h * 3600) }}>
            {h}:00
          </span>
        ))}
        <span className="sr-only">{t("project.timeline")}</span>
      </div>
    </div>
  );
}
