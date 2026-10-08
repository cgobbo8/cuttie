import { Link } from "react-router";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";

export type ProjectStep = "analyze" | "choose" | "edit" | "export";

const STEPS: ProjectStep[] = ["analyze", "choose", "edit", "export"];

interface Props {
  current: ProjectStep;
  /** Steps that can't be opened yet */
  locked?: ProjectStep[];
  /** Where each reachable step leads */
  links?: Partial<Record<ProjectStep, string>>;
  /** Extra text after the current step's name (e.g. "6 gardés") */
  detail?: string;
}

/** Analyse → Choisir → Monter → Exporter, always visible on a project */
export default function Stepper({ current, locked = [], links = {}, detail }: Props) {
  const { t } = useTranslation();
  const currentIndex = STEPS.indexOf(current);

  return (
    <nav aria-label={t("project.steps")} className="glass flex items-center gap-0.5 p-1 rounded-[13px]">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const isCurrent = i === currentIndex;
        const content = (
          <>
            <span
              className={`w-[22px] h-[22px] rounded-[7px] grid place-items-center text-[12px] mono ${
                isCurrent ? "bg-ground text-ink" : done ? "bg-accent-soft text-accent" : "bg-white/[0.08]"
              }`}
            >
              {done ? <Check className="w-3 h-3" strokeWidth={3.2} /> : i + 1}
            </span>
            {t(`project.step.${step}`)}
            {isCurrent && detail && <span className="font-medium opacity-60">· {detail}</span>}
          </>
        );
        const base = "flex items-center gap-2 h-9 pl-2 pr-3.5 rounded-[9px] text-[13.5px] transition-colors";
        if (isCurrent) {
          return (
            <span key={step} aria-current="step" className={`${base} bg-ink text-ground font-semibold`}>
              {content}
            </span>
          );
        }
        const to = links[step];
        if (to && !locked.includes(step)) {
          return (
            <Link key={step} to={to} className={`${base} ${done ? "text-ink-2" : "text-ink-3"} hover:bg-white/[0.08] hover:text-white`}>
              {content}
            </Link>
          );
        }
        return (
          <span key={step} className={`${base} text-ink-4`} aria-disabled="true">
            {content}
          </span>
        );
      })}
    </nav>
  );
}
