import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { brandFrameUrl, clipThumbUrl, type BrandColors, type SubtitleStyle, type WidgetTiming } from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { useLatestMoments } from "../lib/useLatestMoment";
import { useToast } from "../components/Toast";
import SignaturePreview from "../components/SignaturePreview";
import TemplateSketch from "../components/montage/TemplateSketch";
import { buildTemplate, type TemplateContext } from "../lib/templates";
import { sampleSubtitle } from "../lib/format";

const COLOR_ROLES: (keyof BrandColors)[] = ["accent", "highlight", "dark", "light"];
const TIMINGS: WidgetTiming[] = ["start", "always", "end"];
const SUB_STYLES: SubtitleStyle[] = ["bold", "karaoke", "minimal"];

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <article className="glass rounded-[18px] p-5 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
          {hint && <p className="mt-0.5 text-[12.5px] text-ink-3">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </article>
  );
}

function ChannelSwitcher({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { kit, saveKit } = useChannel();
  const [login, setLogin] = useState(kit?.twitch_login ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveKit({ twitch_login: login });
      toast.success(t("brand.saved"));
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <div className="flex items-center h-9 pl-3 pr-1 rounded-[10px] bg-black/30 border border-white/10">
        <span className="mono text-[13px] text-ink-3">twitch.tv/</span>
        <input
          autoFocus
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onDone()}
          aria-label={t("brand.channelPlaceholder")}
          placeholder={t("brand.channelPlaceholder")}
          className="mono w-36 bg-transparent text-[13px] text-white outline-none"
        />
      </div>
      <button type="submit" disabled={saving || !login.trim()} className="btn btn-primary btn-sm">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {t("brand.save")}
      </button>
      <button type="button" onClick={onDone} className="btn btn-ghost btn-sm">
        {t("brand.cancel")}
      </button>
    </form>
  );
}

function ColorRow({ role, value, onPick }: { role: keyof BrandColors; value: string; onPick: (hex: string) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      className="flex items-center gap-3 p-2.5 rounded-[12px] bg-white/[0.04] hover:bg-white/[0.07] transition-colors text-left"
    >
      <span className="w-[38px] h-[38px] rounded-[10px] flex-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" style={{ background: value }} />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-white">
          {t(`brand.role.${role}`)} <span className="mono font-normal text-[11.5px] text-ink-3">{value.toUpperCase()}</span>
        </span>
        <span className="block text-[12px] text-ink-3">{t(`brand.roleHint.${role}`)}</span>
      </span>
      <input
        ref={input}
        type="color"
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-label={t(`brand.role.${role}`)}
      />
    </button>
  );
}

