import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Download, Pencil, SquarePen, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { clipUrl } from "../../lib/api";
import { clock } from "../../lib/format";
import type { Moment } from "../../lib/moments";

interface Props {
  jobId: string;
  moment: Moment;
  onRename: (name: string) => Promise<void>;
  onSeek: (seconds: number) => void;
  onDelete: () => void;
}

/** Why the AI picked this moment, and what happens in it */
export default function MomentDetails({ jobId, moment, onRename, onSeek, onDelete }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(moment.hp.clip_name);
  useEffect(() => {
    setName(moment.hp.clip_name);
    setEditing(false);
  }, [moment.filename, moment.hp.clip_name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && name.trim() !== moment.hp.clip_name) await onRename(name.trim());
    setEditing(false);
  };

  const s = moment.hp.signals;
  const signals = [
    { label: t("project.signal.voice"), value: s?.rms ?? 0 },
    { label: t("project.signal.excitement"), value: s?.vocal_excitement ?? 0 },
    { label: t("project.signal.chat"), value: s?.chat_speed ?? 0 },
  ].map((x) => ({ ...x, pct: Math.round(Math.min(1, Math.max(0, x.value)) * 100) }));

  return (
    <article className="glass rounded-[18px] p-5 flex flex-wrap gap-[22px]">
      <div className="flex-[1_1_380px] min-w-0">
        {editing ? (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
              aria-label={t("project.rename")}
              className="flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-black/30 border border-white/15 text-[18px] font-semibold text-white outline-none focus:border-accent-line"
            />
            <button type="submit" className="btn btn-primary btn-sm">{t("brand.save")}</button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5">
            <h2 className="text-[22px] font-semibold tracking-[-0.025em] text-white truncate">{moment.hp.clip_name}</h2>
            <button onClick={() => setEditing(true)} aria-label={t("project.rename")} className="btn btn-ghost btn-icon w-8 h-8">
              <Pencil className="w-[15px] h-[15px]" />
            </button>
          </div>
        )}
        {moment.hp.llm?.summary && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2 max-w-[62ch]">{moment.hp.llm.summary}</p>}
        {(moment.hp.llm?.key_moments?.length ?? 0) > 0 && (
          <div className="mt-3.5 flex flex-wrap gap-1.5">
            {moment.hp.llm!.key_moments.map((k) => (
              <button
                key={`${k.time}-${k.label}`}
                onClick={() => onSeek(k.time)}
                title={k.description}
                className="inline-flex items-center gap-2 h-7 pl-2 pr-2.5 rounded-[8px] bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.07] text-[12.5px] text-white transition-colors"
              >
                <span className="mono font-semibold text-accent">{clock(k.time)}</span>
                {k.label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Link to={`/${jobId}/edit?clip=${encodeURIComponent(moment.filename)}`} className="btn btn-ghost btn-sm">
            <SquarePen className="w-[15px] h-[15px]" /> {t("project.advancedEditor")}
          </Link>
          <a href={clipUrl(jobId, moment.filename)} download className="btn btn-ghost btn-sm">
            <Download className="w-[15px] h-[15px]" /> {t("project.downloadRaw")}
          </a>
          <button onClick={onDelete} className="btn btn-ghost btn-sm hover:text-red-300">
            <Trash2 className="w-[15px] h-[15px]" /> {t("project.deleteClip")}
          </button>
        </div>
      </div>
      <div className="flex-[0_1_250px] min-w-[200px]">
        <div className="text-[12.5px] font-[550] text-ink-2">{t("project.why")}</div>
        <div className="mt-3 flex flex-col gap-[11px]">
          {signals.map((x) => (
            <div key={x.label}>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-ink-2">{x.label}</span>
                <span className="mono text-ink-3">{x.pct}</span>
              </div>
              <div className="mt-[5px] h-1 rounded-full bg-white/10">
                <div className={`h-full rounded-full ${x.pct >= 70 ? "bg-accent" : "bg-white/55"}`} style={{ width: `${x.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}
