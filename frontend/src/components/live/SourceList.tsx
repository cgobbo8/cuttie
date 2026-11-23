import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Eye, Loader2, Plus, Sparkles, X } from "lucide-react";
import { clipThumbUrl, type TwitchStoryboard } from "../../lib/api";
import { allItems } from "../../lib/compilation";
import { clock } from "../../lib/format";
import { ideasToSee, SHOWN, videoFacts, videoMoments, type EntryState, type LiveEntry } from "../../lib/liveEntries";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { VIDEO_SOURCES, type VideoSource } from "../../lib/videoSources";
import { Tooltip } from "../ui/Tooltip";
import SourceName from "./SourceName";

interface Props {
  jobId: string;
  entries: Record<VideoSource, LiveEntry[]>;
  /** The entry on screen (its key) */
  selected: string | null;
  onSelect: (entry: LiveEntry) => void;
  /** Sections shown whole */
  open: Partial<Record<VideoSource, boolean>>;
  onToggle: (source: VideoSource) => void;
  /** « Add a clip / a sequence / a compilation » */
  onAdd: (source: VideoSource) => void;
  /** The live's preview frames: the picture of an idea that has no clip yet */
  storyboard: TwitchStoryboard | null;
  categoryLabel: (category: string | undefined) => string | null;
  /** The AI is looking through the live for videos to propose */
  looking?: boolean;
  /** Beside « Clips » (a file of one's own) */
  clipAction?: ReactNode;
  footer?: ReactNode;
}

function StateIcon({ state, idea }: { state: EntryState; idea?: boolean }) {
  if (state === "kept") {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex-none grid place-items-center bg-accent text-accent-ink">
        <Check className="w-3 h-3" strokeWidth={3.4} />
      </span>
    );
  }
  if (state === "passed") {
    return (
      <span className="w-[22px] h-[22px] rounded-full flex-none grid place-items-center bg-white/[0.08] text-ink-3">
        <X className="w-[11px] h-[11px]" strokeWidth={3} />
      </span>
    );
  }
  // Still to see: an idea of the AI says so
  return idea ? (
    <span className="w-[22px] h-[22px] rounded-full flex-none grid place-items-center bg-accent-soft text-accent">
      <Sparkles className="w-3 h-3" />
    </span>
  ) : (
    <span className="w-[22px] h-[22px] rounded-full flex-none border-[1.5px] border-white/30" />
  );
}

/**
 * Everything the live gives, in one list: its clips, its sequences, its compilations. The best
 * of each first; a long section shows its first ones and the rest a click away. Each section
 * ends on a way to add one, so an empty section is never a dead end.
 */
