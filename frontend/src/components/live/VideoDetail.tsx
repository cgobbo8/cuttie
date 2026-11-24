import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Sparkles, Trash2, X, Loader2 } from "lucide-react";
import { clipThumbUrl, type TwitchStoryboard } from "../../lib/api";
import { allItems, liveClock } from "../../lib/compilation";
import { PLAN_COST, aboutCost, clock } from "../../lib/format";
import { videoFacts, videoMoments, type LiveEntry } from "../../lib/liveEntries";
import { frameAt, tileStyle } from "../../lib/storyboard";
import { Virality } from "../compilation/SuggestionCard";
import SourceName from "./SourceName";

interface Props {
  jobId: string;
  entry: Extract<LiveEntry, { kind: "video" }>;
  storyboard: TwitchStoryboard | null;
  /** An idea: have it built (it then is a video of this live) */
  onKeep: () => void;
  /** An idea: passed on, or taken back */
  onPass: () => void;
  /** A video: on to its montage */
  onOpen: () => void;
  onRemove: () => void;
  busy?: boolean;
  /** The AI is building it behind the page: what it is doing right now ("" : nothing said yet) */
  building?: string | null;
}

/**
 * A sequence or a compilation of the live, as the list's clip is shown by its player: where it
 * is in the live (a few pictures), what it is, and the same two decisions under it. An idea of
 * the AI is kept by having it built; a video already made goes on to its montage.
 */
export default function VideoDetail({ jobId, entry, storyboard, onKeep, onPass, onOpen, onRemove, busy = false, building = null }: Props) {
  const { t, i18n } = useTranslation();
  const video = entry.video;
  const facts = videoFacts(video);
  const idea = video.suggestion;
  // Its own passages once it is built (their clips are there), else the moments the AI spotted in the live
  const pieces = allItems(video).filter((item) => item.ready && item.file);
  const shots = pieces.length > 0 ? pieces.filter((_, i) => pieces.length <= 5 || i % Math.ceil(pieces.length / 5) === 0).slice(0, 5) : [];
  const moments = shots.length === 0 ? videoMoments(video) : [];
  const said = idea?.pitch || video.answer || video.brief || "";

  return (
    <div className="glass rounded-[20px] p-3.5">
      <div className="grid grid-cols-5 gap-2">
        {shots.map((item) => (
          <div key={item.id} className="relative aspect-video rounded-[10px] overflow-hidden bg-white/5">
            <img src={clipThumbUrl(item.job ?? jobId, item.file!, { width: 480 })} alt="" loading="lazy" className="w-full h-full object-cover" />
            <span className="mono absolute left-1.5 bottom-1.5 h-[17px] px-[5px] rounded-[4px] flex items-center bg-black/70 text-[10.5px] text-white">{liveClock(item.start)}</span>
          </div>
        ))}
        {moments.map((at) => (
          <div key={at} className="relative aspect-video rounded-[10px] overflow-hidden bg-white/5" style={storyboard ? tileStyle(storyboard, frameAt(storyboard, at)) : undefined}>
            <span className="mono absolute left-1.5 bottom-1.5 h-[17px] px-[5px] rounded-[4px] flex items-center bg-black/70 text-[10.5px] text-white">{liveClock(at)}</span>
          </div>
        ))}
        {shots.length === 0 && moments.length === 0 && <div className="col-span-5 h-[92px] rounded-[10px] bg-white/[0.04]" />}
      </div>

      {/* The same row as under a clip: what it is on the left, the two decisions on the right */}
      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-3 px-1.5 pb-3.5 border-b border-white/[0.08]">
        <div className="flex-[1_1_320px] min-w-0 flex items-center gap-3">
          {entry.score != null && <Virality score={entry.score} size={42} />}
          <div className="min-w-0">
            <h2 className="text-[20px] leading-[1.2] tracking-[-0.02em] font-[620] text-white [text-wrap:balance]">{video.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SourceName source={entry.source} className="chip chip-neutral h-[22px] font-[550]" iconClass="w-3 h-3" />
              {entry.state === "kept" && (
                <span className="chip chip-accent h-[22px]">
                  <Check className="w-3 h-3" strokeWidth={3} /> {t("live.keptChip")}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5 ml-auto">
          {building !== null ? (
            // Kept: the AI builds it while the streamer goes on sorting
            <div role="status" aria-live="polite" className="h-12 max-w-[360px] pl-3.5 pr-4 rounded-[14px] bg-accent-soft border border-accent-line flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 flex-none spinner text-accent" />
              <span className="min-w-0">
                <b className="block text-[13px] font-[600] leading-tight text-white">{t("live.building")}</b>
                <span className="block truncate text-[11.5px] leading-tight text-ink-2">{building || t("live.buildingHint")}</span>
              </span>
            </div>
          ) : entry.idea ? (
            <>
              <button onClick={onPass} disabled={busy} className={`btn btn-lg pr-3 ${entry.state === "passed" ? "bg-white/[0.18] text-white border border-white/20" : "btn-glass"}`}>
                <X className="w-[15px] h-[15px]" strokeWidth={2.4} />
                {entry.state === "passed" ? t("live.passedIdea") : t("project.pass")}
                <kbd className="bg-white/[0.08] border-white/10 text-ink-2">X</kbd>
              </button>
              <button onClick={onKeep} disabled={busy} className="btn btn-lg btn-primary pr-3">
                <Sparkles className="w-[15px] h-[15px]" />
                {t("project.keep")}
                <span className="mono text-[11.5px] opacity-60">{aboutCost(PLAN_COST, i18n.language)}</span>
                <kbd>G</kbd>
              </button>
            </>
          ) : (
            <>
              <button onClick={onRemove} disabled={busy} aria-label={t("compilation.delete")} title={t("compilation.delete")} className="btn btn-lg btn-glass px-3.5">
                <Trash2 className="w-[15px] h-[15px]" />
              </button>
              <button onClick={onOpen} className="btn btn-lg btn-accent">
                {t("project.step.edit")} <ArrowRight className="w-[15px] h-[15px]" strokeWidth={2.4} />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="px-1.5 pt-3.5 pb-1">
        {said && <p className="text-[14px] leading-relaxed text-ink-2 max-w-[72ch]">{said}</p>}
        <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
          {entry.idea ? (
            <>
              <span>{facts.span ? t("live.idea.sequence", { minutes: Math.round((facts.span[1] - facts.span[0]) / 60), from: liveClock(facts.span[0]), to: liveClock(facts.span[1]) }) : t("live.idea.compilation", { count: facts.moments })}</span>
              <span>{t("live.idea.makes", { length: clock(facts.seconds) })}</span>
              <span className="text-ink-3">{t("live.idea.unbuilt")}</span>
            </>
          ) : (
            <span>
              <span className="mono font-semibold text-white">{clock(facts.seconds)}</span> · {t("compilation.moments", { count: facts.passages })}
            </span>
          )}
        </p>
        {idea && idea.tags.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[12px] text-ink-3" aria-label={t("suggestions.tags")}>
            {idea.tags.map((tag) => (
              <li key={tag}>#{tag}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
