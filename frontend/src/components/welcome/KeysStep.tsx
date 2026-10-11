import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type { ApiKeyName } from "../../lib/api";
import KeyField, { GROQ_KEY, REQUIRED_KEYS, type KeyState } from "../KeyField";
import MachineCard from "./MachineCard";
import { Progress } from "./shared";

/** Step 2: the OpenRouter key (and Groq, optional, for faster transcription), checked as soon as pasted */
export default function KeysStep({
  stateOf,
  setKeyState,
  ready,
  onContinue,
  liveSeconds,
}: {
  stateOf: (name: ApiKeyName) => KeyState;
  setKeyState: (name: ApiKeyName, state: KeyState) => void;
  /** The required key saved and not rejected */
  ready: boolean;
  onContinue: () => void;
  /** A usual live of the streamer, for the time estimates */
  liveSeconds: number;
}) {
  const { t } = useTranslation();
  const busy = [...REQUIRED_KEYS, GROQ_KEY].some((k) => stateOf(k.name) === "saving" || stateOf(k.name) === "checking");

  return (
    <>
      <Progress step={1} />
      <div className="mt-[22px] text-[13px] font-[550] text-accent">{t("welcome.keys.label")}</div>
      <h1 className="mt-2 text-[34px] leading-[1.08] tracking-[-0.03em] font-[650] text-white text-balance">{t("welcome.keys.title")}</h1>
      <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-2 max-w-[46ch]">{t("welcome.keys.lead")}</p>

      <div className="mt-5 flex flex-col gap-2.5">
        {REQUIRED_KEYS.map((def) => (
          <KeyField key={def.name} def={def} state={stateOf(def.name)} setState={(state) => setKeyState(def.name, state)} />
        ))}
        <div className="mt-2 text-[12.5px] text-ink-3">{t("welcome.keys.optional")}</div>
        <KeyField def={GROQ_KEY} state={stateOf(GROQ_KEY.name)} setState={(state) => setKeyState(GROQ_KEY.name, state)} removable />
        <MachineCard liveSeconds={liveSeconds} />
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