export default function SourceList({ jobId, entries, selected, onSelect, open, onToggle, onAdd, storyboard, categoryLabel, looking = false, clipAction, footer }: Props) {
  const { t } = useTranslation();
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const row = (entry: LiveEntry) => {
    const on = entry.key === selected;
    const base = `flex items-center gap-3 w-full p-[7px] rounded-[12px] text-left transition-colors ${on ? "bg-white/[0.11] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" : "hover:bg-white/[0.06]"} ${entry.state === "passed" && !on ? "opacity-50" : ""}`;
    if (entry.kind === "moment") {
      const m = entry.moment;
      return (
        <button key={entry.key} ref={on ? selectedRef : undefined} onClick={() => onSelect(entry)} className={base}>
          <span className="relative w-[84px] h-[47px] flex-none rounded-[8px] overflow-hidden bg-white/5">
            <img src={clipThumbUrl(jobId, m.filename, { version: `${m.start}-${m.end}` })} alt="" loading="lazy" className="w-full h-full object-cover" />
            <span className="mono absolute left-1 bottom-1 h-[16px] px-1 rounded-[4px] flex items-center bg-black/75 text-[10px] text-white">{clock(m.pieces.reduce((sum, [a, b]) => sum + b - a, 0))}</span>
          </span>
          <span className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-[550] text-white truncate">{m.hp.clip_name}</span>
            <span className="text-[12px] text-ink-3 truncate flex items-center gap-1.5">
              {m.hp.found_by === "watching" && <Eye className="w-3 h-3 flex-none text-accent" aria-label={t("videos.watched")} />}
              <span className="mono">{m.hp.timestamp_display}</span>
              {categoryLabel(m.hp.llm?.category) && <span className="truncate">· {categoryLabel(m.hp.llm?.category)}</span>}
            </span>
            {m.duplicateOf && (
              <span className="flex items-center gap-1 text-[11.5px] text-amber-200/80">
                <Copy className="w-3 h-3" /> {t("project.samePassage", { rank: m.duplicateOf.rank })}
              </span>
            )}
          </span>
          <span className="mono text-[13px] font-semibold text-ink-2">{m.score}</span>
          <StateIcon state={m.state} />
        </button>
      );
    }
    const video = entry.video;
    const facts = videoFacts(video);
    const piece = allItems(video).find((item) => item.ready && item.file);
    const at = videoMoments(video, 1)[0] ?? facts.span?.[0];
    return (
      <button key={entry.key} ref={on ? selectedRef : undefined} onClick={() => onSelect(entry)} className={base}>
        <span className="relative w-[84px] h-[47px] flex-none rounded-[8px] overflow-hidden bg-white/5" style={!piece && storyboard && at != null ? tileStyle(storyboard, frameAt(storyboard, at)) : undefined}>
          {piece && <img src={clipThumbUrl(piece.job ?? jobId, piece.file!, { width: 480 })} alt="" loading="lazy" className="w-full h-full object-cover" />}
          <span className="mono absolute left-1 bottom-1 h-[16px] px-1 rounded-[4px] flex items-center bg-black/75 text-[10px] text-white">{clock(facts.seconds)}</span>
        </span>
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-[13.5px] font-[550] text-white truncate">{video.name}</span>
          <span className="text-[12px] text-ink-3 truncate">
            {entry.idea
              ? facts.span
                ? t("live.sub.sequence", { minutes: Math.round((facts.span[1] - facts.span[0]) / 60) })
                : t("live.sub.compilation", { count: facts.moments })
              : t("live.sub.built", { count: facts.passages })}
          </span>
        </span>
        {entry.score != null && <span className="mono text-[13px] font-semibold text-ink-2">{entry.score}</span>}
        <StateIcon state={entry.state} idea={entry.idea} />
      </button>
    );
  };

  return (
    <aside className="glass rounded-[20px] p-3 flex flex-col min-h-0">
      <div className="flex flex-col overflow-y-auto max-h-[calc(100dvh-250px)] min-h-[320px] -mx-1 px-1">
        {VIDEO_SOURCES.map((source) => {
          const list = entries[source];
          const whole = open[source] || list.findIndex((entry) => entry.key === selected) >= SHOWN;
          const waiting = ideasToSee(entries, source);
          return (
            <section key={source} aria-label={t(`project.mode.${source}`)} className="pb-2">
              <header className="sticky top-0 z-[2] flex items-center gap-2 h-9 px-1.5 rounded-[9px] bg-[#161618]/95">
                <SourceName source={source} many className="text-[13.5px] font-[620] text-white" iconClass="w-4 h-4 text-ink-2" />
                <span className="mono text-[12px] text-ink-3">{list.length}</span>
                {waiting > 0 && (
                  <Tooltip content={t("live.ideasToSee", { count: waiting })} side="bottom">
                    <span tabIndex={0} className="mono min-w-[18px] h-[18px] px-1 rounded-full grid place-items-center bg-accent text-[11px] font-[700] leading-none text-black cursor-default">
                      {waiting}
                    </span>
                  </Tooltip>
                )}
                {looking && source !== "clip" && <Loader2 className="w-3.5 h-3.5 spinner text-accent" aria-label={t("suggestions.looking")} />}
                <span className="flex-1" />
                {source === "clip" && clipAction}
              </header>
              <div className="flex flex-col gap-0.5">{(whole ? list : list.slice(0, SHOWN)).map(row)}</div>
              {list.length > SHOWN && (
                <button onClick={() => onToggle(source)} className="mt-0.5 w-full h-8 rounded-[9px] text-[12.5px] text-ink-2 hover:text-white hover:bg-white/[0.06] transition-colors">
                  {whole ? t("live.less") : t("live.more", { count: list.length - SHOWN })}
                </button>
              )}
              {/* (an empty section is not a dead end: this is all it shows) */}
              <button onClick={() => onAdd(source)} className="mt-1 w-full h-9 rounded-[10px] border border-dashed border-white/[0.14] hover:border-accent-line text-[12.5px] text-ink-2 hover:text-white inline-flex items-center justify-center gap-1.5 transition-colors">
                <Plus className="w-3.5 h-3.5" /> {t(`sources.add.${source}`)}
              </button>
            </section>
          );
        })}
      </div>
      {footer}
    </aside>
  );
}
