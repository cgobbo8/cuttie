import { useTranslation } from "react-i18next";
import { Film, Layers, Scissors } from "lucide-react";
import type { VideoSource } from "../../lib/videoSources";
import { Tooltip } from "../ui/Tooltip";

export const SOURCE_ICONS = { clip: Scissors, sequence: Film, compilation: Layers } as const;

interface Props {
  source: VideoSource;
  /** « Clips » rather than « Clip » */
  many?: boolean;
  className?: string;
  iconClass?: string;
}

/**
 * The name of one of the three sources of a video, wherever the app writes it: hovered, it
 * says what that source is (a clip, a sequence and a compilation are the app's own words).
 */
export default function SourceName({ source, many = false, className = "", iconClass = "w-4 h-4" }: Props) {
  const { t } = useTranslation();
  const Icon = SOURCE_ICONS[source];
  return (
    <Tooltip content={t(`sources.tip.${source}`)} side="bottom" wide>
      <span tabIndex={0} className={`inline-flex items-center gap-1.5 cursor-default outline-none ${className}`}>
        <Icon className={`${iconClass} flex-none`} />
        {t(many ? `project.mode.${source}` : `sources.one.${source}`)}
      </span>
    </Tooltip>
  );
}
