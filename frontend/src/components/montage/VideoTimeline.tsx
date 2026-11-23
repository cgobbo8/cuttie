import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { PlayerRef } from "@remotion/player";
import { Clapperboard, Eye, EyeOff, Loader2, Music2, Pause, Play } from "lucide-react";
import { clipThumbUrl, type Compilation } from "../../lib/api";
import { allItems } from "../../lib/compilation";
import { clock } from "../../lib/format";
import { gainAt, type MusicCurve } from "../../lib/music/curve";

/** Where a passage plays in the whole video, frames */
export interface Mark {
  id: string;
  from: number;
  to: number;
  /** Its first frame once the transition it comes in with is over */
  clear: number;
}

interface Props {
  compilation: Compilation;
  marks: Mark[];
  fps: number;
  /** The whole video, frames (what it opens with included) */
  frames: number;
  /** What it opens with, and for how long (frames): a jingle, or a moment of the video played first (a hook) */
  opening: { frames: number; hook: boolean } | null;
  /** Each passage's clip, by passage id */
  pieces: Record<string, { job: string; file: string; file_start: number | null }>;
  /** The whole video's player (`playerKey` changes when it is another one) */
  player: RefObject<PlayerRef | null>;
  playerKey: string;
  playing: boolean;
  /** The passage open to be cut */
  selected: string | null;
  onSelect: (id: string) => void;
  /** The music's level over the video, when it plays one, and the track's name */
  music: { curve: MusicCurve; name: string } | null;
  /** Passages just added (lit) */
  fresh?: Set<string>;
  /** Passages whose clip is still being cut from the live */
  waiting: number;
  /** What cuts the passage under the playhead, on the right of the bar */
  tools?: ReactNode;
}

/**
 * The whole video laid out over its length: what it opens with, its parts, each passage at its
 * own length, the music's level under them, and where the player is. A click on a passage takes
 * the video there and opens it to be cut; a click anywhere else moves the player.
 */
