import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowRight, ArrowUp, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Compilation, CompilationItem, TwitchStoryboard } from "../../lib/api";
import {
  addSection,
  allItems,
  compilationLength,
  fitToTarget,
  liveClock,
  moveItem,
  moveSection,
  removeItem,
  removeSection,
  sectionLength,
} from "../../lib/compilation";
import { clock } from "../../lib/format";
import { frameAt, tileStyle } from "../../lib/storyboard";

interface Props {
  compilation: Compilation;
  storyboard: TwitchStoryboard | null;
  /** The section search results are added to */
  activeSection: string;
  /** The item shown in the preview */
  selectedItem: string | null;
  /** Items whose clip is being cut from the live */
  cutting: Set<string>;
  /** Templates to pick from, the channel's default first */
  templates: { key: string; name: string }[];
  onActivate: (sectionId: string) => void;
  onSelect: (item: CompilationItem) => void;
  onChange: (next: Compilation) => void;
  onExport: () => void;
  exporting: boolean;
  onDelete: () => void;
  /** A template's name, by key */
  templateName: (key: string) => string;
  /** The AI is looking at the passages to choose their templates */
  looking: boolean;
  /** What the AI said of the templates it chose */
  looksNote: string;
  onLooks: () => void;
  /** Every passage back to the video's template */
  onSameLook: () => void;
}

const TARGETS = [30, 60, 90, 180];
/** What the AI looking at one passage costs, dollars (three frames and what is said) */
const LOOK_COST = 0.0005;

