import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { getStoryboard, type TwitchStoryboard } from "../../lib/api";
import type { Moment } from "../../lib/moments";
import { busyThreshold } from "../../lib/chatActivity";
import { evenFrames, tileStyle } from "../../lib/storyboard";

interface Props {
  vodId: string | null;
  durationSeconds: number;
  moments: Moment[];
  selected: number;
  onSelect: (index: number) => void;
  /** Chat messages per slice of the live (analysis timeline), and the length they cover */
  chat?: number[] | null;
  chatDuration?: number | null;
}

/** The whole live as a strip of frames, with every moment pinned where it happened and the chat's activity */
export default function VodTimeline({ vodId, durationSeconds, moments, selected, onSelect, chat, chatDuration }: Props) {
  const { t } = useTranslation();
  const [storyboard, setStoryboard] = useState<TwitchStoryboard | null>(null);
  const tiles = 24;

  useEffect(() => {
    if (!vodId) return;
    getStoryboard(vodId).then(setStoryboard).catch(() => setStoryboard(null));
  }, [vodId]);

  // A moment just kept pops a ring (not the ones already kept when the page opened)
  const lastState = useRef(new Map<string, string>());
  const pops = useRef(new Map<string, number>());
  for (const m of moments) {
    const before = lastState.current.get(m.filename);
    if (before !== undefined && before !== "kept" && m.state === "kept") pops.current.set(m.filename, (pops.current.get(m.filename) ?? 0) + 1);
    lastState.current.set(m.filename, m.state);
  }

  const at = (seconds: number) => `${Math.min(100, Math.max(0, (seconds / Math.max(durationSeconds, 1)) * 100))}%`;
  const current = moments[selected];
  const bars = chat?.length ? chat : null;
  const hours = Array.from({ length: Math.floor(durationSeconds / 3600) }, (_, i) => i + 1).filter(
    (h) => (h * 3600) / durationSeconds < (bars ? 0.9 : 0.97),
  );

  // Chat: one bar per slice (square root: a spike doesn't flatten the rest), the busiest tenth brighter
  const slice = (chatDuration || durationSeconds) / Math.max(bars?.length ?? 1, 1);
  const chatMax = Math.max(1, ...(bars ?? [0]));
  const hot = busyThreshold(bars ?? []);

  return (
    <div className="glass rounded-[16px] px-3 pt-2.5 pb-1">
      <div className="relative h-[58px]">
        <div className="absolute inset-x-0 top-0 h-10 rounded-[8px] overflow-hidden flex bg-white/[0.04]">
          {storyboard &&
            evenFrames(storyboard, tiles).map((frame, k) => (
              <div key={k} className="flex-1 h-full brightness-[0.5] saturate-[0.9]" style={tileStyle(storyboard, frame)} />
            ))}
          {bars?.map((count, i) =>
            count > 0 ? (
              <span
                key={i}
                aria-hidden
                className="chat-bar"
                data-hot={count >= hot || undefined}
                style={{ left: at(i * slice + slice * 0.25), width: at(slice * 0.5), height: 2 + 14 * Math.sqrt(count / chatMax), "--i": i } as CSSProperties}
              />
            ) : null,
          )}
        </div>
        {moments.map((m, i) => {
          const isSelected = i === selected;
          const pop = m.state === "kept" ? pops.current.get(m.filename) : undefined;
          return (
            <button
              key={m.filename}
              onClick={() => onSelect(i)}
              aria-label={`#${m.rank} ${m.hp.clip_name}`}
              title={`#${m.rank} · ${m.hp.clip_name}`}
              data-state={isSelected ? "selected" : m.state}
              className={`moment-dot ${isSelected ? "z-[3]" : m.state === "kept" ? "z-[2]" : ""}`}
              style={{ left: at((m.start + m.end) / 2) }}
            >
              <span>{pop ? <span key={pop} className="ring-out" /> : null}</span>
            </button>
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
        {bars && (
          <span className="absolute right-0 top-0.5 inline-flex items-center gap-1.5 font-sans">
            <span className="w-1 h-2.5 rounded-[1px] bg-white/60" />
            {t("project.timelineChat")}
          </span>
        )}
        <span className="sr-only">{t("project.timeline")}</span>
      </div>
    </div>
  );
}
