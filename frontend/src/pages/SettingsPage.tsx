import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, AppWindow, ArrowRight, Check, CheckCircle2, Copy, Download, FolderOpen, Globe, HardDrive, KeyRound, LifeBuoy, Loader2, Mic, RefreshCw, RotateCw, Sparkles, Stethoscope, Trash2, Wrench, XCircle } from "lucide-react";
import {
  clearLogs,
  exportLogs,
  freeIdleProjects,
  getDiagnostics,
  getDiskSpace,
  getLogsSize,
  runLocalTest,
  setCleanupDays,
  updateTranscription,
  type Diagnostics,
  type DiskSpace,
  type LocalTest,
  type TranscriptionEngine,
  type WorkerDiagnostics,
} from "../lib/api";
import { desktop, updates, useUpdateState, type DesktopInfo } from "../lib/desktop";
import ConfirmModal from "../components/ConfirmModal";
import { useSettings } from "../lib/SettingsContext";
import { LANGUAGE_STORAGE_KEY } from "../lib/i18n";
import KeyField, { OPTIONAL_KEYS, REQUIRED_KEYS, useKeyChecks } from "../components/KeyField";
import { useToast } from "../components/Toast";
import { OPENROUTER_CREDITS_URL } from "../components/ProviderFix";
import MachineCard from "../components/welcome/MachineCard";
import { useChannel } from "../lib/ChannelContext";
import { typicalLive } from "../lib/machine";
import { fileSize } from "../lib/format";

const LANGUAGES = [
  { code: "fr", labelKey: "profile.french" },
  { code: "en", labelKey: "profile.english" },
  { code: "es", labelKey: "profile.spanish" },
] as const;

