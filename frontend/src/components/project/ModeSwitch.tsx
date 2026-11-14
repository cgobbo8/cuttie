import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Layers, Scissors } from "lucide-react";

interface Props {
  jobId: string;
  current: "clips" | "compilations";
}

/** The two things a live gives: its clips (analyse, choose, edit, export) and the compilations made of its passages */
export default function ModeSwitch({ jobId, current }: Props) {
  const { t } = useTranslation();
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
          </span>
        ) : (
          <Link key={key} to={to} className="flex items-center gap-2 h-9 px-3.5 rounded-[9px] text-[13.5px] text-ink-2 hover:bg-white/[0.08] hover:text-white transition-colors">
            <Icon className="w-4 h-4" /> {t(`project.mode.${key}`)}
          </Link>
        ),
      )}
    </nav>
  );
}
