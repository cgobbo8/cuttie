import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Eye, Loader2 } from "lucide-react";
import { clipThumbUrl, type LiveClip } from "../../lib/api";
import { clock } from "../../lib/format";

interface Props {
  jobId: string;
  clip: LiveClip;
  /** It is being opened as a video */
  busy?: boolean;
  onOpen: () => void;
}

/**
 * A clip the analysis found, as the library shows it next to the sequences and the compilations:
 * its picture, its title, what is in it, how the analysis came to it, and one way in. Opening it
 * makes it a video like the others (one passage, the same dressing, the same export).
 */
export default function ClipCard({ jobId, clip, busy = false, onOpen }: Props) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={busy}
      aria-label={`${t("videos.open")} : ${clip.name}`}
      className="group relative rounded-[18px] overflow-hidden flex flex-col text-left border border-white/[0.09] bg-white/[0.03] transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-accent-line disabled:cursor-wait"
    >
      <span className="relative block aspect-video bg-black/40 overflow-hidden">
        <img src={clipThumbUrl(jobId, clip.filename, { width: 480 })} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
        {/* Said only when it tells this clip from the others: the AI found it by looking at the picture */}
        {clip.found_by === "watching" && (
          <span className="absolute left-2.5 top-2.5 chip chip-accent h-[24px] px-2 text-[11.5px]">
            <Eye className="w-3 h-3" /> {t("videos.watched")}
          </span>
        )}
        <span className="absolute right-2.5 top-2.5 mono h-[24px] px-2 rounded-[8px] grid place-items-center bg-black/60 text-[12px] font-[650] text-white">{clip.score}</span>
        <span className="absolute right-2.5 bottom-2.5 mono h-[22px] px-1.5 rounded-[7px] grid place-items-center bg-black/60 text-[11.5px] text-white">{clock(clip.length)}</span>
      </span>
      <span className="flex-1 flex flex-col gap-2 p-4 pb-3">
        <span className="text-[16px] font-[650] leading-[1.2] tracking-[-0.01em] text-white [text-wrap:balance]">{clip.name}</span>
        {(clip.seen || clip.pitch) && <span className="text-[13px] leading-[1.45] text-ink-2 line-clamp-3">{clip.seen || clip.pitch}</span>}
        {clip.tags.length > 0 && <span className="mono text-[11.5px] text-ink-3 truncate">{clip.tags.join(" · ")}</span>}
        <span className="mt-auto pt-1 flex items-center justify-between gap-2 text-[12px] text-ink-3">
          <span className="flex items-center gap-1.5 min-w-0">
            {clip.state === "kept" && (
              <>
                <Check className="w-3.5 h-3.5 flex-none text-accent" strokeWidth={2.6} /> <span className="truncate">{t("videos.kept")}</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-white font-[550] flex-none">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {t(busy ? "videos.opening" : "videos.open")} {!busy && <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />}
          </span>
        </span>
      </span>
    </button>
  );
}
