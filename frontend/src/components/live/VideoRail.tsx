import { useTranslation } from "react-i18next";
import { Check, Loader2, Plus } from "lucide-react";
import { clipThumbUrl, type Compilation } from "../../lib/api";
import { allItems } from "../../lib/compilation";
import { clock } from "../../lib/format";
import { videoFacts, type LiveEntry } from "../../lib/liveEntries";
import { VIDEO_SOURCES, type VideoSource } from "../../lib/videoSources";
import SourceName from "./SourceName";

interface Props {
  jobId: string;
  /** Everything the live gives, by source: what is kept is shown here */
  entries: Record<VideoSource, LiveEntry[]>;
  /** The live's videos (a kept clip has one once it was opened) */
  videos: Compilation[];
  /** The video on screen */
  current: Compilation | null;
  onOpenVideo: (id: string) => void;
  /** A kept clip that has no video yet: it gets one when opened */
  onOpenClip: (filename: string) => void;
  onAdd: (source: VideoSource) => void;
  /** The clip whose video is being made */
  opening?: string | null;
  /** Videos whose last export is finished, by id */
  exported?: Set<string>;
  /** Videos the AI is building right now, by id: what it is doing (they are shown here although not kept yet) */
  building?: Map<string, string>;
}

/**
 * The videos kept from this live, whatever they are made from, by source: one click goes from
 * one to the other without leaving the montage. A source with nothing kept offers to add one.
 * A video the AI is building is there too, saying so: it is on its way to being kept.
 */
export default function VideoRail({ jobId, entries, videos, current, onOpenVideo, onOpenClip, onAdd, opening = null, exported, building }: Props) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("live.keptVideos")} className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
      {VIDEO_SOURCES.map((source) => {
        // What is kept, the video on screen even when it is not, and those the AI is building
        const kept = entries[source].filter((entry) => entry.state === "kept" || (entry.kind === "video" && (entry.video.id === current?.id || !!building?.has(entry.video.id))));
        return (
          <div key={source} className="flex flex-wrap items-center gap-1.5">
            <SourceName source={source} many className="mr-0.5 text-[12px] font-[600] text-ink-3" iconClass="w-3.5 h-3.5" />
            {kept.map((entry) => {
              const video = entry.kind === "video" ? entry.video : (videos.find((other) => other.clip === entry.moment.filename) ?? null);
              const on = !!video && video.id === current?.id;
              const piece = video ? allItems(video).find((item) => item.ready && item.file) : undefined;
              const thumb = entry.kind === "moment" ? clipThumbUrl(jobId, entry.moment.filename) : piece ? clipThumbUrl(piece.job ?? jobId, piece.file!) : null;
              const name = entry.kind === "moment" ? (video?.name ?? entry.moment.hp.clip_name ?? "") : entry.video.name;
              const seconds = video ? videoFacts(video).seconds : entry.kind === "moment" ? entry.moment.pieces.reduce((sum, [a, b]) => sum + b - a, 0) : 0;
              const busy = entry.kind === "moment" && opening === entry.moment.filename;
              // The AI is at work on it: what it is doing takes the place of its length
              const doing = video ? building?.get(video.id) : undefined;
              return (
                <button
                  key={entry.key}
                  onClick={() => (video ? onOpenVideo(video.id) : entry.kind === "moment" && onOpenClip(entry.moment.filename))}
                  aria-current={on ? "true" : undefined}
                  disabled={busy}
                  title={doing !== undefined ? `${t("live.building")}${doing ? ` — ${doing}` : ""}` : undefined}
                  className={`flex items-center gap-2.5 h-[46px] pl-1.5 pr-3 rounded-[13px] border text-left transition-colors ${on ? "bg-white/[0.14] border-white/30" : doing !== undefined ? "bg-accent-soft border-accent-line hover:border-accent" : "bg-[rgba(16,16,18,0.5)] border-white/[0.08] hover:border-white/20"}`}
                >
                  <span className="relative w-[26px] h-[34px] flex-none rounded-[6px] overflow-hidden bg-white/[0.06]">
                    {thumb && <img src={thumb} alt="" loading="lazy" className="w-full h-full object-cover" />}
                    {(busy || doing !== undefined) && (
                      <span className="absolute inset-0 grid place-items-center bg-black/55">
                        <Loader2 className={`w-3 h-3 spinner ${doing !== undefined ? "text-accent" : "text-white"}`} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block max-w-[150px] truncate text-[13px] font-[560] text-white">{name}</span>
                    {doing !== undefined ? (
                      <span className="block max-w-[150px] truncate text-[11px] text-accent">{doing || t("live.building")}</span>
                    ) : (
                      <span className="mono flex items-center gap-1 text-[11px] text-ink-3">
                        {clock(seconds)}
                        {video && exported?.has(video.id) && <Check className="w-3 h-3 text-accent" strokeWidth={3} aria-label={t("live.exported")} />}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {kept.length === 0 && (
              <button onClick={() => onAdd(source)} className="h-[46px] px-3 rounded-[13px] border border-dashed border-white/[0.16] hover:border-accent-line text-[12.5px] text-ink-2 hover:text-white inline-flex items-center gap-1.5 transition-colors">
                <Plus className="w-3.5 h-3.5" /> {t(`sources.add.${source}`)}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
