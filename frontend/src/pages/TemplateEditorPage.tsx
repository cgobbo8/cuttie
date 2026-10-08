import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Player } from "@remotion/player";
import { ArrowLeft, Check, Layers, Loader2, Trash2 } from "lucide-react";
import { brandFrameUrl, clipThumbUrl, getEditEnvironment, getJobStatus, type EditEnvironment, type HotPoint } from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { buildMoments } from "../lib/moments";
import { clipTemplateContext } from "../lib/templateContext";
import {
  buildTemplate,
  HAS_HOOK,
  NATIVE_LOOKS,
  newTemplateId,
  TEMPLATE_IDS,
  type CustomTemplate,
  type TemplateContext,
  type TemplateId,
  type TemplateLook,
} from "../lib/templates";
import { useLatestMoments } from "../lib/useLatestMoment";
import CuttieComposition from "../components/remotion-editor/CuttieComposition";
import TemplateSketch from "../components/montage/TemplateSketch";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

const FPS = 30;

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glass rounded-[18px] px-[18px] pt-4 pb-1.5 min-w-0">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] leading-snug text-ink-3">{hint}</p>}
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** A setting: label on the left, its choices on the right */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 border-b border-white/[0.06] last:border-0">
      <span className="text-[13.5px] text-ink-2">{label}</span>
      <div role="group" aria-label={label} className="seg">
        {options.map((o) => (
          <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The simple template editor: start from one of the 6 layouts, adjust the
 * webcam, the background, the subtitles, the widget, see it live on a real
 * clip. The layer editor stays available as the advanced mode.
 */
export default function TemplateEditorPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const { kit, channel, saveKit } = useChannel();
  const latest = useLatestMoments();

  const isNew = id === "nouveau";
  const existing: CustomTemplate | null = kit?.templates.find((tpl) => tpl.id === id) ?? null;
  const back = params.get("back") || "/chaine";

  // Real footage to try it on: the clip we came from, else the latest analysis' best moment
  const sampleJob = params.get("job") || latest?.job.job_id || null;
  const sampleClip = params.get("clip") || latest?.hotPoints[0]?.clip_filename || null;

  const [name, setName] = useState("");
  const [base, setBase] = useState<TemplateId>("signature");
  const [look, setLook] = useState<TemplateLook>(NATIVE_LOOKS.signature);
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!kit || started) return;
    if (existing) {
      setName(existing.name);
      setBase(existing.base);
      setLook(existing.look);
    } else {
      const requested = params.get("base") as TemplateId | null;
      const start = requested && TEMPLATE_IDS.includes(requested) ? requested : "signature";
      setBase(start);
      setLook(NATIVE_LOOKS[start]);
      setName(t("templateEditor.defaultName", { n: kit.templates.length + 1 }));
    }
    setStarted(true);
  }, [kit, existing, started, params, t]);

  // An unknown template id: back to where we came from
  useEffect(() => {
    if (kit && !isNew && !existing) navigate(back, { replace: true });
  }, [kit, isNew, existing, navigate, back]);

  const [env, setEnv] = useState<EditEnvironment | null>(null);
  const [sampleHp, setSampleHp] = useState<HotPoint | null>(null);
  useEffect(() => {
    if (!sampleJob || !sampleClip) return;
    getEditEnvironment(sampleJob, sampleClip).then(setEnv).catch(() => setEnv(null));
    getJobStatus(sampleJob)
      .then((job) => setSampleHp(job.hot_points?.find((hp) => hp.clip_filename === sampleClip) ?? null))
      .catch(() => setSampleHp(null));
  }, [sampleJob, sampleClip]);

  useBackdrop(sampleJob && sampleClip ? clipThumbUrl(sampleJob, sampleClip) : null);

  const moment = sampleHp ? buildMoments([sampleHp], {})[0] : null;
  const duration = moment?.duration ?? 30;
  const brandCam = kit?.facecam && typeof kit.facecam === "object" ? kit.facecam : null;

  const ctx: TemplateContext | null = useMemo(() => {
    if (!kit) return null;
    const login = channel?.login ?? kit.twitch_login;
    const avatarUrl = channel?.avatar_url ?? null;
    const hook = sampleHp?.clip_name || t("templateEditor.sampleHook");
    if (sampleJob && sampleClip) {
      return clipTemplateContext({
        jobId: sampleJob,
        filename: sampleClip,
        env: env ?? undefined,
        kit,
        login,
        avatarUrl,
        facecam: env?.cam?.rect ?? env?.facecam ?? null,
        startAt: 0,
        endAt: duration,
        hook,
      });
    }
    // No analysis yet: the live frame the webcam was confirmed on
    return {
      src: "",
      backgroundSrc: "",
      frameW: brandCam?.ref_w ?? 1920,
      frameH: brandCam?.ref_h ?? 1080,
      facecam: brandCam,
      words: [],
      startAt: 0,
      endAt: duration,
      colors: kit.colors,
      subtitleStyle: kit.subtitles.style,
      widget: kit.widget,
      login,
      avatarUrl,
      hook,
    };
  }, [kit, channel, sampleJob, sampleClip, env, sampleHp, duration, brandCam, t]);

  const layers = useMemo(() => (ctx ? buildTemplate(base, ctx, look) : []), [ctx, base, look]);
  const frameUrl = sampleJob && sampleClip ? clipThumbUrl(sampleJob, sampleClip) : kit?.facecam_frame ? brandFrameUrl : null;
  const firstWords = env?.words?.slice(0, 3).map((w) => w.word) ?? [];
  const sample = firstWords.length ? firstWords : [t("templateEditor.sampleWords")];

  const set = <K extends keyof TemplateLook>(key: K) => (value: TemplateLook[K]) => setLook((prev) => ({ ...prev, [key]: value }));
  const hasCam = base !== "sanscam";
  const hasBackground = base !== "plein";
  const hasHook = HAS_HOOK.includes(base);

  const save = async () => {
    if (!kit) return;
    const template: CustomTemplate = { id: existing?.id ?? newTemplateId(), name: name.trim() || t("templateEditor.untitled"), base, look };
    setSaving(true);
    try {
      await saveKit({ templates: [...kit.templates.filter((tpl) => tpl.id !== template.id), template] });
      toast.success(t("templateEditor.saved"));
      // Back to Montage with this template picked
      navigate(back.includes("/montage") ? `${back.split("?")[0]}?template=${template.id}` : back);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("templateEditor.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!kit || !existing) return;
    try {
      await saveKit({ templates: kit.templates.filter((tpl) => tpl.id !== existing.id) });
      toast.success(t("templateEditor.deleted"));
      navigate(back.split("?")[0]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("templateEditor.saveError"));
    }
  };

  const openAdvanced = () => {
    if (!sampleJob || !sampleClip) return;
    try {
      localStorage.setItem(`cuttie_editor_${sampleJob}_${sampleClip}`, JSON.stringify(layers));
    } catch {
      // The layer editor will start from its own template
    }
    navigate(`/${sampleJob}/edit?clip=${encodeURIComponent(sampleClip)}`);
  };

  if (!kit || !started) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const sizes = (["s", "m", "l"] as const).map((v) => ({ value: v, label: t(`templateEditor.size.${v}`) }));

  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0 flex-1">
          <Link to={back} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {back.includes("/montage") ? t("project.step.edit") : t("sidebar.channel")}
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            aria-label={t("templateEditor.name")}
            className="mt-2 block w-full max-w-[560px] bg-transparent outline-none focus-visible:outline-none border-b border-transparent focus:border-white/20 text-[32px] leading-[1.15] tracking-[-0.03em] font-[650] text-white"
          />
          <p className="mt-1.5 text-[13.5px] text-ink-2">{t("templateEditor.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {existing && (
            <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost" aria-label={t("templateEditor.delete")}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {sampleJob && sampleClip && (
            <button onClick={openAdvanced} className="btn btn-glass">
              <Layers className="w-4 h-4" /> {t("templateEditor.advanced")}
            </button>
          )}
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" strokeWidth={2.6} />} {t("templateEditor.save")}
          </button>
        </div>
      </header>

      <section className="mt-[22px] flex flex-wrap gap-[18px] items-start">
        {/* Live preview */}
        <div className="flex-[0_1_380px] min-w-0 flex flex-col items-center gap-3 lg:sticky lg:top-[96px]">
          <div className="relative w-[360px] max-w-full aspect-[9/16] rounded-[24px] overflow-hidden border border-white/[0.14] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] bg-black">
            {sampleJob && sampleClip ? (
              env ? (
                <Player
                  component={CuttieComposition}
                  inputProps={{ layers }}
                  compositionWidth={1080}
                  compositionHeight={1920}
                  fps={FPS}
                  durationInFrames={Math.max(1, Math.round(duration * FPS))}
                  controls
                  loop
                  clickToPlay
                  acknowledgeRemotionLicense
                  style={{ width: "100%", height: "100%" }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
                </div>
              )
            ) : (
              <TemplateSketch layers={layers} frameUrl={frameUrl} width={360} sample={sample} />
            )}
          </div>
          <p className="text-[12.5px] text-ink-3 text-center max-w-[340px]">
            {sampleHp ? t("templateEditor.previewOn", { clip: sampleHp.clip_name }) : t("templateEditor.previewStill")}
          </p>
        </div>

        {/* Settings */}
        <div className="flex-[1_1_520px] min-w-0 grid gap-3.5 items-start grid-cols-[repeat(auto-fill,minmax(340px,1fr))]">
          <div className="col-span-full">
            <Card title={t("templateEditor.base")} hint={t("templateEditor.baseHint")}>
              <div className="flex gap-2.5 overflow-x-auto pb-3 pt-1.5">
                {TEMPLATE_IDS.map((id) => (
                  <button
                    key={id}
                    onClick={() => setBase(id)}
                    aria-pressed={base === id}
                    className={`flex-none flex flex-col items-center gap-1.5 p-1.5 rounded-[12px] border transition-colors ${
                      base === id ? "border-accent bg-white/[0.08] shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-transparent hover:bg-white/[0.05]"
                    }`}
                  >
                    {ctx && (
                      <TemplateSketch
                        layers={buildTemplate(id, ctx, look)}
                        frameUrl={frameUrl}
                        width={64}
                        sample={[]}
                        className="rounded-[8px] border border-white/10"
                      />
                    )}
                    <span className="text-[12px] font-[550] text-white">{t(`montage.template.${id}.name`)}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {hasCam && (
            <Card title={t("templateEditor.cam")} hint={ctx?.facecam ? undefined : t("templateEditor.noCamHint")}>
              <Choice label={t("templateEditor.camSize")} value={look.camSize} options={sizes} onChange={set("camSize")} />
              <Choice
                label={t("templateEditor.camShape")}
                value={look.camShape}
                options={[
                  { value: "rounded", label: t("templateEditor.shape.rounded") },
                  { value: "circle", label: t("templateEditor.shape.circle") },
                ]}
                onChange={set("camShape")}
              />
              <Choice
                label={t("templateEditor.camBorder")}
                value={look.camBorder}
                options={[
                  { value: "white", label: t("templateEditor.border.white") },
                  { value: "accent", label: t("templateEditor.border.accent") },
                  { value: "none", label: t("templateEditor.border.none") },
                ]}
                onChange={set("camBorder")}
              />
            </Card>
          )}

          <Card title={t("templateEditor.background")} hint={hasBackground ? undefined : t("templateEditor.fullGame")}>
            {hasBackground && (
              <Choice
                label={t("templateEditor.backgroundKind")}
                value={look.background}
                options={[
                  { value: "blur", label: t("templateEditor.bg.blur") },
                  { value: "dark", label: t("templateEditor.bg.dark") },
                  { value: "brand", label: t("templateEditor.bg.brand") },
                ]}
                onChange={set("background")}
              />
            )}
          </Card>

          <Card title={t("templateEditor.subtitles")} hint={t("templateEditor.subtitlesHint")}>
            <Choice
              label={t("templateEditor.position")}
              value={look.subtitlePosition}
              options={[
                { value: "auto", label: t("templateEditor.pos.auto") },
                { value: "top", label: t("templateEditor.pos.top") },
                { value: "middle", label: t("templateEditor.pos.middle") },
                { value: "bottom", label: t("templateEditor.pos.bottom") },
              ]}
              onChange={set("subtitlePosition")}
            />
            <Choice label={t("templateEditor.textSize")} value={look.subtitleSize} options={sizes} onChange={set("subtitleSize")} />
          </Card>

          <Card title={t("templateEditor.widget")}>
            <Choice
              label={t("templateEditor.position")}
              value={look.widgetPosition}
              options={[
                { value: "auto", label: t("templateEditor.pos.auto") },
                { value: "top", label: t("templateEditor.pos.top") },
                { value: "bottom", label: t("templateEditor.pos.bottom") },
                { value: "none", label: t("templateEditor.pos.hidden") },
              ]}
              onChange={set("widgetPosition")}
            />
          </Card>

          {hasHook && (
            <Card title={t("templateEditor.hook")} hint={t("templateEditor.hookHint")}>
              <Choice
                label={t("templateEditor.hookShow")}
                value={look.hook}
                options={[
                  { value: "on", label: t("templateEditor.shown") },
                  { value: "off", label: t("templateEditor.hidden") },
                ]}
                onChange={set("hook")}
              />
            </Card>
          )}
        </div>
      </section>

      <ConfirmModal
        open={confirmDelete}
        title={t("templateEditor.delete")}
        message={t("templateEditor.deleteMessage", { name: existing?.name ?? "" })}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
