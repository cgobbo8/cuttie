import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, Globe, KeyRound, Loader2, RefreshCw, Sparkles, Stethoscope, XCircle } from "lucide-react";
import { getDiagnostics, type Diagnostics } from "../lib/api";
import { LANGUAGE_STORAGE_KEY } from "../lib/i18n";
import KeyField, { OPTIONAL_KEYS, REQUIRED_KEYS, useKeyChecks } from "../components/KeyField";
import { useToast } from "../components/Toast";

const LANGUAGES = [
  { code: "fr", labelKey: "profile.french" },
  { code: "en", labelKey: "profile.english" },
  { code: "es", labelKey: "profile.spanish" },
] as const;

function Section({ icon: Icon, title, hint, action, children }: { icon: typeof Globe; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass rounded-[20px] p-6">
      <div className="flex items-start gap-3.5">
        <span className="w-10 h-10 rounded-[12px] bg-white/[0.07] grid place-items-center flex-none">
          <Icon className="w-[18px] h-[18px] text-ink-2" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3 max-w-[60ch]">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

type Level = "ok" | "warn" | "error";

const LEVEL = {
  ok: { Icon: CheckCircle2, color: "text-accent" },
  warn: { Icon: AlertTriangle, color: "text-[#f5b14c]" },
  error: { Icon: XCircle, color: "text-[#ff8a7a]" },
} as const;

function DiagRow({ label, value, level }: { label: string; value: ReactNode; level: Level }) {
  const { Icon, color } = LEVEL[level];
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/[0.06] last:border-0">
      <Icon className={`w-4 h-4 mt-0.5 flex-none ${color}`} />
      <span className="w-[210px] flex-none text-[13.5px] text-ink-2">{label}</span>
      <span className="min-w-0 text-[13.5px] text-white break-words">{value}</span>
    </div>
  );
}

function DiagnosticsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  // The toast context object changes on every toast, its methods don't
  const showError = toast.error;

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setDiag(await getDiagnostics());
    } catch {
      showError(t("settings.diag.failed"));
    } finally {
      setLoading(false);
    }
  }, [t, showError]);

  useEffect(() => {
    run();
  }, [run]);

  const copyReport = async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      toast.success(t("settings.reportCopied"));
    } catch {
      toast.error(t("settings.copyFailed"));
    }
  };

  const w = diag?.worker;
  const diskGb = w?.disk_free_gb ?? diag?.api.disk_free_gb ?? null;

  return (
    <Section
      icon={Stethoscope}
      title={t("settings.diagnosticsTitle")}
      hint={t("settings.diagnosticsHelp")}
      action={
        <div className="flex gap-1.5">
          <button onClick={run} disabled={loading} className="btn btn-glass btn-sm">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> {t("settings.runDiagnostics")}
          </button>
          <button onClick={copyReport} disabled={!diag} className="btn btn-ghost btn-sm">
            <Copy className="w-3.5 h-3.5" /> {t("settings.copyReport")}
          </button>
        </div>
      }
    >
      {loading && !diag ? (
        <div className="flex items-center gap-2 text-[13.5px] text-ink-3 py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {t("settings.diag.running")}
        </div>
      ) : diag ? (
        <div className="px-4 rounded-[14px] inset">
          <DiagRow
            label={t("settings.diag.worker")}
            level={w ? "ok" : "error"}
            value={w ? t("settings.diag.workerOk") : `${t("settings.diag.workerDown")} (${diag.worker_error})`}
          />
          {w && (
            <>
              <DiagRow
                label={t("settings.diag.gpu")}
                level={w.device === "cuda" || w.device === "mps" ? "ok" : w.device === "cpu" ? "warn" : "error"}
                value={w.gpu ?? (w.device === "cpu" ? t("settings.diag.noGpu") : w.device_error ?? "?")}
              />
              <DiagRow label={t("settings.diag.ffmpeg")} level={w.ffmpeg ? "ok" : "error"} value={w.ffmpeg ?? t("settings.diag.notFound")} />
              <DiagRow label={t("settings.diag.ytdlp")} level={w.yt_dlp ? "ok" : "error"} value={w.yt_dlp ?? t("settings.diag.notFound")} />
              <DiagRow
                label={t("settings.diag.keys")}
                level={w.keys?.groq && w.keys?.openrouter ? "ok" : "error"}
                value={w.keys?.groq && w.keys?.openrouter ? t("settings.diag.keysOk") : t("settings.diag.keysMissing")}
              />
            </>
          )}
          {diskGb !== null && (
            <DiagRow
              label={t("settings.diag.disk")}
              level={diskGb >= 20 ? "ok" : diskGb >= 5 ? "warn" : "error"}
              value={diskGb >= 20 ? `${diskGb} Go` : t("settings.diag.diskLow", { gb: diskGb })}
            />
          )}
          <DiagRow label={t("settings.diag.dataDir")} level="ok" value={<span className="mono text-[12.5px]">{diag.api.data_dir}</span>} />
          <DiagRow
            label={t("settings.diag.versions")}
            level="ok"
            value={
              <span className="mono text-[12.5px] text-ink-2">
                Node {diag.api.node}
                {w?.python && ` · Python ${w.python}`}
                {w?.torch && ` · torch ${w.torch}`}
              </span>
            }
          />
        </div>
      ) : null}
    </Section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const keys = useKeyChecks();

  const changeLanguage = (code: string) => {
    i18n.changeLanguage(code);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
    } catch {
      // Blocked storage: the language applies to this session only
    }
  };

  return (
    <div className="animate-fade-in max-w-[880px]">
      <h1 className="title-large">{t("settings.title")}</h1>
      <p className="mt-1.5 text-[13.5px] text-ink-2">{t("settings.subtitle")}</p>

      <div className="mt-7 flex flex-col gap-4">
        <Section icon={KeyRound} title={t("settings.keysTitle")} hint={t("settings.keysHelp")}>
          <div className="flex flex-col gap-2.5">
            {REQUIRED_KEYS.map((def) => (
              <KeyField key={def.name} def={def} state={keys.stateOf(def.name)} setState={(s) => keys.setKeyState(def.name, s)} />
            ))}
            {OPTIONAL_KEYS.map((def) => (
              <KeyField key={def.name} def={def} state={keys.stateOf(def.name)} setState={(s) => keys.setKeyState(def.name, s)} removable />
            ))}
          </div>
        </Section>

        <Section icon={Globe} title={t("settings.languageTitle")}>
          <div role="group" aria-label={t("settings.languageTitle")} className="seg">
            {LANGUAGES.map((lang) => (
              <button key={lang.code} aria-pressed={i18n.language.startsWith(lang.code)} onClick={() => changeLanguage(lang.code)}>
                {t(lang.labelKey)}
              </button>
            ))}
          </div>
        </Section>

        <DiagnosticsSection />

        <Section icon={Sparkles} title={t("settings.welcomeTitle")} hint={t("settings.welcomeHint")}>
          <Link to="/bienvenue" className="btn btn-glass btn-sm">
            {t("settings.welcomeCta")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Section>
      </div>
    </div>
  );
}
