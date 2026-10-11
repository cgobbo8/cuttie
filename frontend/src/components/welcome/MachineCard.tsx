import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Loader2, Sparkles } from "lucide-react";
import { getMachine, type MachineProfile } from "../../lib/api";
import { rough, transcriptionEstimate } from "../../lib/machine";

/** "52 min", "1 h 40", "30 s": units read the same in every language of the app */
function duration(seconds: number): string {
  const { h, min, s } = rough(seconds);
  if (h) return min ? `${h} h ${String(min).padStart(2, "0")}` : `${h} h`;
  return min ? `${min} min` : `${s} s`;
}

/** NVIDIA GeForce GTX 1650 with Max-Q Design -> GeForce GTX 1650 Max-Q */
function cardName(machine: MachineProfile): string | null {
  const name = machine.gpu.name?.replace(/^NVIDIA /, "").replace(/ with Max-Q Design$/, " Max-Q");
  if (!name) return null;
  return machine.gpu.vram_gb ? `${name} · ${Math.round(machine.gpu.vram_gb)} Go` : name;
}

/**
 * What this computer can do, measured in a few seconds at first launch:
 * transcribing one of the streamer's lives here or with Groq, and telling
 * voices apart (always here, free). Helps decide whether a Groq key is worth it.
 */
export default function MachineCard({ liveSeconds }: { liveSeconds: number }) {
  const { t, i18n } = useTranslation();
  const [machine, setMachine] = useState<MachineProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getMachine().then(setMachine).catch(() => setFailed(true));
  }, []);
  if (failed) return null;

  const estimate = machine ? transcriptionEstimate(machine, liveSeconds) : null;
  const longest = Math.max(estimate?.local ?? 0, estimate?.groq ?? 0, 1);
  const dollars = estimate ? new Intl.NumberFormat(i18n.language, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(estimate.groqDollars) : "";
  const card = machine ? cardName(machine) : null;

  return (
    <div className="p-3.5 rounded-[14px] inset">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14.5px] font-semibold text-white">{t("welcome.machine.title")}</div>
          <div className="text-[12.5px] text-ink-3">{t("welcome.machine.forLive", { duration: duration(liveSeconds) })}</div>
        </div>
        {machine && (
          <span className="chip glass-chip text-white h-[26px] max-w-[55%] text-[12px]" title={machine.gpu.name ?? machine.cpu}>
            <Cpu className="w-3.5 h-3.5 flex-none" />
            <span className="truncate">{card ?? t("welcome.machine.noCard")}</span>
          </span>
        )}
      </div>

      {!machine || !estimate ? (
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3">
          <Loader2 className="w-3.5 h-3.5 spinner" /> {t("welcome.machine.measuring")}
        </div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-[12.5px]">
            <span className="text-ink-2">{t("welcome.machine.here")}</span>
            {estimate.local !== null ? (
              <span className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <span className="machine-bar bg-white/60" style={{ width: `${(estimate.local / longest) * 100}%` } as CSSProperties} />
              </span>
            ) : (
              <span className="text-ink-3">{t("welcome.machine.noLocal")}</span>
            )}
            <span className="mono text-white text-right">{estimate.local !== null ? `≈ ${duration(estimate.local)}` : ""}</span>

            <span className="text-ink-2">Groq</span>
            <span className="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <span className="machine-bar bg-accent" style={{ width: `${Math.max(2, (estimate.groq / longest) * 100)}%`, "--i": 1 } as CSSProperties} />
            </span>
            <span className="mono text-white text-right">
              ≈ {duration(estimate.groq)} <span className="text-ink-3">· {dollars}</span>
            </span>
          </div>

          <div className="mt-2.5 text-[12.5px] text-ink-3">
            {machine.voices.seconds ? t("welcome.machine.voices", { duration: duration(machine.voices.seconds) }) : t("welcome.machine.voicesHere")}
          </div>

          <p className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-snug text-accent">
            <Sparkles className="w-3.5 h-3.5 mt-px flex-none" />
            {estimate.advice === "fast"
              ? t("welcome.machine.adviceFast")
              : estimate.advice === "saves"
                ? t("welcome.machine.adviceSaves", { duration: duration(estimate.local! - estimate.groq) })
                : t("welcome.machine.adviceNeeded")}
          </p>
        </>
      )}
    </div>
  );
}