export default function VideoTimeline({ compilation, marks, fps, frames, opening, pieces, player, playerKey, playing, selected, onSelect, music, fresh, waiting, tools }: Props) {
  const { t } = useTranslation();
  const lanes = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState(0);
  const total = Math.max(1, frames);
  const at = (f: number) => `${Math.min(100, Math.max(0, (f / total) * 100))}%`;

  // The playhead follows the player (moved by hand, without a render per frame; the clock once a second)
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const place = (f: number) => {
      if (head.current) head.current.style.left = at(f);
      setFrame((before) => (Math.floor(before / fps) === Math.floor(f / fps) ? before : f));
    };
    const onFrame = (e: { detail: { frame: number } }) => place(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    place(p.getCurrentFrame());
    setFrame(p.getCurrentFrame());
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [playerKey, total, fps]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => new Map(allItems(compilation).map((item) => [item.id, item])), [compilation]);
  const byId = useMemo(() => new Map(marks.map((mark) => [mark.id, mark])), [marks]);
  // Each part over its passages
  const parts = compilation.sections.flatMap((section) => {
    const theirs = section.items.flatMap((item) => (byId.has(item.id) ? [byId.get(item.id)!] : []));
    return theirs.length > 0 ? [{ id: section.id, title: section.title.trim(), hidden: !!section.hidden, from: theirs[0].from, to: theirs[theirs.length - 1].to }] : [];
  });
  const named = compilation.titles && parts.some((part) => part.title);

  // The music's level, drawn over the video's length (a point every quarter of a second)
  const level = useMemo(() => {
    if (!music) return "";
    const seconds = total / fps;
    const points = Array.from({ length: Math.ceil(seconds * 4) + 1 }, (_, i) => {
      const time = Math.min(seconds, i / 4);
      return `${((time / seconds) * 100).toFixed(2)},${(100 - Math.min(1, gainAt(music.curve, time)) * 100).toFixed(1)}`;
    });
    return `0,100 ${points.join(" ")} 100,100`;
  }, [fps, music, total]);

  const seek = (clientX: number) => {
    const box = lanes.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    player.current?.seekTo(Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (total - 1)));
  };
  const marksEvery = total / fps > 150 ? 30 : total / fps > 50 ? 15 : 5;

  return (
    <section aria-label={t("montage.timeline")} className="mt-4 glass rounded-[20px] px-3.5 pt-3 pb-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <button
          onClick={() => player.current?.toggle()}
          aria-label={t(playing ? "montage.pause" : "montage.play")}
          className="w-9 h-9 flex-none rounded-full grid place-items-center bg-ink text-ground hover:brightness-90 transition-[filter]"
        >
          {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
        </button>
        <span className="mono text-[12.5px] text-ink-2 mx-1 tabular-nums">
          {clock(frame / fps)} / {clock(total / fps)}
        </span>
        {waiting > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-3">
            <Loader2 className="w-3.5 h-3.5 spinner" /> {t("compilation.cuttingCount", { count: waiting })}
          </span>
        )}
        <span className="flex-1" />
        {tools}
      </div>

      <div className="mt-3 flex gap-2.5">
        {/* What each lane is */}
        <div className="flex-none w-5 flex flex-col gap-1 text-ink-4">
          {named && <span className="h-[22px]" />}
          <span className="h-[52px]" />
          {music && (
            <span className="h-[26px] grid place-items-center" title={music.name}>
              <Music2 className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div ref={lanes} className="relative flex flex-col gap-1 cursor-pointer" onClick={(e) => !(e.target as HTMLElement).closest("button") && seek(e.clientX)}>
            {named && (
              <div className="relative h-[22px]">
                {parts.map((part) => (
                  <span
                    key={part.id}
                    className={`absolute inset-y-0 flex items-center gap-1.5 px-2 rounded-[6px] bg-white/[0.07] text-[11.5px] font-[600] whitespace-nowrap overflow-hidden ${part.hidden ? "text-ink-3" : "text-white"}`}
                    style={{ left: at(part.from), width: `calc(${at(part.to - part.from)} - 3px)` }}
                    title={part.title}
                  >
                    {part.title && (part.hidden ? <EyeOff className="w-3 h-3 flex-none" /> : <Eye className="w-3 h-3 flex-none text-ink-3" />)}
                    <span className="truncate">{part.title}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="relative h-[52px]">
              {opening && opening.frames > 0 && (
                <span className="absolute inset-y-0 left-0 flex items-center justify-center gap-1 rounded-[7px] bg-accent-soft text-accent text-[11px] font-[600] overflow-hidden" style={{ width: `calc(${at(opening.frames)} - 3px)` }} title={t(opening.hook ? "compilation.intro.style.hook" : "compilation.intro.label")}>
                  <Clapperboard className="w-3.5 h-3.5 flex-none" />
                </span>
              )}
              {marks.map((mark) => {
                const item = items.get(mark.id);
                const piece = pieces[mark.id];
                const on = mark.id === selected;
                return (
                  <button
                    key={mark.id}
                    onClick={() => onSelect(mark.id)}
                    title={item?.text || undefined}
                    aria-pressed={on}
                    className={`absolute inset-y-0 rounded-[7px] overflow-hidden bg-white/[0.06] bg-cover bg-center border-[1.5px] transition-[opacity,border-color] ${on ? "z-[1] opacity-100 border-white shadow-[0_0_0_2px_rgba(255,255,255,0.2)]" : fresh?.has(mark.id) ? "opacity-100 border-accent" : "opacity-75 hover:opacity-100 border-transparent"}`}
                    style={{
                      left: at(mark.from),
                      width: `calc(${at(mark.to - mark.from)} - 3px)`,
                      backgroundImage: piece && item && piece.file_start != null ? `url("${clipThumbUrl(piece.job, piece.file, { width: 480, time: Math.max(0, item.start - piece.file_start + 0.4) })}")` : undefined,
                    }}
                  >
                    <span className="mono absolute left-1 bottom-1 px-1 rounded-[3px] bg-black/65 text-[9.5px] leading-[14px] text-white">{clock((mark.to - mark.from) / fps)}</span>
                  </button>
                );
              })}
            </div>
            {music && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-[26px] w-full" aria-hidden>
                <polygon points={level} fill="var(--color-accent)" opacity="0.5" />
              </svg>
            )}
            <span ref={head} aria-hidden className="absolute -top-1 -bottom-1 w-[2px] -ml-px rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)] pointer-events-none" style={{ left: "0%" }} />
          </div>
          <div className="mono relative h-4 mt-1 text-[10px] text-ink-4">
            {Array.from({ length: Math.floor(total / fps / marksEvery) + 1 }, (_, i) => (
              <span key={i} className={`absolute top-0.5 ${i === 0 ? "" : "-translate-x-1/2"}`} style={{ left: at(i * marksEvery * fps) }}>
                {clock(i * marksEvery)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
