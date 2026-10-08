import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { updateSettings, verifyApiKey, type ApiKeyName } from "../lib/api";
import { useSettings } from "../lib/SettingsContext";

export type KeyState = "idle" | "saving" | "checking" | "valid" | "invalid" | "unreachable" | "error";

export interface KeyDef {
  name: ApiKeyName;
  provider: string;
  /** i18n key: what the service does in Cuttie */
  roleKey: string;
  /** Where to create a key */
  url: string;
  /** How a valid key starts */
  prefix: string;
  /** The API can check it with the provider */
  verifiable: boolean;
}

/** The key every analysis needs: OpenRouter watches, rates and (without Groq) transcribes */
export const REQUIRED_KEYS: KeyDef[] = [
  { name: "openrouter_api_key", provider: "OpenRouter", roleKey: "welcome.keys.openrouterRole", url: "https://openrouter.ai/keys", prefix: "sk-or-", verifiable: true },
];

/** Groq: the fastest transcription */
export const GROQ_KEY: KeyDef = { name: "groq_api_key", provider: "Groq", roleKey: "welcome.keys.groqRole", url: "https://console.groq.com/keys", prefix: "gsk_", verifiable: true };

export const OPTIONAL_KEYS: KeyDef[] = [
  GROQ_KEY,
  { name: "openai_api_key", provider: "OpenAI", roleKey: "settings.openaiRole", url: "https://platform.openai.com/api-keys", prefix: "sk-", verifiable: false },
];

type Checkable = "groq_api_key" | "openrouter_api_key";

async function check(name: Checkable): Promise<KeyState> {
  const result = await verifyApiKey(name).catch(() => ({ ok: false as const, reason: "unreachable" as const }));
  return result.ok ? "valid" : result.reason === "invalid" ? "invalid" : result.reason === "missing" ? "idle" : "unreachable";
}

/** State of each key; keys saved earlier are checked once with their provider */
export function useKeyChecks() {
  const { settings } = useSettings();
  const [states, setStates] = useState<Partial<Record<ApiKeyName, KeyState>>>({});
  const setKeyState = useCallback((name: ApiKeyName, state: KeyState) => setStates((prev) => ({ ...prev, [name]: state })), []);
  const checked = useRef(false);

  useEffect(() => {
    if (!settings || checked.current) return;
    checked.current = true;
    for (const def of [...REQUIRED_KEYS, ...OPTIONAL_KEYS].filter((k) => k.verifiable)) {
      if (!settings.keys[def.name]?.configured) continue;
      setKeyState(def.name, "checking");
      check(def.name as Checkable).then((state) => setKeyState(def.name, state));
    }
  }, [settings, setKeyState]);

  const stateOf = (name: ApiKeyName): KeyState => states[name] ?? "idle";
  const requiredOk = REQUIRED_KEYS.every((k) => settings?.keys[k.name]?.configured && stateOf(k.name) !== "invalid");
  return { stateOf, setKeyState, requiredOk };
}

/** One API key: paste it, it's saved and checked with its provider right away */
export default function KeyField({
  def,
  state,
  setState,
  removable = false,
}: {
  def: KeyDef;
  state: KeyState;
  setState: (state: KeyState) => void;
  removable?: boolean;
}) {
  const { t } = useTranslation();
  const { settings, refresh } = useSettings();
  const status = settings?.keys[def.name];
  const configured = !!status?.configured;
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);

  const save = async (raw: string) => {
    const key = raw.trim();
    setState("saving");
    try {
      await updateSettings({ [def.name]: key });
      await refresh();
      setValue("");
      setReplacing(false);
      setState(key && def.verifiable ? "checking" : "idle");
      if (key && def.verifiable) setState(await check(def.name as Checkable));
    } catch {
      setState("error");
    }
  };

  const showInput = !configured || replacing || state === "invalid";
  const busy = state === "saving" || state === "checking";
  const wrongFormat = value.trim().length > 6 && !value.trim().startsWith(def.prefix);

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
            if (value.trim()) save(value);
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
            placeholder={`${def.prefix}…`}
            aria-label={t("welcome.keys.paste", { provider: def.provider })}
            aria-invalid={state === "invalid" || wrongFormat}
            className="mono flex-1 min-w-0 h-10 px-3 rounded-[10px] bg-black/30 border border-white/[0.08] text-[13px] text-white placeholder:text-ink-4 outline-none focus-visible:outline-none focus:border-white/30"
          />
          {value.trim() && (
            <button type="submit" disabled={busy} className="btn btn-primary h-10">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t("welcome.keys.save")}
            </button>
          )}
          {replacing && !value.trim() && (
            <button type="button" onClick={() => setReplacing(false)} className="btn btn-ghost h-10">
              {t("common.cancel")}
            </button>
          )}
        </form>
      ) : (
        <div className="mt-3 flex items-center gap-1 h-10 pl-3 pr-1 rounded-[10px] bg-black/20 border border-white/[0.06]">
          <span className="mono flex-1 min-w-0 truncate text-[13px] text-ink-2">{status?.preview}</span>
          <button type="button" onClick={() => setReplacing(true)} className="btn btn-ghost btn-sm h-8 px-2.5 text-[12.5px]">
            {t("welcome.keys.replace")}
          </button>
          {removable && (
            <button type="button" onClick={() => save("")} disabled={busy} className="btn btn-ghost btn-sm h-8 px-2.5 text-[12.5px] hover:text-[#ff8a7a]">
              {t("settings.remove")}
            </button>
          )}
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
          <span className="text-ink-3">{t("welcome.keys.format", { provider: def.provider, prefix: def.prefix })}</span>
        ) : null}
      </div>
    </div>
  );
}
