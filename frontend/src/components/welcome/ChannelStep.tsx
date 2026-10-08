import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Loader2, X } from "lucide-react";
import { lookupChannel, lookupChannelColors } from "../../lib/api";
import { parseTwitchLogin } from "../../lib/twitch";
import { Progress, type FoundChannel } from "./shared";

interface Props {
  initialLogin: string | null;
  found: FoundChannel | null;
  setFound: (found: FoundChannel | null) => void;
  onContinue: (found: FoundChannel) => Promise<void>;
  onSkip: () => void;
}

type Search = "idle" | "searching" | "found" | "missing" | "error";

/** Step 1: find the streamer's channel, show their logo colors */
export default function ChannelStep({ initialLogin, found, setFound, onContinue, onSkip }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialLogin ?? "");
  const [search, setSearch] = useState<Search>(found ? "found" : "idle");
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const parsed = parseTwitchLogin(value);
  const login = parsed.kind === "login" ? parsed.login : null;

  useEffect(() => {
    if (!login) {
      setSearch("idle");
      setFound(null);
      return;
    }
    let cancelled = false;
    setSearch("searching");
    const timer = window.setTimeout(async () => {
      try {
        const channel = await lookupChannel(login);
        if (cancelled) return;
        if (!channel) {
          setSearch("missing");
          setFound(null);
          return;
        }
        setSearch("found");
        setFound({ channel, colors: null });
        const colors = await lookupChannelColors(login).catch(() => null);
        if (!cancelled && colors) setFound({ channel, colors });
      } catch {
        if (cancelled) return;
        setSearch("error");
        setFound(null);
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [login, attempt, setFound]);

  const current = search === "found" && found?.channel.login === login ? found : null;
  const swatches = current?.colors
    ? [current.colors.roles.accent, current.colors.roles.dark, current.colors.roles.light, current.colors.roles.highlight]
    : null;

  const submit = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      await onContinue(current);
    } finally {
      setSaving(false);
    }
  };

  const message =
    parsed.kind === "vod"
      ? t("welcome.channel.vodLink")
      : parsed.kind === "invalid"
        ? t("welcome.channel.invalid")
        : search === "missing"
          ? t("welcome.channel.notFound", { login })
          : search === "error"
            ? t("welcome.channel.error")
            : null;

  return (
    <>
      <Progress step={0} />
      <div className="mt-[22px] text-[13px] font-[550] text-accent">{t("welcome.channel.label", { n: 1 })}</div>
      <h1 className="mt-2 text-[34px] leading-[1.08] tracking-[-0.03em] font-[650] text-white text-balance">{t("welcome.channel.title")}</h1>
      <p className="mt-2.5 text-[14.5px] leading-[1.55] text-ink-2 max-w-[44ch]">{t("welcome.channel.lead")}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="welcome-channel" className="block mt-6 text-[12.5px] font-[550] text-ink-2">
          {t("welcome.channel.field")}
        </label>
        <div
          className={`mt-2 flex items-center h-[50px] px-3.5 rounded-[12px] bg-black/30 border transition-[border-color,box-shadow] duration-200 ${
            current ? "border-accent-line shadow-[0_0_0_4px_var(--color-accent-soft)]" : "border-white/10 focus-within:border-white/30 focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.06)]"
          }`}
        >
          <span className="mono text-[15px] text-ink-4">twitch.tv/</span>
          <input
            id="welcome-channel"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              // A pasted channel link becomes the bare login
              const text = e.clipboardData.getData("text");
              const pasted = parseTwitchLogin(text);
              if (pasted.kind === "login" && text.includes("twitch.tv")) {
                e.preventDefault();
                setValue(pasted.login);
              }
            }}
            placeholder={t("welcome.channel.placeholder")}
            aria-invalid={!!message}
            aria-describedby="welcome-channel-status"
            className="mono flex-1 min-w-0 h-full bg-transparent outline-none focus-visible:outline-none text-[15px] text-white placeholder:text-ink-4"
          />
          {search === "searching" ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin text-ink-3" aria-label={t("welcome.channel.searching")} />
          ) : current ? (
            <Check className="w-[18px] h-[18px] text-accent" strokeWidth={2.6} />
          ) : message ? (
            <X className="w-[18px] h-[18px] text-ink-3" strokeWidth={2.4} />
          ) : null}
        </div>
        <div id="welcome-channel-status" aria-live="polite">
          {message && <p className="mt-2 text-[12.5px] text-ink-2">{message}</p>}
          {search === "error" && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn btn-ghost btn-sm mt-1 -ml-2">
              {t("welcome.retry")}
            </button>
          )}
        </div>

        {current && (
          <div className="mt-3.5 flex items-center gap-3.5 p-3.5 rounded-[14px] inset animate-rise">
            <span
              className="w-[52px] h-[52px] rounded-[14px] overflow-hidden flex-none"
              style={{ background: current.colors?.roles.light ?? "rgba(255,255,255,0.08)" }}
            >
              {current.channel.avatar_url && (
                <img src={current.channel.avatar_url} alt={t("welcome.channel.logoAlt", { name: current.channel.display_name })} className="w-full h-full object-cover" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[16px] font-semibold tracking-[-0.01em] text-white truncate">{current.channel.display_name}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-2">
                {[
                  current.channel.followers !== null ? t("brand.followers", { count: current.channel.followers }) : null,
                  current.channel.vods.length > 0 ? t("welcome.channel.lives", { count: current.channel.vods.length }) : t("welcome.channel.noLives"),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex gap-1">
                {(swatches ?? [null, null, null, null]).map((color, i) =>
                  color ? (
                    <span key={i} className="w-[18px] h-[18px] rounded-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.15)]" style={{ background: color }} />
                  ) : (
                    <span key={i} className="w-[18px] h-[18px] rounded-[5px] skeleton" />
                  ),
                )}
              </div>
              <span className="text-[11px] text-ink-3">{t("welcome.channel.logoColors")}</span>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onSkip} className="btn btn-ghost btn-sm -ml-2">
            {t("welcome.channel.noChannel")}
          </button>
          <button type="submit" disabled={!current || saving} className="btn btn-primary btn-lg">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {t("welcome.continue")} <ArrowRight className="w-4 h-4" strokeWidth={2.2} />
          </button>
        </div>
      </form>
    </>
  );
}