export default function ChannelPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { kit, channel, saveKit, redetectColors } = useChannel();
  const latest = useLatestMoments();
  useBackdrop(channel?.banner_url ?? channel?.avatar_url);

  const [switching, setSwitching] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  const best = latest?.hotPoints[0] ?? null;
  // A frame of the latest analysis, else the live frame the webcam was confirmed on
  const frame = (width: 480 | 1280) =>
    latest && best?.clip_filename
      ? clipThumbUrl(latest.job.job_id, best.clip_filename, { width })
      : kit?.facecam_frame
        ? brandFrameUrl
        : null;
  const subtitle = sampleSubtitle(best?.llm?.transcript);
  const brandCam = kit?.facecam && typeof kit.facecam === "object" ? kit.facecam : null;
  const sketchContext: TemplateContext | null = kit
    ? {
        src: "",
        backgroundSrc: "",
        frameW: brandCam?.ref_w ?? 1920,
        frameH: brandCam?.ref_h ?? 1080,
        facecam: brandCam,
        words: [],
        startAt: 0,
        endAt: 30,
        colors: kit.colors,
        subtitleStyle: kit.subtitles.style,
        widget: kit.widget,
        login: channel?.login ?? kit.twitch_login,
        avatarUrl: channel?.avatar_url ?? null,
        hook: "",
      }
    : null;

  const save = async (patch: Parameters<typeof saveKit>[0], message = t("brand.saved")) => {
    try {
      await saveKit(patch);
      toast.success(message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("brand.saveError"));
    }
  };

  if (!kit) {
    return (
      <div className="max-w-[1320px] mx-auto px-8 pt-[112px]">
        <div className="h-[270px] rounded-[20px] skeleton" />
      </div>
    );
  }

  return (
    <div className="max-w-[1320px] mx-auto px-8 pt-[96px] pb-14">
      {/* Banner + identity */}
      <section className="relative h-[270px] rounded-[20px] overflow-hidden border border-white/10 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.8)] bg-white/[0.04] animate-rise">
        {channel?.banner_url && <img src={channel.banner_url} alt="" className="w-full h-full object-cover object-[50%_52%]" />}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(11,11,12,0.55)_0%,rgba(11,11,12,0)_45%)]" />
        {channel && (
          <span className="absolute top-3.5 right-3.5 chip glass-chip text-white h-7 px-2.5">
            <RefreshCw className="w-3.5 h-3.5" /> {t("brand.synced")}
          </span>
        )}
        <div className="absolute left-[18px] bottom-[18px] right-[18px] flex">
          <div className="glass-strong rounded-[16px] flex flex-wrap items-center gap-4 p-3 pr-3.5">
            <span className="w-[62px] h-[62px] rounded-[16px] overflow-hidden border-2 border-white/85" style={{ background: kit.colors.light }}>
              {channel?.avatar_url && <img src={channel.avatar_url} alt="" className="w-full h-full object-cover" />}
            </span>
            <div>
              <h1 className="text-[24px] font-[650] tracking-[-0.025em] text-white">{channel?.display_name ?? kit.twitch_login ?? t("brand.title")}</h1>
              {channel && (
                <p className="mt-0.5 text-[13px] text-ink-2">
                  twitch.tv/{channel.login}
                  {channel.followers !== null && ` · ${t("brand.followers", { count: channel.followers })}`}
                </p>
              )}
            </div>
            {switching ? (
              <ChannelSwitcher onDone={() => setSwitching(false)} />
            ) : (
              <button onClick={() => setSwitching(true)} className="btn btn-glass btn-sm ml-2">
                {t("brand.changeChannel")}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-[22px] flex flex-wrap gap-[18px] items-start">
        <div className="flex-[1_1_640px] min-w-0 grid gap-4 items-start grid-cols-[repeat(auto-fill,minmax(400px,1fr))]">
          {/* Colors */}
          <Card
            title={t("brand.colors")}
            hint={t("brand.colorsHint")}
            action={
              <button
                onClick={async () => {
                  setRedetecting(true);
                  try {
                    await redetectColors();
                    toast.success(t("brand.colorsDetected"));
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : t("brand.saveError"));
                  } finally {
                    setRedetecting(false);
                  }
                }}
                disabled={redetecting || !channel}
                className="btn btn-glass btn-sm"
              >
                {redetecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t("brand.redetect")}
              </button>
            }
          >
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {COLOR_ROLES.map((role) => (
                <ColorRow key={role} role={role} value={kit.colors[role]} onPick={(hex) => save({ colors: { [role]: hex } })} />
              ))}
            </div>
          </Card>

          {/* Widget */}
          <Card
            title={t("brand.widget")}
            hint={t("brand.widgetHint")}
            action={
              <button
                role="switch"
                aria-checked={kit.widget.enabled}
                aria-label={t("brand.widget")}
                onClick={() => save({ widget: { enabled: !kit.widget.enabled } })}
                className="switch"
              >
                <span />
              </button>
            }
          >
            <div className="relative mt-4 h-[104px] rounded-[12px] overflow-hidden grid place-items-center bg-white/[0.04]">
              {frame(480) && <img src={frame(480)!} alt="" className="absolute inset-0 w-full h-full object-cover blur-[14px] brightness-[0.6] scale-110" />}
              <div
                className={`relative flex items-center gap-2.5 h-12 pl-1.5 pr-[18px] rounded-full bg-white shadow-[0_12px_28px_-8px_rgba(0,0,0,0.6)] transition-opacity ${kit.widget.enabled ? "" : "opacity-40"}`}
              >
                <span className="w-9 h-9 rounded-full overflow-hidden" style={{ background: kit.colors.light }}>
                  {channel?.avatar_url && <img src={channel.avatar_url} alt="" className="w-full h-full object-cover" />}
                </span>
                <span className="text-[17px] font-medium text-[#60707c]">
                  twitch.tv/<span className="font-extrabold" style={{ color: kit.colors.dark }}>{channel?.login ?? kit.twitch_login}</span>
                </span>
              </div>
            </div>
            <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2.5">
              <span className="text-[13px] text-ink-2">{t("brand.widgetShow")}</span>
              <div role="group" aria-label={t("brand.widgetShow")} className="seg">
                {TIMINGS.map((timing) => (
                  <button
                    key={timing}
                    aria-pressed={kit.widget.timing === timing}
                    disabled={!kit.widget.enabled}
                    onClick={() => save({ widget: { timing } })}
                  >
                    {t(`brand.timing.${timing}`)}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Subtitles */}
          <Card title={t("brand.subtitles")} hint={t("brand.subtitlesHint")}>
            <div className="relative mt-4 h-[118px] rounded-[12px] overflow-hidden grid place-items-center text-center bg-white/[0.04] [container-type:inline-size]">
              {frame(480) && <img src={frame(480)!} alt="" className="absolute inset-0 w-full h-full object-cover brightness-[0.7]" />}
              {kit.subtitles.style === "minimal" ? (
                <span className="relative px-3 py-1.5 rounded-[8px] bg-black/55 text-[17px] font-bold text-white">
                  {subtitle.lines.map((l) => l.join(" ")).join(" ")}
                </span>
              ) : (
                <div className="relative clip-text text-white" style={{ fontSize: "6.4cqw" }}>
                  {subtitle.lines.map((line, li) => (
                    <div key={li}>
                      {line.map((word, wi) => (
                        <span
                          key={wi}
                          style={
                            kit.subtitles.style === "karaoke" && subtitle.highlight[0] === li && subtitle.highlight[1] === wi
                              ? { color: kit.colors.highlight }
                              : undefined
                          }
                        >
                          {wi > 0 ? " " : ""}
                          {word}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div role="group" aria-label={t("brand.subtitles")} className="seg mt-3.5">
              {SUB_STYLES.map((style) => (
                <button key={style} aria-pressed={kit.subtitles.style === style} onClick={() => save({ subtitles: { style } })}>
                  {t(`brand.subStyle.${style}`)}
                </button>
              ))}
            </div>
          </Card>

          {/* The streamer's own templates */}
          <Card
            title={t("brand.myTemplates")}
            hint={t("brand.myTemplatesHint")}
            action={
              <Link to="/modeles/nouveau?back=/chaine" className="btn btn-glass btn-sm">
                <Plus className="w-3.5 h-3.5" /> {t("brand.createTemplate")}
              </Link>
            }
          >
            {kit.templates.length === 0 ? (
              <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{t("brand.noTemplates")}</p>
            ) : (
              <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                {kit.templates.map((tpl) => (
                  <Link
                    key={tpl.id}
                    to={`/modeles/${tpl.id}?back=/chaine`}
                    className="flex-none w-[84px] flex flex-col items-center gap-1.5 group/tpl"
                  >
                    <TemplateSketch
                      layers={sketchContext ? buildTemplate(tpl.base, sketchContext, tpl.look) : []}
                      frameUrl={frame(480)}
                      width={72}
                      sample={[]}
                      className="rounded-[10px] border border-white/10 transition-transform group-hover/tpl:-translate-y-0.5"
                    />
                    <span className="w-full text-center text-[12px] font-[550] text-white truncate">{tpl.name}</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Live preview of the brand kit */}
        <aside className="glass rounded-[20px] p-[18px] flex-[0_1_330px] min-w-0 lg:sticky lg:top-[96px]">
          <div className="flex items-center justify-between gap-2.5">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{t("brand.preview")}</h2>
            <span className="text-[12.5px] text-ink-3">{t("brand.previewTemplate")}</span>
          </div>
          <SignaturePreview
            className="mt-3.5 w-full rounded-[14px] border border-white/10 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.9)]"
            frameUrl={frame(1280)}
            facecam={kit.facecam}
            colors={kit.colors}
            avatarUrl={channel?.avatar_url ?? null}
            login={channel?.login ?? kit.twitch_login}
            lines={subtitle.lines}
            highlight={subtitle.highlight}
            subtitleStyle={kit.subtitles.style}
            showWidget={kit.widget.enabled}
          />
          {!frame(1280) && latest !== undefined && <p className="mt-3 text-[12.5px] text-ink-3">{t("brand.previewNeedsAnalysis")}</p>}
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">{t("brand.camEveryLive")}</p>
        </aside>
      </section>
    </div>
  );
}
