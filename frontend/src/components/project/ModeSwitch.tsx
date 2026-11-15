import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Layers, Scissors } from "lucide-react";
import { useSuggested } from "../../lib/suggestions";

interface Props {
  jobId: string;
  current: "clips" | "compilations";
  /** Videos the AI proposed for this live that wait to be opened, when the page knows (else asked) */
  suggested?: number;
}

/**
 * The two things a live gives: its clips (analyse, choose, edit, export) and the compilations
 * made of its passages. Compilations carries how many the AI proposed that nobody opened yet.
 */
export default function ModeSwitch({ jobId, current, suggested }: Props) {
  const { t } = useTranslation();
  const waiting = useSuggested(jobId, suggested);
  const badge = (on: boolean) =>
    waiting > 0 && (
      <span
        aria-label={t("suggestions.waiting", { count: waiting })}
        title={t("suggestions.waiting", { count: waiting })}
        className={`mono min-w-[18px] h-[18px] px-1 -mr-1 rounded-full grid place-items-center text-[11px] font-[700] leading-none ${on ? "bg-ground text-ink" : "bg-accent text-black"}`}
      >
        {waiting}
      </span>
    );
  const modes = [
    { key: "clips" as const, to: `/${jobId}`, icon: Scissors },
    { key: "compilations" as const, to: `/${jobId}/compilations`, icon: Layers },
  ];
  return (
    <nav aria-label={t("project.modes")} className="glass inline-flex items-center gap-0.5 p-1 rounded-[13px]">
      {modes.map(({ key, to, icon: Icon }) =>
        key === current ? (
          <span key={key} aria-current="page" className="flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] font-semibold bg-ink text-ground">
            <Icon className="w-4 h-4" /> {t(`project.mode.${key}`)}
            {key === "compilations" && badge(true)}
          </span>
        ) : (
          <Link key={key} to={to} className="flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] text-ink-2 hover:bg-white/[0.08] hover:text-white transition-colors">
            <Icon className="w-4 h-4" /> {t(`project.mode.${key}`)}
            {key === "compilations" && badge(false)}
          </Link>
        ),
      )}
    </nav>
  );
}
