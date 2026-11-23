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
  /** The live's sequences: the stretch each one tells (live seconds) */
  spans?: { key: string; start: number; end: number; name: string; state: "todo" | "kept" | "passed" }[];
  /** The sequence on screen (then no clip is) */
  selectedSpan?: string | null;
  onSelectSpan?: (key: string) => void;
  /** The moments of the compilation on screen (live seconds) */
  ticks?: number[];
  /** Named under the strip when what is on screen is not a clip (`at`: where, live seconds) */
  label?: { at: number; text: string } | null;
}

/**
 * The whole live as a strip of frames, with what each source takes from it: a dot where each clip
 * happened, a stretch for each sequence, the scattered moments of the compilation on screen; and
 * the chat's activity.
 */
export default function VodTimeline({ vodId, durationSeconds, moments, selected, onSelect, chat, chatDuration, spans = [], selectedSpan = null, onSelectSpan, ticks = [], label = null }: Props) {
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
  const current = selected >= 0 ? moments[selected] : undefined;
  // What is named under the strip: the clip on screen, else the sequence or the compilation that is
  const named = current ? { at: (current.start + current.end) / 2, text: current.hp.clip_name ?? "" } : label;
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
        {/* A sequence is a stretch of the live in a row */}
        {spans.map((span) => (
          <button
            key={span.key}
            onClick={() => onSelectSpan?.(span.key)}
            aria-label={span.name}
            title={span.name}
            className={`absolute top-1 h-8 rounded-[6px] border transition-colors ${
              span.key === selectedSpan
                ? "z-[1] bg-white/35 border-white"
                : span.state === "kept"
                  ? "bg-accent-soft border-accent-line hover:bg-accent/30"
                  : span.state === "passed"
                    ? "bg-white/[0.06] border-white/15"
                    : "bg-white/[0.16] border-white/35 hover:bg-white/25"
            }`}
            style={{ left: at(span.start), width: `max(6px, calc(${at(span.end)} - ${at(span.start)}))` }}
          />
        ))}
        {/* A compilation takes moments from all over */}
        {ticks.map((seconds) => (
          <span key={seconds} aria-hidden className="absolute top-0 w-[3px] -ml-px h-10 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent-glow)]" style={{ left: at(seconds) }} />
        ))}
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
        {named && (
          <span
            className="absolute top-[42px] -translate-x-1/2 max-w-[60%] truncate text-[11px] font-semibold text-white whitespace-nowrap"
            style={{ left: `clamp(60px, ${at(named.at)}, calc(100% - 60px))` }}
          >
            {named.text}
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
