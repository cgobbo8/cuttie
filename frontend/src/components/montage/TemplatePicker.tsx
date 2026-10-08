import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Star } from "lucide-react";
import type { TemplateSpec } from "../../lib/templateSpec";
import { isBuiltIn, type TemplateKey } from "../../lib/templateKeys";
import { TEMPLATE_IDS, type TemplateId } from "../../lib/templates";

interface Props {
  customs: TemplateSpec[];
  /** Template of the clip on screen */
  selected: TemplateKey;
  /** Template new projects start with */
  defaultKey: TemplateKey;
  suggested: TemplateId | null;
  onPick: (key: TemplateKey) => void;
  onDefault: (key: TemplateKey) => void;
  /** The template can't be used on this clip (built-in layout made around a missing webcam) */
  unavailable: (key: TemplateKey) => boolean;
  sketch: (key: TemplateKey) => ReactNode;
  /** The template editor: an existing template, or a new one from a layout */
  editorLink: (id: string, base?: string) => string;
}

type Tab = "mine" | "cuttie";

/**
 * Montage's template list: the streamer's own templates first when there are
 * some, Cuttie's layouts in the other tab. A star marks the one new projects
 * start with.
 */
export default function TemplatePicker({ customs, selected, defaultKey, suggested, onPick, onDefault, unavailable, sketch, editorLink }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>(() => (customs.length > 0 || !isBuiltIn(selected) ? "mine" : "cuttie"));
  // The template in use sits in the other tab: a dot on it
  const selectedTab: Tab = isBuiltIn(selected) ? "cuttie" : "mine";

  const row = (key: TemplateKey, name: string, desc: string, chips: ReactNode, edit: { to: string; label: string }) => {
    const off = unavailable(key);
    const isDefault = key === defaultKey;
    return (
      <div key={key} className="relative group/tpl">
        <button
          onClick={() => onPick(key)}
          disabled={off}
          aria-pressed={key === selected}
          className={`flex items-center gap-3 w-full p-2 pr-[76px] rounded-[13px] text-left border transition-colors ${
            key === selected ? "bg-white/10 border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-transparent hover:bg-white/[0.06]"
          } disabled:opacity-40 disabled:pointer-events-none`}
        >
          {sketch(key)}
          <span className="flex-1 min-w-0 flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="text-[14px] font-semibold tracking-[-0.01em] text-white truncate max-w-full">{name}</span>
              {isDefault && <span className="chip chip-accent h-[19px] px-1.5 text-[10.5px]">{t("montage.defaultBadge")}</span>}
              {chips}
            </span>
            <span className="text-[12px] leading-snug text-ink-3">{off ? t("montage.needsWebcam") : desc}</span>
          </span>
        </button>
        <div className="absolute top-2 right-2 flex items-center gap-0.5">
          <button
            onClick={() => !isDefault && onDefault(key)}
            aria-pressed={isDefault}
            aria-label={isDefault ? t("montage.defaultBadge") : t("montage.setDefault")}
            title={isDefault ? t("montage.defaultBadge") : t("montage.setDefault")}
            className={`btn btn-ghost btn-icon btn-sm w-8 h-8 ${
              isDefault ? "!text-accent cursor-default" : "opacity-0 group-hover/tpl:opacity-70 hover:!opacity-100 focus-visible:opacity-100"
            }`}
          >
            <Star className="w-3.5 h-3.5" fill={isDefault ? "currentColor" : "none"} />
          </button>
          <Link
            to={edit.to}
            aria-label={`${edit.label} ${name}`}
            title={edit.label}
            className="btn btn-ghost btn-icon btn-sm w-8 h-8 opacity-60 group-hover/tpl:opacity-100 focus-visible:opacity-100"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    );
  };

  return (
    <>
      <div role="tablist" aria-label={t("montage.templates")} className="seg w-full mb-2">
        {(["mine", "cuttie"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className="flex-1 relative">
            {id === "mine" ? t("montage.tabMine") : t("montage.tabCuttie")}
            {id === "mine" && customs.length > 0 && <span className="ml-1.5 mono text-[11px] text-ink-3">{customs.length}</span>}
            {selectedTab === id && tab !== id && <span aria-hidden className="absolute top-1.5 right-2 w-1.5 h-1.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="flex flex-col gap-1">
        {tab === "cuttie" &&
          TEMPLATE_IDS.map((id) =>
            row(
              id,
              t(`montage.template.${id}.name`),
              t(`montage.template.${id}.desc`),
              id === suggested && id !== defaultKey ? <span className="chip chip-neutral h-[19px] px-1.5 text-[10.5px]">{t("montage.suggested")}</span> : null,
              { to: editorLink("nouveau", id), label: t("montage.customize") },
            ),
          )}

        {tab === "mine" && customs.length === 0 && (
          <div className="px-3 py-5 text-center">
            <p className="text-[13.5px] font-[550] text-white">{t("montage.mineEmpty")}</p>
            <p className="mt-1 text-[12px] leading-snug text-ink-3">{t("montage.mineEmptyHint")}</p>
          </div>
        )}
        {tab === "mine" &&
          customs.map((custom) =>
            row(custom.id, custom.name, t("montage.basedOn", { base: t(`montage.template.${custom.base}.name`) }), null, {
              to: editorLink(custom.id),
              label: t("montage.editTemplate"),
            }),
          )}

        <Link
          to={editorLink("nouveau", isBuiltIn(selected) ? selected : customs.find((c) => c.id === selected)?.base ?? "signature")}
          className={tab === "mine" ? "btn btn-glass btn-sm mt-1.5 mx-1" : "btn btn-ghost btn-sm justify-start mt-1.5 mx-1"}
        >
          <Plus className="w-4 h-4" /> {t("montage.createTemplate")}
        </Link>
      </div>
    </>
  );
}
