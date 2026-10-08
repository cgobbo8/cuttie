import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, ExternalLink, Loader2 } from "lucide-react";
import { updateSettings, verifyApiKey } from "../../lib/api";
import { useSettings } from "../../lib/SettingsContext";
import { KEY_PREFIX, keyLooksRight } from "../../lib/twitch";
import { Progress } from "./shared";

type KeyName = keyof typeof KEY_PREFIX;

export type KeyState = "idle" | "saving" | "checking" | "valid" | "invalid" | "unreachable" | "error";

export const KEYS: { name: KeyName; provider: string; roleKey: string; url: string }[] = [
  { name: "groq_api_key", provider: "Groq", roleKey: "welcome.keys.groqRole", url: "https://console.groq.com/keys" },
  { name: "openrouter_api_key", provider: "OpenRouter", roleKey: "welcome.keys.openrouterRole", url: "https://openrouter.ai/keys" },
];

function KeyField({
  def,
  state,
  setState,
}: {
  def: (typeof KEYS)[number];
  state: KeyState;
  setState: (state: KeyState) => void;
}) {
  const { t } = useTranslation();
  const { settings, refresh } = useSettings();
  const status = settings?.keys[def.name];
  const configured = !!status?.configured;
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const prefix = KEY_PREFIX[def.name];

  const verify = useCallback(async () => {
    setState("checking");
    const check = await verifyApiKey(def.name).catch(() => ({ ok: false as const, reason: "unreachable" as const }));
    setState(check.ok ? "valid" : check.reason === "invalid" ? "invalid" : check.reason === "missing" ? "idle" : "unreachable");
  }, [def.name, setState]);

  const save = async (raw: string) => {
    const key = raw.trim();
    if (!key) return;
    setState("saving");
    try {
      await updateSettings({ [def.name]: key });
      await refresh();
      setValue("");
      setReplacing(false);
      await verify();
    } catch {
      setState("error");
    }
  };

  const showInput = !configured || replacing || state === "invalid";
  const busy = state === "saving" || state === "checking";
  const wrongFormat = value.trim().length > 6 && !keyLooksRight(def.name, value);

  return (
    <div className="p-3.5 rounded-[14px] inset">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold text-white">{def.provider}</div>
          <div className="text-[12.5px] text-ink-3">{t(def.roleKey)}</div>
        </div>
        <a href={def.url} target="_blank" rel="noreferrer" className="btn btn-glass btn-sm h-8 px-3 text-[12.5px]">
          {t("welcome.keys.create")} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {showInput ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(value);
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (pasted.length >= 20) {
                e.preventDefault();
                setValue(pasted);
                save(pasted);
              }
            }}
            placeholder={`${prefix}…`}
            aria-label={t("welcome.keys.paste", { provider: def.provider })}
            aria-invalid={state === "invalid" || wrongFormat}
            className="mono flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-black/30 border border-white/[0.08] text-[13px] text-white placeholder:text-ink-4 outline-none focus-visible:outline-none focus:border-white/30"
          />
          {value.trim() && (
            <button type="submit" disabled={busy} className="btn btn-primary h-10">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("welcome.keys.save")}
            </button>
          )}
        </form>
      ) : (
        <div className="mt-3 flex items-center gap-2 h-10 px-3 rounded-[10px] bg-black/20 border border-white/[0.06]">
          <span className="mono flex-1 min-w-0 truncate text-[13px] text-ink-2">{status?.preview}</span>
          <button type="button" onClick={() => setReplacing(true)} className="btn btn-ghost btn-sm h-7 px-2 text-[12.5px]">
            {t("welcome.keys.replace")}
          </button>
        </div>
      )}

      <div className="mt-2 text-[12.5px] empty:hidden" aria-live="polite">
        {busy ? (
          <span className="inline-flex items-center gap-1.5 text-ink-3">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("welcome.keys.checking")}
          </span>
        ) : state === "valid" ? (
          <span className="inline-flex items-center gap-1.5 text-accent font-[550]">
            <Check className="w-3.5 h-3.5" strokeWidth={3} /> {t("welcome.keys.valid")}
          </span>
        ) : state === "invalid" ? (
          <span className="text-[#ff8a7a]">{t("welcome.keys.invalid", { provider: def.provider })}</span>
        ) : state === "unreachable" ? (
          <span className="text-ink-3">{t("welcome.keys.unreachable")}</span>
        ) : state === "error" ? (
          <span className="text-[#ff8a7a]">{t("welcome.keys.saveError")}</span>
        ) : wrongFormat ? (
          <span className="text-ink-3">{t("welcome.keys.format", { provider: def.provider, prefix })}</span>
        ) : null}
      </div>
    </div>
  );
}

/** Step 2: the two API keys, checked with their provider as soon as they are pasted */
export default function KeysStep({
  states,
  setKeyState,
  onContinue,
}: {
  states: Record<KeyName, KeyState>;
  setKeyState: (name: KeyName, state: KeyState) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const ready = KEYS.every((k) => settings?.keys[k.name]?.configured && states[k.name] !== "invalid");
  const busy = KEYS.some((k) => states[k.name] === "saving" || states[k.name] === "checking");

  return (
    <>
      <Progress step={1} />
      <div className="mt-[22px] text-[13px] font-[550] text-accent">{t("welcome.keys.label")}</div>
      <h1 className="mt-2 text-[34px] leading-[1.08] tracking-[-0.03em] font-[650] text-white text-balance">{t("welcome.keys.title")}</h1>
      <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-2 max-w-[46ch]">{t("welcome.keys.lead")}</p>

      <div className="mt-5 flex flex-col gap-2.5">
        {KEYS.map((def) => (
          <KeyField key={def.name} def={def} state={states[def.name]} setState={(state) => setKeyState(def.name, state)} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onContinue} className="btn btn-ghost btn-sm -ml-2">
          {t("welcome.keys.later")}
        </button>
        <button type="button" onClick={onContinue} disabled={!ready || busy} className="btn btn-primary btn-lg">
          {t("welcome.continue")} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
        </button>
      </div>
    </>
  );
}
