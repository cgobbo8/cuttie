import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Loader2 } from "lucide-react";
import type { ApiKeyName, FacecamRect } from "../../lib/api";
import { useSettings } from "../../lib/SettingsContext";
import WebcamFrame from "../WebcamFrame";
import { REQUIRED_KEYS, type KeyState } from "../KeyField";
import type { CamSearch, FoundChannel } from "./shared";

/** A step that is not the current one: smaller, dimmer, clickable when done */
function PeekCard({ label, title, done, onEdit, children }: { label: string; title: string; done: boolean; onEdit?: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section aria-label={label} className={`glass rounded-[20px] p-6 w-[360px] max-w-full ${done ? "" : "opacity-[0.86]"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-[550] text-ink-3 inline-flex items-center gap-1.5">
          {done && <Check className="w-3.5 h-3.5 text-accent" strokeWidth={3} />}
          {label}
        </div>
        {done && onEdit && (
          <button onClick={onEdit} className="btn btn-ghost btn-sm h-7 px-2 -mr-2 text-[12.5px]">
            {t("welcome.edit")}
          </button>
        )}
      </div>
      <h2 className="mt-1.5 text-[22px] leading-[1.15] tracking-[-0.025em] font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

export function ChannelPeek({ found, onEdit }: { found: FoundChannel | null; onEdit: () => void }) {
  const { t } = useTranslation();
  return (
    <PeekCard label={t("welcome.channel.label")} title={found?.channel.display_name ?? t("welcome.channel.none")} done onEdit={onEdit}>
      {found && (
        <div className="mt-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-[12px] overflow-hidden flex-none" style={{ background: found.colors?.roles.light ?? "rgba(255,255,255,0.08)" }}>
            {found.channel.avatar_url && <img src={found.channel.avatar_url} alt="" className="w-full h-full object-cover" />}
          </span>
          <span className="mono text-[13px] text-ink-2 flex-1 min-w-0 truncate">twitch.tv/{found.channel.login}</span>
          {found.colors && (
            <span className="flex gap-1">
              {[found.colors.roles.accent, found.colors.roles.dark, found.colors.roles.light, found.colors.roles.highlight].map((c) => (
                <span key={c} className="w-3.5 h-3.5 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]" style={{ background: c }} />
              ))}
            </span>
          )}
        </div>
      )}
    </PeekCard>
  );
}

export function KeysPeek({ done, stateOf, onEdit }: { done: boolean; stateOf: (name: ApiKeyName) => KeyState; onEdit: () => void }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  return (
    <PeekCard label={t("welcome.keys.label")} title={t("welcome.keys.title")} done={done} onEdit={onEdit}>
      {!done && <p className="mt-2 text-[13px] leading-normal text-ink-3">{t("welcome.keys.lead")}</p>}
      <div className="mt-4 flex flex-col gap-2">
        {REQUIRED_KEYS.map((k) => {
          const configured = !!settings?.keys[k.name]?.configured;
          const rejected = configured && stateOf(k.name) === "invalid";
          return (
            <div key={k.name} className="flex items-center justify-between gap-2 p-3 rounded-[12px] inset">
              <div className="min-w-0">
                <div className="text-[13.5px] font-semibold text-white">{k.provider}</div>
                <div className="text-[12px] text-ink-3">{t(k.roleKey)}</div>
              </div>
              {rejected ? (
                <span className="chip chip-danger h-7 px-2.5 text-[12px]">{t("welcome.keys.rejected")}</span>
              ) : configured ? (
                <Check className="w-4 h-4 text-accent flex-none" strokeWidth={3} />
              ) : (
                <span className="chip chip-neutral h-7 px-2.5 text-[12px]">{t("welcome.keys.create")}</span>
              )}
            </div>
          );
        })}
      </div>
    </PeekCard>
  );
}

export function CamPeek({
  search,
  placeholder,
  confirmed,
  done,
  onEdit,
}: {
  search: CamSearch;
  placeholder: string | null;
  confirmed: FacecamRect | false | null;
  done: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const result = search.status === "done" ? search.result : null;
  const rect = done ? (confirmed || null) : result?.facecam ?? null;
  return (
    <PeekCard
      label={t("welcome.cam.label")}
      title={done ? (confirmed === false ? t("welcome.cam.noCam") : t("welcome.cam.confirmed")) : t("welcome.cam.title")}
      done={done}
      onEdit={onEdit}
    >
      {!done && <p className="mt-2 text-[13px] leading-normal text-ink-3">{t("welcome.cam.peek")}</p>}
      {confirmed !== false &&
        (result ? (
          <WebcamFrame className="mt-4" frameUrl={result.frame_url} rect={rect} />
        ) : (
          <div className="relative mt-4 aspect-video rounded-[12px] overflow-hidden border border-white/[0.08] bg-white/[0.04]">
            {placeholder && <img src={placeholder} alt="" className="absolute inset-0 w-full h-full object-cover brightness-[0.5]" />}
            {search.status === "searching" && (
              <>
                <div className="absolute inset-0 scan-line" />
                <Loader2 className="absolute right-2.5 bottom-2.5 w-4 h-4 animate-spin text-white/80" />
              </>
            )}
          </div>
        ))}
    </PeekCard>
  );
}
