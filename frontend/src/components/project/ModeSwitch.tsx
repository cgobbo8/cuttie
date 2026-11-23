import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Film, Layers, Scissors } from "lucide-react";
import { useSuggested } from "../../lib/suggestions";
import { VIDEO_SOURCES, sourcePath, type VideoSource } from "../../lib/videoSources";

interface Props {
  jobId: string;
  /** The source on screen: a clip, a sequence, a compilation */
  current: VideoSource;
  /** Videos the AI proposed for this live that wait to be opened, when the page knows (else asked): by source when it knows which are which */
  suggested?: number | Partial<Record<VideoSource, number>>;
  /** The page is the list of that source (else a page about one of its videos: the entry still leads to the list) */
  here?: boolean;
}

const ICONS = { clip: Scissors, sequence: Film, compilation: Layers } as const;

/**
 * The three things a live gives, at the same level: its clips (a moment each), its sequences
 * (a stretch in a row retold as one video) and its compilations (passages from all over).
 * Each leads to the live's videos of that source. Compilations carries how many videos the AI
 * proposed that nobody opened yet.
 */
export default function ModeSwitch({ jobId, current, suggested, here = false }: Props) {
  const { t } = useTranslation();
  const split = typeof suggested === "object" ? suggested : null;
  const total = useSuggested(jobId, split ? Object.values(split).reduce((sum, count) => sum + (count ?? 0), 0) : (suggested as number | undefined));
  // (a page that only knows how many wait in all shows them on the compilations, where ideas used to be)
  const waitingOf = (source: VideoSource) => (split ? (split[source] ?? 0) : source === "compilation" ? total : 0);
  const badge = (source: VideoSource, on: boolean) => {
    const waiting = waitingOf(source);
    return (
      waiting > 0 && (
        <span
          aria-label={t("suggestions.waiting", { count: waiting })}
          title={t("suggestions.waiting", { count: waiting })}
          className={`mono min-w-[18px] h-[18px] px-1 -mr-1 rounded-full grid place-items-center text-[11px] font-[700] leading-none ${on ? "bg-ground text-ink" : "bg-accent text-black"}`}
        >
          {waiting}
        </span>
      )
    );
  };
  return (
    <nav aria-label={t("project.modes")} className="glass-still inline-flex items-center gap-0.5 p-1 rounded-[13px]">
      {VIDEO_SOURCES.map((source) => {
        const Icon = ICONS[source];
        const on = source === current;
        const look = on ? "font-semibold bg-ink text-ground" : "text-ink-2 hover:bg-white/[0.08] hover:text-white transition-colors";
        const inside = (
          <>
            <Icon className="w-4 h-4" /> {t(`project.mode.${source}`)}
            {badge(source, on)}
          </>
        );
        return on && here ? (
          <span key={source} aria-current="page" className={`flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] ${look}`}>
            {inside}
          </span>
        ) : (
          <Link key={source} to={sourcePath(jobId, source)} aria-current={on ? "true" : undefined} className={`flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] ${look}`}>
            {inside}
          </Link>
        );
      })}
    </nav>
  );
}
