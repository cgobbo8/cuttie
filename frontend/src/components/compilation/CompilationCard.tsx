import { useState, type FormEvent, type MouseEvent } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Check, Copy, Layers, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { clipThumbUrl, type CompilationSummary } from "../../lib/api";
import { compilationStatus, plainDate } from "../../lib/compilationLibrary";
import { clock } from "../../lib/format";

interface Props {
  jobId: string;
  compilation: CompilationSummary;
  /** Its live's picture, while none of its passages is cut */
  fallback: string | null;
  /** Something is being done to it (copied, renamed, deleted) */
  busy?: boolean;
  onDuplicate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}

/** A compilation in the library: what it is, where it stands, and what can be done with it */
export default function CompilationCard({ jobId, compilation: c, fallback, busy = false, onDuplicate, onRename, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(c.name);
  const status = compilationStatus(c);
  const cover = c.cover ? clipThumbUrl(jobId, c.cover, { width: 480 }) : fallback;
  const to = `/${jobId}/compilation?c=${c.id}`;

  const act = (e: MouseEvent, action: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    action();
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    setNaming(false);
    const next = name.trim();
    if (next && next !== c.name) onRename(next);
    else setName(c.name);
  };
  const action = "w-8 h-8 grid place-items-center rounded-[9px] text-ink-3 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40";

  return (
    <article className="group relative glass rounded-[18px] overflow-hidden flex flex-col transition-[transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-white/[0.16]">
      <Link to={to} aria-label={t("compilations.open", { name: c.name })} className="relative block aspect-video overflow-hidden bg-white/[0.04]">
        {cover ? (
          <img src={cover} alt="" loading="lazy" className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04] ${status === "empty" ? "brightness-[0.55] saturate-[0.6]" : ""}`} />
        ) : (
          <div className="w-full h-full grid place-items-center text-ink-4">
            <Layers className="w-7 h-7" />
          </div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(11,11,12,0.65)_0%,rgba(11,11,12,0)_50%)]" />
        <span className={`absolute top-2.5 left-2.5 chip glass-chip h-[26px] px-2.5 text-[12px] ${status === "exported" ? "text-accent" : "text-white"}`}>
          {status === "exported" || status === "changed" ? <Check className="w-3 h-3" strokeWidth={3} /> : <span className={`w-1.5 h-1.5 rounded-full ${status === "empty" ? "bg-white/40" : "bg-amber-300"}`} />}
          {t(`compilations.status.${status}`)}
        </span>
        {c.passages > 0 && <span className="absolute bottom-2.5 right-2.5 chip glass-chip text-white h-[24px] px-2 text-[12px] mono">{clock(c.length)}</span>}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-black/50">
            <Loader2 className="w-5 h-5 spinner text-white" />
          </span>
        )}
      </Link>

      <div className="p-3.5 pt-3 flex-1 flex flex-col gap-1">
        {naming ? (
          <form onSubmit={rename}>
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => e.key === "Escape" && (setName(c.name), setNaming(false))}
              aria-label={t("compilations.rename")}
              className="w-full h-8 px-2 -mx-2 rounded-[8px] bg-black/30 border border-accent-line text-[14.5px] font-[600] text-white outline-none"
            />
          </form>
        ) : (
          <Link to={to} className="text-[14.5px] font-[600] leading-snug text-white truncate hover:underline decoration-white/30 underline-offset-2">
            {c.name}
          </Link>
        )}
        <p className="text-[12.5px] text-ink-2 flex items-center gap-1.5 min-w-0">
          {c.described && <Sparkles className="w-3.5 h-3.5 text-accent flex-none" aria-label={t("compilations.described")} />}
          <span className="truncate">
            {c.passages === 0 ? t("compilations.noPassage") : [t("compilations.passages", { count: c.passages }), c.parts > 1 ? t("compilations.parts", { count: c.parts }) : null].filter(Boolean).join(" · ")}
          </span>
        </p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[11.5px] text-ink-3 truncate">
            {c.exported_at ? t("compilations.exportedOn", { date: plainDate(c.exported_at, i18n.language) }) : t("compilations.changedOn", { date: plainDate(c.updated_at, i18n.language) })}
          </p>
          <div className="flex items-center -mr-1.5 flex-none">
            <button type="button" disabled={busy} onClick={(e) => act(e, onDuplicate)} aria-label={t("compilations.duplicate")} title={t("compilations.duplicate")} className={action}>
              <Copy className="w-[15px] h-[15px]" />
            </button>
            <button type="button" disabled={busy} onClick={(e) => act(e, () => setNaming(true))} aria-label={t("compilations.rename")} title={t("compilations.rename")} className={action}>
              <Pencil className="w-[15px] h-[15px]" />
            </button>
            <button type="button" disabled={busy} onClick={(e) => act(e, onDelete)} aria-label={t("compilation.delete")} title={t("compilation.delete")} className={`${action} hover:!text-[#ff8a7a]`}>
              <Trash2 className="w-[15px] h-[15px]" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
