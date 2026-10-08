import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { getDiagnostics, updateSettings, type ApiKeyName, type Diagnostics } from "../lib/api";
import { LANGUAGE_STORAGE_KEY } from "../lib/i18n";
import { useSettings } from "../lib/SettingsContext";
import { useToast } from "../components/Toast";

const LANGUAGES = [
  { code: "fr", labelKey: "profile.french" },
  { code: "en", labelKey: "profile.english" },
  { code: "es", labelKey: "profile.spanish" },
] as const;

const API_KEYS: { name: ApiKeyName; labelKey: string; descKey: string; url: string; required: boolean }[] = [
  { name: "groq_api_key", labelKey: "settings.groqLabel", descKey: "settings.groqDesc", url: "https://console.groq.com/keys", required: true },
  { name: "openrouter_api_key", labelKey: "settings.openrouterLabel", descKey: "settings.openrouterDesc", url: "https://openrouter.ai/keys", required: true },
  { name: "openai_api_key", labelKey: "settings.openaiLabel", descKey: "settings.openaiDesc", url: "https://platform.openai.com/api-keys", required: false },
];

function Section({ icon: Icon, title, children }: { icon: typeof Globe; title: string; children: ReactNode }) {
  return (
    <div className="surface-static rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center">
          <Icon className="w-4 h-4 text-zinc-400" />
        </div>
        <h2 className="text-sm font-medium text-white">{title}</h2>
      </div>
      <div className="pl-12">{children}</div>
    </div>
  );
}

// ── API keys ────────────────────────────────────────────────────────────────

function ApiKeyRow({ keyDef }: { keyDef: (typeof API_KEYS)[number] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, refresh } = useSettings();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const status = settings?.keys[keyDef.name];
  const configured = Boolean(status?.configured);

  const save = async (newValue: string) => {
    setSaving(true);
    try {
      await updateSettings({ [keyDef.name]: newValue });
      await refresh();
      setValue("");
      toast.success(t(newValue ? "settings.keySaved" : "settings.keyRemoved"));
    } catch {
      toast.error(t("settings.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 first:pt-0 last:pb-0 border-b border-white/[0.06] last:border-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-zinc-200">{t(keyDef.labelKey)}</span>
        {configured ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">{t("settings.configured")}</span>
        ) : keyDef.required ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">{t("settings.missing")}</span>
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-white/[0.06] text-zinc-500">{t("settings.optional")}</span>
        )}
        {status?.preview && <span className="text-xs text-zinc-500 font-mono">{status.preview}</span>}
        <a
          href={keyDef.url}
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200"
        >
          {t("settings.getKey")}
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <p className="text-xs text-zinc-500 mb-2">{t(keyDef.descKey)}</p>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save(value.trim());
        }}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(configured ? "settings.replacePlaceholder" : "settings.placeholder")}
          className="flex-1 min-w-0 px-3 py-2 text-sm bg-white/[0.04] border border-white/[0.08] rounded-lg text-white placeholder:text-zinc-600 focus:outline-none focus:border-white/[0.2]"
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-white text-black hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t("settings.save")}
        </button>
        {configured && (
          <button
            type="button"
            disabled={saving}
            onClick={() => save("")}
            className="px-3 py-2 text-sm text-zinc-500 hover:text-red-400 transition-colors"
          >
            {t("settings.remove")}
          </button>
        )}
      </form>
    </div>
  );
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

type Level = "ok" | "warn" | "error";

function DiagRow({ label, value, level }: { label: string; value: ReactNode; level: Level }) {
  const Icon = level === "ok" ? CheckCircle2 : level === "warn" ? AlertTriangle : XCircle;
  const color = level === "ok" ? "text-emerald-400" : level === "warn" ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
      <span className="text-sm text-zinc-400 w-48 shrink-0">{label}</span>
      <span className="text-sm text-zinc-200 min-w-0 break-words">{value}</span>
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
    <Section icon={Stethoscope} title={t("settings.diagnosticsTitle")}>
      <p className="text-xs text-zinc-500 mb-3">{t("settings.diagnosticsHelp")}</p>

      {loading && !diag ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t("settings.diag.running")}
        </div>
      ) : diag ? (
        <div className="mb-4">
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
              <DiagRow
                label={t("settings.diag.ffmpeg")}
                level={w.ffmpeg ? "ok" : "error"}
                value={w.ffmpeg ?? t("settings.diag.notFound")}
              />
              <DiagRow
                label={t("settings.diag.ytdlp")}
                level={w.yt_dlp ? "ok" : "error"}
                value={w.yt_dlp ?? t("settings.diag.notFound")}
              />
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
          <DiagRow label={t("settings.diag.dataDir")} level="ok" value={<span className="font-mono text-xs">{diag.api.data_dir}</span>} />
          <DiagRow
            label={t("settings.diag.versions")}
            level="ok"
            value={
              <span className="text-xs text-zinc-400">
                Node {diag.api.node}
                {w?.python && ` · Python ${w.python}`}
                {w?.torch && ` · torch ${w.torch}`}
              </span>
            }
          />
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          onClick={run}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {t("settings.runDiagnostics")}
        </button>
        <button
          onClick={copyReport}
          disabled={!diag}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-zinc-300 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] rounded-lg transition-colors disabled:opacity-50"
        >
          <Copy className="w-4 h-4" />
          {t("settings.copyReport")}
        </button>
      </div>
    </Section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { t, i18n } = useTranslation();

  const handleLanguageChange = (code: string) => {
    i18n.changeLanguage(code);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  };

  return (
    <div className="animate-fade-in">
      <h1 className="text-xl font-semibold text-white tracking-tight mb-6">{t("settings.title")}</h1>

      <div className="space-y-4 max-w-2xl">
        <Section icon={KeyRound} title={t("settings.keysTitle")}>
          <p className="text-xs text-zinc-500 mb-4">{t("settings.keysHelp")}</p>
          {API_KEYS.map((keyDef) => (
            <ApiKeyRow key={keyDef.name} keyDef={keyDef} />
          ))}
        </Section>

        <Section icon={Globe} title={t("settings.languageTitle")}>
          <div className="flex gap-2">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageChange(lang.code)}
                className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                  i18n.language.startsWith(lang.code)
                    ? "bg-white text-black font-medium"
                    : "bg-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.1] border border-white/[0.08]"
                }`}
              >
                {t(lang.labelKey)}
              </button>
            ))}
          </div>
        </Section>

        <DiagnosticsSection />
      </div>
    </div>
  );
}