function Section({ id, icon: Icon, title, hint, action, children }: { id?: string; icon: typeof Globe; title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="glass rounded-[20px] p-6 scroll-mt-24">
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

// ── Transcription ───────────────────────────────────────────────────────────

/** Who transcribes: Groq when its key is set, else OpenRouter or this PC */
function TranscriptionSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, refresh } = useSettings();
  const { channel } = useChannel();
  const [local, setLocal] = useState<WorkerDiagnostics["transcription"] | null>(null);
  const [saving, setSaving] = useState<TranscriptionEngine | null>(null);

  useEffect(() => {
    getDiagnostics()
      .then((d) => setLocal(d.worker?.transcription ?? null))
      .catch(() => setLocal(null));
  }, []);

  const hasGroq = !!settings?.keys.groq_api_key?.configured;
  const choice = settings?.transcription ?? "auto";
  // What actually runs: the choice when it can, else the fastest (Groq with its key, then this PC if fast, then OpenRouter)
  const fastLocal = local?.local_device === "mlx" || local?.local_device === "cuda";
  const active: Exclude<TranscriptionEngine, "auto"> =
    choice !== "auto" && !(choice === "groq" && !hasGroq) ? choice : hasGroq ? "groq" : fastLocal ? "local" : "openrouter";

  const pick = async (engine: Exclude<TranscriptionEngine, "auto">) => {
    if (engine === active) return;
    setSaving(engine);
    try {
      await updateTranscription(engine);
      await refresh();
      toast.success(t("settings.transcription.saved", { engine: t(`settings.transcription.${engine}`) }));
    } catch {
      toast.error(t("settings.transcription.saveError"));
    } finally {
      setSaving(null);
    }
  };

  const options: { id: Exclude<TranscriptionEngine, "auto">; hint: string; disabled?: boolean }[] = [
    { id: "groq", hint: t(hasGroq ? "settings.transcription.groqHint" : "settings.transcription.groqNeedsKey"), disabled: !hasGroq },
    { id: "openrouter", hint: t("settings.transcription.openrouterHint") },
    {
      id: "local",
      hint: t(
        local?.local_device === "mlx"
          ? "settings.transcription.localMlx"
          : local?.local_device === "cuda"
            ? "settings.transcription.localGpu"
            : local?.local_device === "cpu"
              ? "settings.transcription.localCpu"
              : "settings.transcription.localUnknown",
      ),
    },
  ];

  return (
    <Section icon={Mic} title={t("settings.transcription.title")} hint={t("settings.transcription.help")}>
      <div role="radiogroup" aria-label={t("settings.transcription.title")} className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => (
          <button
            key={o.id}
            role="radio"
            aria-checked={active === o.id}
            disabled={o.disabled || saving !== null}
            onClick={() => pick(o.id)}
            className={`text-left rounded-[14px] p-3.5 border transition-colors disabled:cursor-not-allowed ${
              active === o.id ? "bg-white/[0.08] border-accent shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-white/[0.08] hover:bg-white/[0.05] disabled:opacity-50"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold text-white">{t(`settings.transcription.${o.id}`)}</span>
              {saving === o.id ? <Loader2 className="w-4 h-4 animate-spin text-ink-3" /> : active === o.id ? <Check className="w-4 h-4 text-accent" /> : null}
            </span>
            <span className="mt-1 block text-[12px] leading-snug text-ink-3">{o.hint}</span>
          </button>
        ))}
      </div>
      {active === "local" && local && !local.local_model_ready && <p className="mt-3 text-[12.5px] text-ink-3">{t("settings.transcription.download")}</p>}
      {/* This computer against Groq, on one of the streamer's lives */}
      <div className="mt-3">
        <MachineCard liveSeconds={typicalLive((channel?.vods ?? []).map((v) => v.duration_seconds))} />
      </div>
    </Section>
  );
}

// ── Storage ─────────────────────────────────────────────────────────────────

const CLEANUP_AGES = [7, 30, 90] as const;

/** What Cuttie keeps on this computer, and the cleanup of old clips (exports always stay) */
function StorageSection() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [disk, setDisk] = useState<DiskSpace | null>(null);
  const [age, setAge] = useState<number>(30);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"free" | "auto" | null>(null);
  const aged = useRef(false);

  const load = useCallback(async () => {
    try {
      const space = await getDiskSpace();
      setDisk(space);
      // The age shown first: the cleanup's, when it runs
      if (!aged.current && space.cleanup_days) setAge(space.cleanup_days);
      aged.current = true;
    } catch {
      setDisk(null);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!disk) return null;
  const size = (bytes: number) => fileSize(bytes, i18n.language);
  const { usage } = disk;
  const auto = disk.cleanup_days > 0;
  const cleanable = disk.cleanable[String(age)] ?? { projects: 0, bytes: 0 };
  const parts = [
    { key: "clips", bytes: usage.clips, color: "bg-accent" },
    { key: "exports", bytes: usage.exports, color: "bg-white/60" },
    { key: "models", bytes: usage.models, color: "bg-white/30" },
    { key: "other", bytes: usage.other + usage.logs, color: "bg-white/15" },
  ].filter((p) => p.bytes > 0);
  const lowDisk = usage.free !== null && usage.free < 20e9;

  const saveCleanup = async (days: number) => {
    setBusy(true);
    try {
      const { freed } = await setCleanupDays(days);
      if (!days) toast.success(t("settings.storage.autoOff"));
      else if (freed > 0) toast.success(t("settings.storage.autoOnFreed", { size: size(freed) }));
      else toast.success(t("settings.storage.autoOn", { count: days }));
      await load();
    } catch {
      toast.error(t("settings.storage.failed"));
    } finally {
      setBusy(false);
    }
  };

  const freeNow = async () => {
    setBusy(true);
    try {
      const { projects, bytes } = await freeIdleProjects(age);
      toast.success(t("settings.storage.freed", { count: projects, size: size(bytes) }));
      await load();
    } catch {
      toast.error(t("settings.storage.failed"));
    } finally {
      setBusy(false);
    }
  };

  const chooseAge = (days: number) => {
    setAge(days);
    if (auto && days !== disk.cleanup_days) {
      // A shorter age frees projects at once: say so first
      if ((disk.cleanable[String(days)]?.projects ?? 0) > 0) setConfirm("auto");
      else saveCleanup(days);
    }
  };
  const toggleAuto = () => {
    if (auto) saveCleanup(0);
    else if (cleanable.projects > 0) setConfirm("auto");
    else saveCleanup(age);
  };

  return (
    <Section id="stockage" icon={HardDrive} title={t("settings.storage.title")} hint={t("settings.storage.hint")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[14px] font-[550] text-white">{t("settings.storage.used", { size: size(usage.total) })}</span>
        {usage.free !== null && (
          <span className={`text-[12.5px] ${lowDisk ? "text-[#f5b14c]" : "text-ink-3"}`}>{t("settings.storage.free", { size: size(usage.free) })}</span>
        )}
      </div>
      <div className="mt-2.5 h-2 rounded-full bg-white/[0.08] overflow-hidden flex gap-px" role="img" aria-label={t("settings.storage.used", { size: size(usage.total) })}>
        {parts.map((p, i) => (
          <span key={p.key} className={`machine-bar ${p.color}`} style={{ width: `${(p.bytes / Math.max(1, usage.total)) * 100}%`, ["--i" as string]: i }} />
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5 text-ink-2">
            <span className={`w-2 h-2 rounded-full ${p.color}`} />
            {t(`settings.storage.part.${p.key}`)} <span className="mono text-ink-3">{size(p.bytes)}</span>
          </span>
        ))}
      </div>

      <div className="mt-5 pt-5 border-t border-white/[0.06]">
        <div className="text-[14px] font-[550] text-white">{t("settings.storage.cleanTitle")}</div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3 max-w-[64ch]">{t("settings.storage.cleanHint")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div role="group" aria-label={t("settings.storage.cleanTitle")} className="seg">
            {CLEANUP_AGES.map((days) => (
              <button key={days} aria-pressed={age === days} disabled={busy} onClick={() => chooseAge(days)}>
                {t("settings.storage.days", { count: days })}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-ink-2">
            {cleanable.projects ? t("settings.storage.cleanable", { count: cleanable.projects, size: size(cleanable.bytes) }) : t("settings.storage.nothing")}
          </span>
          <button onClick={() => setConfirm("free")} disabled={busy || !cleanable.projects} className="btn btn-glass btn-sm ml-auto">
            {busy && confirm === null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} {t("settings.storage.freeNow")}
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button role="switch" aria-checked={auto} aria-label={t("settings.storage.auto")} disabled={busy} onClick={toggleAuto} className="switch">
            <span />
          </button>
          <div className="min-w-0">
            <div className="text-[13.5px] text-white">{t("settings.storage.auto")}</div>
            <div className="text-[12px] text-ink-3">{auto ? t("settings.storage.autoHintOn", { count: disk.cleanup_days }) : t("settings.storage.autoHintOff")}</div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirm !== null}
        variant="default"
        title={confirm === "auto" ? t("settings.storage.confirmAutoTitle") : t("settings.storage.confirmFreeTitle", { size: size(cleanable.bytes) })}
        message={t("settings.storage.confirmBody", {
          count: disk.cleanable[String(age)]?.projects ?? 0,
          days: age,
          size: size(disk.cleanable[String(age)]?.bytes ?? 0),
        })}
        confirmLabel={confirm === "auto" ? t("settings.storage.confirmAuto") : t("settings.storage.freeNow")}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action === "auto") saveCleanup(age);
          else freeNow();
        }}
        onCancel={() => {
          setConfirm(null);
          if (auto) setAge(disk.cleanup_days);
        }}
      />
    </Section>
  );
}

// ── Help from afar ──────────────────────────────────────────────────────────

const LOG_PERIODS = [1, 24, 168, 0] as const;

/** The journal as a .zip to send to whoever helps (keys taken out), and emptying it */
function JournalSection() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [hours, setHours] = useState<number>(24);
  const [bytes, setBytes] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    getLogsSize()
      .then(setBytes)
      .catch(() => setBytes(null));
  }, []);

  const extract = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await exportLogs(hours);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast.success(t("settings.journal.exported", { file: filename }));
    } catch {
      toast.error(t("settings.journal.exportFailed"));
    } finally {
      setExporting(false);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    try {
      const { freed, bytes: left } = await clearLogs();
      setBytes(left);
      toast.success(t("settings.journal.cleared", { size: fileSize(freed, i18n.language) }));
    } catch {
      toast.error(t("settings.journal.clearFailed"));
    }
  };

  return (
    <Section icon={LifeBuoy} title={t("settings.journal.title")} hint={t("settings.journal.hint")}>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t("settings.journal.period")} className="seg">
          {LOG_PERIODS.map((h) => (
            <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>
              {t(`settings.journal.periods.${h}`)}
            </button>
          ))}
        </div>
        <button onClick={extract} disabled={exporting} className="btn btn-primary btn-sm">
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} {t("settings.journal.extract")}
        </button>
      </div>
      <div className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap gap-1.5">
        {desktop && (
          <button onClick={() => desktop?.openLogs()} className="btn btn-ghost btn-sm">
            <FolderOpen className="w-3.5 h-3.5" /> {t("settings.app.logs")}
          </button>
        )}
        {bytes !== null && (
          <button onClick={() => setConfirmClear(true)} disabled={bytes === 0} className="btn btn-ghost btn-sm">
            <Trash2 className="w-3.5 h-3.5" /> {t("settings.journal.clear", { size: fileSize(bytes, i18n.language) })}
          </button>
        )}
      </div>
      <ConfirmModal
        open={confirmClear}
        title={t("settings.journal.clearTitle")}
        message={t("settings.journal.clearBody")}
        onConfirm={clear}
        onCancel={() => setConfirmClear(false)}
      />
    </Section>
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
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [localTest, setLocalTest] = useState<LocalTest | null>(null);
  const [testing, setTesting] = useState(false);

  const testLocal = async () => {
    setTesting(true);
    try {
      setLocalTest(await runLocalTest());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings.diag.failed"));
    } finally {
      setTesting(false);
    }
  };
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
      await navigator.clipboard.writeText(JSON.stringify(localTest ? { ...diag, local_test: localTest } : diag, null, 2));
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
                level={!w.keys?.openrouter || (w.openrouter ?? "ok") !== "ok" ? "error" : (w.openrouter_credit?.remaining ?? 99) < 1 ? "warn" : "ok"}
                value={
                  !w.keys?.openrouter ? (
                    t("settings.diag.keysMissing")
                  ) : w.openrouter === "credits" ? (
                    <>
                      {t("settings.diag.openrouterCredits")} ·{" "}
                      <a href={OPENROUTER_CREDITS_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
                        {t("job.provider.topUp")}
                      </a>
                    </>
                  ) : w.openrouter === "key" ? (
                    t("settings.diag.openrouterKey")
                  ) : (
                    <>
                      {t(w.keys?.groq ? "settings.diag.keysBoth" : "settings.diag.keysOk")}
                      {w.openrouter_credit && (
                        <>
                          {" · "}
                          {t("settings.diag.creditLeft", {
                            amount: w.openrouter_credit.remaining.toLocaleString(i18n.language, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" }),
                          })}
                        </>
                      )}
                    </>
                  )
                }
              />
              {w.transcription?.engine && (
                <DiagRow
                  label={t("settings.transcription.title")}
                  level={w.transcription.engine === "local" && w.transcription.local_device === "cpu" ? "warn" : "ok"}
                  value={`${t(`settings.transcription.${w.transcription.engine}`)}${
                    w.transcription.engine === "local"
                      ? ` · ${w.transcription.local_device === "cuda" ? "NVIDIA" : w.transcription.local_device === "mlx" ? t("settings.diag.appleChip") : t("settings.diag.cpu")}`
                      : ""
                  }`}
                />
              )}
            </>
          )}
          {diskGb !== null && (
            <DiagRow
              label={t("settings.diag.disk")}
              level={diskGb >= 20 ? "ok" : diskGb >= 5 ? "warn" : "error"}
              value={diskGb >= 20 ? `${diskGb} Go` : t("settings.diag.diskLow", { gb: diskGb })}
            />
          )}
          <DiagRow
            label={t("settings.diag.localTest")}
            level={!localTest ? "ok" : localTest.whisper.error || localTest.gpu.error || localTest.voices?.error ? "error" : localTest.whisper.backend === "cpu" ? "warn" : "ok"}
            value={
              testing ? (
                <span className="inline-flex items-center gap-2 text-ink-3">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t(localTest?.whisper.model_ready === false || !w?.transcription?.local_model_ready ? "settings.diag.localTestDownloading" : "settings.diag.localTestRunning")}
                </span>
              ) : localTest ? (
                <span className="flex flex-col gap-0.5">
                  <span>
                    {localTest.whisper.error
                      ? t("settings.diag.localTestFailed", { error: localTest.whisper.error.slice(0, 160) })
                      : t("settings.diag.localTestResult", {
                          where: localTest.gpu.name ?? (localTest.whisper.backend === "mlx" ? t("settings.diag.appleChip") : localTest.whisper.backend === "cuda" ? "NVIDIA" : t("settings.diag.cpu")),
                          speed: Math.round(localTest.whisper.realtime ?? 0).toLocaleString(i18n.language),
                        })}
                  </span>
                  {localTest.gpu.error && <span className="text-[12px] text-ink-3">PyTorch : {localTest.gpu.error.slice(0, 160)}</span>}
                  {localTest.voices?.error && <span className="text-[12px] text-ink-3">{t("settings.diag.voicesFailed", { error: localTest.voices.error.slice(0, 160) })}</span>}
                </span>
              ) : (
                <button onClick={testLocal} className="btn btn-glass btn-sm">
                  {t("settings.diag.localTestRun")}
                </button>
              )
            }
          />
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

// ── Application (the desktop app only) ─────────────────────────────────────

/** Version, one-click update from GitHub, logs and repair of the Python modules */
function AppSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateState();
  const { hash } = useLocation();
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [confirm, setConfirm] = useState<"busy" | "repair" | null>(null);
  // Toasts only for what was clicked here (not the quiet check at launch)
  const clicked = useRef(false);
  const previous = useRef(update.phase);

  useEffect(() => {
    desktop
      ?.info()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  useEffect(() => {
    if (hash === "#app") document.getElementById("app")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  // The toast context object changes on every toast, its methods don't
  const showSuccess = toast.success;
  const showError = toast.error;
  useEffect(() => {
    const was = previous.current;
    previous.current = update.phase;
    if (was === update.phase || !clicked.current) return;
    if (update.phase === "latest") showSuccess(t("settings.app.latest"));
    if (update.phase === "ready") showSuccess(t("settings.app.ready", { version: update.version }));
    if (update.phase === "error") showError(t("settings.app.failed", { message: update.message }));
  }, [update, t, showSuccess, showError]);

  if (!desktop) return null;

  const act = (fn: () => void) => () => {
    clicked.current = true;
    fn();
  };
  const install = act(async () => {
    // An analysis running stops with the restart: ask first
    let busy: string | null = null;
    try {
      busy = (await getDiagnostics()).worker?.busy ?? null;
    } catch {
      // Worker unreachable: nothing running to lose
    }
    if (busy) setConfirm("busy");
    else updates.install();
  });

  const version = info ? t("settings.app.version", { version: info.version }) : "";
  let line: ReactNode = version;
  let button: ReactNode = (
    <button onClick={act(updates.check)} className="btn btn-glass btn-sm">
      <RefreshCw className="w-3.5 h-3.5" /> {t("settings.app.check")}
    </button>
  );
  switch (update.phase) {
    case "checking":
      button = (
        <button disabled className="btn btn-glass btn-sm">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("settings.app.checking")}
        </button>
      );
      break;
    case "latest":
      line = (
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-accent" /> {t("settings.app.latest")}
        </span>
      );
      break;
    case "dev":
      line = t("settings.app.dev");
      button = null;
      break;
    case "available":
      line = t("settings.app.available", { version: update.version });
      button = (
        <button onClick={act(updates.download)} className="btn btn-primary btn-sm">
          <Download className="w-3.5 h-3.5" /> {t("settings.app.download")}
        </button>
      );
      break;
    case "downloading":
      line = t("settings.app.downloading", { version: update.version, percent: update.percent });
      button = null;
      break;
    case "ready":
      line = t("settings.app.ready", { version: update.version });
      button = (
        <button onClick={install} className="btn btn-primary btn-sm">
          <RotateCw className="w-3.5 h-3.5" /> {t("settings.app.install")}
        </button>
      );
      break;
    case "installing":
      line = (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="w-4 h-4 animate-spin text-ink-3" /> {t("settings.app.installing")}
        </span>
      );
      button = null;
      break;
    case "error":
      line = <span className="text-[#ff8a7a]">{t("settings.app.failed", { message: update.message })}</span>;
      button = (
        <button onClick={act(updates.check)} className="btn btn-glass btn-sm">
          <RefreshCw className="w-3.5 h-3.5" /> {t("settings.app.retry")}
        </button>
      );
      break;
  }

  return (
    <Section id="app" icon={AppWindow} title={t("settings.app.title")} hint={t("settings.app.hint")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <div className="text-[14px] font-[550] text-white">{line}</div>
          {line !== version && version && <div className="mt-0.5 mono text-[12px] text-ink-3">{version}</div>}
        </div>
        {button}
      </div>

      {update.phase === "downloading" && (
        <div className="mt-3 h-1.5 rounded-full bg-white/[0.08] overflow-hidden" role="progressbar" aria-valuenow={update.percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${update.percent}%` }} />
        </div>
      )}

      {update.phase === "available" && update.notes && (
        <div className="mt-3 rounded-[12px] bg-white/[0.04] p-3.5">
          <div className="text-[12px] font-[550] text-ink-2">{t("settings.app.notes")}</div>
          <p className="mt-1 max-h-40 overflow-auto whitespace-pre-line text-[12.5px] leading-relaxed text-ink-3">{update.notes}</p>
        </div>
      )}

      {info?.packaged && (
        <div className="mt-4 pt-4 border-t border-white/[0.06] flex flex-wrap gap-1.5">
          <button onClick={() => setConfirm("repair")} className="btn btn-ghost btn-sm">
            <Wrench className="w-3.5 h-3.5" /> {t("settings.app.repair")}
          </button>
        </div>
      )}

      <ConfirmModal
        open={confirm === "busy"}
        variant="default"
        title={t("settings.app.busyTitle")}
        message={t("settings.app.busyBody")}
        confirmLabel={t("settings.app.busyConfirm")}
        onConfirm={() => {
          setConfirm(null);
          updates.install();
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmModal
        open={confirm === "repair"}
        variant="default"
        title={t("settings.app.repairTitle")}
        message={t("settings.app.repairBody")}
        confirmLabel={t("settings.app.repairConfirm")}
        onConfirm={() => {
          setConfirm(null);
          desktop?.repairPython();
        }}
        onCancel={() => setConfirm(null)}
      />
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

        <TranscriptionSection />

        <Section icon={Globe} title={t("settings.languageTitle")}>
          <div role="group" aria-label={t("settings.languageTitle")} className="seg">
            {LANGUAGES.map((lang) => (
              <button key={lang.code} aria-pressed={i18n.language.startsWith(lang.code)} onClick={() => changeLanguage(lang.code)}>
                {t(lang.labelKey)}
              </button>
            ))}
          </div>
        </Section>

        <StorageSection />

        <DiagnosticsSection />

        <JournalSection />

        <AppSection />

        <Section icon={Sparkles} title={t("settings.welcomeTitle")} hint={t("settings.welcomeHint")}>
          <Link to="/bienvenue" className="btn btn-glass btn-sm">
            {t("settings.welcomeCta")} <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Section>
      </div>
    </div>
  );
}