/** The compilation being built: its sections, their moments in playing order, its length and look */
export default function CompilationPanel({
  compilation,
  storyboard,
  activeSection,
  selectedItem,
  cutting,
  templates,
  onActivate,
  onSelect,
  onChange,
  onExport,
  exporting,
  onDelete,
  templateName,
  looking,
  looksNote,
  onLooks,
  onSameLook,
}: Props) {
  const { t, i18n } = useTranslation();
  const ownLooks = allItems(compilation).filter((item) => item.template).length;
  const total = compilationLength(compilation);
  const count = allItems(compilation).length;
  // About half a tenth of a cent per passage looked at (measured): said before asking
  const dollars = (cost: number) => `${new Intl.NumberFormat(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cost)} $`;
  const looksCost = count * LOOK_COST < 0.01 ? `< ${dollars(0.01)}` : `≈ ${dollars(count * LOOK_COST)}`;
  const target = compilation.target;
  const over = !!target && total > target * 1.05;
  const iconButton = "btn btn-ghost btn-icon w-7 h-7 text-ink-3 hover:text-white disabled:opacity-25";

  return (
    <aside aria-label={t("compilation.title")} className="glass rounded-[20px] p-3 flex-[1_1_360px] min-w-0 flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <input
          value={compilation.name}
          onChange={(e) => onChange({ ...compilation, name: e.target.value })}
          aria-label={t("compilation.name")}
          className="flex-1 min-w-0 h-9 px-2.5 rounded-[9px] bg-transparent border border-transparent hover:border-white/10 focus:border-accent-line focus:bg-black/30 text-[16px] font-semibold tracking-[-0.01em] text-white outline-none"
        />
        <button onClick={onDelete} aria-label={t("compilation.delete")} title={t("compilation.delete")} className={iconButton}>
          <Trash2 className="w-[15px] h-[15px]" />
        </button>
      </div>

      {compilation.sections.map((section, si) => {
        const active = section.id === activeSection;
        return (
          <section
            key={section.id}
            onClick={() => onActivate(section.id)}
            className={`rounded-[14px] border p-2 transition-colors ${active ? "border-accent-line bg-white/[0.05]" : "border-white/[0.07] hover:bg-white/[0.03]"}`}
          >
            <div className="flex items-center gap-1">
              <input
                value={section.title}
                onChange={(e) => onChange({ ...compilation, sections: compilation.sections.map((s) => (s.id === section.id ? { ...s, title: e.target.value } : s)) })}
                placeholder={t("compilation.sectionTitle", { n: si + 1 })}
                aria-label={t("compilation.sectionTitle", { n: si + 1 })}
                className="flex-1 min-w-0 h-8 px-2 rounded-[8px] bg-transparent border border-transparent hover:border-white/10 focus:border-accent-line focus:bg-black/30 text-[13.5px] font-[550] text-white outline-none placeholder:text-ink-3"
              />
              <span className="mono text-[12px] text-ink-3 px-1">{clock(sectionLength(section))}</span>
              {compilation.sections.length > 1 && (
                <>
                  <button onClick={() => onChange(moveSection(compilation, section.id, -1))} disabled={si === 0} aria-label={t("compilation.moveUp")} className={iconButton}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onChange(moveSection(compilation, section.id, 1))}
                    disabled={si === compilation.sections.length - 1}
                    aria-label={t("compilation.moveDown")}
                    className={iconButton}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {(compilation.sections.length > 1 || section.items.length > 0) && (
                <button onClick={() => onChange(removeSection(compilation, section.id))} aria-label={t("compilation.removeSection")} title={t("compilation.removeSection")} className={iconButton}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {section.items.length === 0 ? (
              <p className="px-2 py-2.5 text-[12.5px] leading-snug text-ink-3">{t(active ? "compilation.emptyActive" : "compilation.emptySection")}</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.id} className={`group/item flex items-center gap-2 p-1.5 rounded-[10px] transition-colors ${item.id === selectedItem ? "bg-white/10" : "hover:bg-white/[0.05]"}`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(item);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                    >
                      <span
                        className="relative w-[64px] aspect-video rounded-[6px] overflow-hidden flex-none bg-white/[0.05]"
                        style={storyboard ? tileStyle(storyboard, frameAt(storyboard, item.start)) : undefined}
                      >
                        {cutting.has(item.id) && (
                          <span className="absolute inset-0 grid place-items-center bg-black/55">
                            <Loader2 className="w-3.5 h-3.5 spinner text-white" />
                          </span>
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[12.5px] leading-snug text-white truncate">{item.text || item.why || liveClock(item.start)}</span>
                        <span className="mono block text-[11px] text-ink-3 truncate">
                          {liveClock(item.start)} · {(item.end - item.start).toFixed(1)} s
                          {/* Shown in a template of its own */}
                          {item.template && <span className="text-accent"> · {templateName(item.template)}</span>}
                        </span>
                      </span>
                    </button>
                    <span className="flex items-center opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => onChange(moveItem(compilation, item.id, -1))} aria-label={t("compilation.moveUp")} className={iconButton}>
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onChange(moveItem(compilation, item.id, 1))} aria-label={t("compilation.moveDown")} className={iconButton}>
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => onChange(removeItem(compilation, item.id))} aria-label={t("compilation.removeItem")} title={t("compilation.removeItem")} className={iconButton}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <button
        onClick={() => {
          const { compilation: next, id } = addSection(compilation);
          onChange(next);
          onActivate(id);
        }}
        className="btn btn-ghost btn-sm self-start"
      >
        <Plus className="w-[15px] h-[15px]" /> {t("compilation.addSection")}
      </button>

      <div className="mt-1 pt-3 border-t border-white/[0.08] flex flex-col gap-3">
        {/* Length: what it makes, what is aimed for */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] text-ink-2">
              <span className={`mono font-semibold ${over ? "text-[#F5B14C]" : "text-white"}`}>{clock(total)}</span> · {t("compilation.moments", { count })}
            </span>
            {over && (
              <button onClick={() => onChange(fitToTarget(compilation, target!))} className="btn btn-glass btn-sm h-7 px-2.5">
                {t("compilation.fit", { length: clock(target!) })}
              </button>
            )}
          </div>
          <div role="group" aria-label={t("compilation.length")} className="seg mt-2">
            {TARGETS.map((seconds) => (
              <button key={seconds} aria-pressed={target === seconds} onClick={() => onChange({ ...compilation, target: target === seconds ? null : seconds })}>
                {t(`compilation.target.${seconds}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3">
          <span className="flex-1 min-w-0">
            <span className="block text-[13.5px] font-[550] text-white">{t("compilation.titles")}</span>
            <span className="block text-[12px] text-ink-3">{t("compilation.titlesHint")}</span>
          </span>
          <button role="switch" aria-checked={compilation.titles} aria-label={t("compilation.titles")} onClick={() => onChange({ ...compilation, titles: !compilation.titles })} className="switch flex-none">
            <span />
          </button>
        </label>
        {!compilation.titles && (
          <input
            value={compilation.hook}
            onChange={(e) => onChange({ ...compilation, hook: e.target.value })}
            placeholder={t("compilation.hookPlaceholder")}
            aria-label={t("montage.hook")}
            className="w-full h-10 px-3 rounded-[10px] bg-black/30 border border-white/10 text-[13.5px] text-white outline-none focus:border-accent-line placeholder:text-ink-3"
          />
        )}

        <label className="flex items-center gap-3">
          <span className="text-[13.5px] font-[550] text-white">{t("compilation.template")}</span>
          <select
            value={compilation.template ?? ""}
            onChange={(e) => onChange({ ...compilation, template: e.target.value || null })}
            className="flex-1 min-w-0 h-9 px-2.5 rounded-[10px] bg-black/30 border border-white/10 text-[13px] text-white outline-none focus:border-accent-line [color-scheme:dark]"
          >
            <option value="">{t("compilation.defaultTemplate")}</option>
            {templates.map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {tpl.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onLooks} disabled={count === 0 || looking || cutting.size > 0} className="btn btn-glass btn-sm flex-1 min-w-[190px]">
              {looking ? <Loader2 className="w-3.5 h-3.5 spinner" /> : <Sparkles className="w-3.5 h-3.5 text-accent" />}
              {t(looking ? "compilation.aiLooking" : "compilation.aiLooks")}
              {!looking && <span className="mono text-[11.5px] text-ink-3">{looksCost}</span>}
            </button>
            {ownLooks > 0 && !looking && (
              <button onClick={onSameLook} className="btn btn-ghost btn-sm">
                {t("compilation.looksSame")}
              </button>
            )}
          </div>
          <p className="mt-1.5 px-0.5 text-[12px] leading-snug text-ink-3">{looksNote || t("compilation.aiLooksHint")}</p>
        </div>

        <button onClick={onExport} disabled={count === 0 || exporting || cutting.size > 0} className="btn btn-primary btn-lg w-full h-[48px]">
          {exporting ? (
            <Loader2 className="w-4 h-4 spinner" />
          ) : cutting.size > 0 ? (
            <>
              <Loader2 className="w-4 h-4 spinner" /> {t("compilation.cuttingCount", { count: cutting.size })}
            </>
          ) : (
            <>
              {t("compilation.export")} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
