import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, X } from "lucide-react";
import { clipThumbUrl } from "../../lib/api";
import { clock } from "../../lib/format";
import { countStates, type Moment, type MomentState } from "../../lib/moments";

type Filter = "all" | "todo" | "kept";

interface Props {
  jobId: string;
  moments: Moment[];
  selected: number;
  onSelect: (index: number) => void;
  categoryLabel: (category: string | undefined) => string | null;
  footer?: React.ReactNode;
}

function StateIcon({ state }: { state: MomentState }) {
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
  return <span className="w-[22px] h-[22px] rounded-full flex-none border-[1.5px] border-white/30" />;
}

export default function MomentList({ jobId, moments, selected, onSelect, categoryLabel, footer }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const counts = countStates(moments);
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const shown = moments
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => filter === "all" || m.state === filter);

  return (
    <aside className="glass rounded-[20px] p-3.5 flex flex-col min-h-0">
      <div className="flex items-center justify-between gap-2.5 px-1 pb-3">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{t("project.momentsCount", { count: moments.length })}</h2>
        <div role="group" aria-label={t("project.filter")} className="seg">
          {(["all", "todo", "kept"] as const).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(`project.filters.${f}`)}
              {f !== "all" && <span className="mono ml-1 opacity-70">{f === "todo" ? counts.todo : counts.kept}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 overflow-y-auto max-h-[640px] -mx-1 px-1">
        {shown.map(({ m, index }) => {
          const isSelected = index === selected;
          return (
            <button
              key={m.filename}
              ref={isSelected ? selectedRef : undefined}
              onClick={() => onSelect(index)}
              className={`flex items-center gap-3 w-full p-[7px] rounded-[12px] text-left transition-colors ${
                isSelected ? "bg-white/[0.11] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" : "hover:bg-white/[0.06]"
              } ${m.state === "passed" && !isSelected ? "opacity-50" : ""}`}
            >
              <span className="relative w-[92px] h-[52px] flex-none rounded-[8px] overflow-hidden bg-white/5">
                <img src={clipThumbUrl(jobId, m.filename)} alt="" loading="lazy" className="w-full h-full object-cover" />
                <span className="mono absolute left-1 bottom-1 h-[17px] px-[5px] rounded-[4px] flex items-center bg-black/75 text-[10.5px] text-white">
                  {clock(m.duration)}
                </span>
              </span>
              <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="text-[13.5px] font-[550] text-white truncate">{m.hp.clip_name}</span>
                <span className="text-[12px] text-ink-3 truncate">
                  <span className="mono">{m.hp.timestamp_display}</span>
                  {categoryLabel(m.hp.llm?.category) && ` · ${categoryLabel(m.hp.llm?.category)}`}
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
        })}
        {shown.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-ink-3">{t("project.emptyFilter")}</p>}
      </div>

      {footer}
    </aside>
  );
}
