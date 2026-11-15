import type { MouseEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, X } from "lucide-react";
import type { CompilationSummary } from "../../lib/api";
import { PLAN_COST, aboutCost, clock } from "../../lib/format";
import { viralityLevel } from "../../lib/suggestions";
import { Tooltip } from "../ui/Tooltip";

interface Props {
  /** The live it is kept with (where it opens) */
  jobId: string;
  compilation: CompilationSummary;
  /** Its live's picture: the video itself does not exist yet */
  fallback: string | null;
  busy?: boolean;
  /** Not interested: the idea goes, and is not proposed again */
  onDismiss: () => void;
}

/** How well the AI thinks the video should do, 0 to 100: a ring that fills with it */
export function Virality({ score, size = 46 }: { score: number; size?: number }) {
  const { t } = useTranslation();
  const r = (size - 6) / 2;
  const round = 2 * Math.PI * r;
  const level = viralityLevel(score);
  return (
    <Tooltip
      content={
        <>
          <span className="block text-white">
            {t("suggestions.virality")} : {score}/100 · {t(`suggestions.level.${level}`)}
          </span>
          <span className="block mt-0.5 max-w-[240px]">{t("suggestions.viralityHint")}</span>
        </>
      }
    >
      <span tabIndex={0} role="img" aria-label={`${t("suggestions.virality")} : ${score}/100`} className="relative flex-none grid place-items-center cursor-default" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={3} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={round}
            strokeDashoffset={round * (1 - Math.min(100, Math.max(0, score)) / 100)}
            className={level === "fair" ? "opacity-60" : ""}
          />
        </svg>
        <span className="absolute mono text-[13px] font-[650] text-white">{score}</span>
      </span>
    </Tooltip>
  );
}

/**
 * A video the AI proposed on its own once the live was analysed, not built yet:
 * what it noticed, its tags, how well it should do, and one button to have it
 * built. A card of its own: there is no video to show, only an idea.
 */
export default function SuggestionCard({ jobId, compilation: c, fallback, busy = false, onDismiss }: Props) {
  const { t, i18n } = useTranslation();
  const idea = c.suggestion;
  if (!idea) return null;
  // Opening it from here builds it at once: the button says what that costs
  const to = `/${jobId}/compilation?c=${c.id}&build=1`;
  const dismiss = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  };
  return (
    <article className="group relative rounded-[18px] overflow-hidden flex flex-col border border-accent-line/50 bg-white/[0.03] transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-accent-line">
      {fallback && <img src={fallback} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover opacity-[0.14] saturate-[0.6] pointer-events-none" />}
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(130%_80%_at_0%_0%,var(--color-accent-soft),transparent_62%)]" />

      <Link to={to} aria-label={t("suggestions.buildNamed", { name: c.name })} className="relative flex-1 flex flex-col gap-2.5 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <span className="chip chip-accent h-[24px] px-2 text-[11.5px]">
            <Sparkles className="w-3 h-3" /> {t("suggestions.badge")}
          </span>
          <Virality score={idea.score} />
        </div>
        <h3 className="-mt-3 pr-14 text-[17px] font-[650] leading-[1.2] tracking-[-0.01em] text-white [text-wrap:balance]">{c.name}</h3>
        {idea.pitch && <p className="text-[13px] leading-[1.45] text-ink-2 line-clamp-4">{idea.pitch}</p>}
        {idea.tags.length > 0 && (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("suggestions.tags")}>
            {idea.tags.map((tag) => (
              <li key={tag} className="h-[22px] px-2 rounded-[7px] flex items-center bg-white/[0.08] text-[11.5px] text-ink-2">
                {tag}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-auto pt-1 text-[12px] text-ink-3">{t("suggestions.about", { length: clock(c.target ?? 45), count: idea.moments })}</p>
      </Link>

      <div className="relative px-4 pb-4 flex items-center gap-1.5">
        <Link to={to} className="btn btn-primary btn-sm flex-1 justify-center min-w-0">
          {busy ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span className="truncate">{t("suggestions.build")}</span>
          <span className="mono text-[11.5px] opacity-60 flex-none">{aboutCost(PLAN_COST, i18n.language)}</span>
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={dismiss}
          aria-label={t("suggestions.dismiss")}
          title={t("suggestions.dismiss")}
          className="flex-none w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
}
