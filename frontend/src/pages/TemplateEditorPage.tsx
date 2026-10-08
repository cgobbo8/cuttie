import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { PlayerRef } from "@remotion/player";
import { AlertTriangle, ArrowLeft, Check, Layers, Loader2, Pause, Play, Redo2, ScanLine, Star, Trash2, Undo2, Volume2, VolumeX } from "lucide-react";
import { brandFrameUrl, clipThumbUrl, getEditEnvironment, getJobStatus, type EditEnvironment, type HotPoint } from "../lib/api";
import { useBackdrop } from "../lib/BackdropContext";
import { useChannel } from "../lib/ChannelContext";
import { buildMoments } from "../lib/moments";
import { clipTemplateContext } from "../lib/templateContext";
import { customTemplates } from "../lib/templateKeys";
import {
  buildFromSpec,
  coveredBy,
  dragBox,
  defaultShow,
  newWidgetId,
  orderOf,
  placeWidget,
  restack,
  widgetWindow,
  specFromLayout,
  type Box,
  type SpecWidget,
  type TemplateSpec,
} from "../lib/templateSpec";
import { TEMPLATE_IDS, type TemplateContext, type TemplateId } from "../lib/templates";
import { useLatestMoments } from "../lib/useLatestMoment";
import { kitWidget, type KitWidget } from "../components/editor/widgets/kit";
import EditorCanvas, { type CanvasElement } from "../components/template-editor/EditorCanvas";
import LayerList from "../components/template-editor/LayerList";
import {
  AddWidgetButton,
  BackgroundPanel,
  FramePanel,
  HookPanel,
  SubtitlesPanel,
  WidgetPanel,
  WidgetPicker,
} from "../components/template-editor/Panels";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../components/Toast";

const FPS = 30;

/** Read / replace the box of an element ("game", "cam", "subtitles", "hook", "widget:<id>") */
function boxOf(spec: TemplateSpec, key: string): Box | null {
  if (key === "game") return spec.game.box;
  if (key === "cam") return spec.cam.box;
  if (key === "subtitles") return spec.subtitles.box;
  if (key === "hook") return spec.hook.box;
  if (key.startsWith("widget:")) return spec.widgets.find((w) => `widget:${w.id}` === key)?.box ?? null;
  return null;
}

function withBox(spec: TemplateSpec, key: string, box: Box): TemplateSpec {
  if (key === "game") return { ...spec, game: { ...spec.game, box } };
  if (key === "cam") return { ...spec, cam: { ...spec.cam, box } };
  if (key === "subtitles") return { ...spec, subtitles: { ...spec.subtitles, box } };
  if (key === "hook") return { ...spec, hook: { ...spec.hook, box } };
  return { ...spec, widgets: spec.widgets.map((w) => (`widget:${w.id}` === key ? { ...w, box } : w)) };
}

const isRoundCam = (spec: TemplateSpec) => spec.cam.box.w === spec.cam.box.h && spec.cam.frame.radius >= spec.cam.box.w / 2 - 1;

/**
 * The template editor: click an element of the clip (background, game, webcam,
 * subtitles, hook, widgets), move it, resize it, style it. Text and brand
 * elements are kept out of what TikTok / Shorts / Reels cover. The layer
 * editor stays available as the advanced mode.
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
  const customs = useMemo(() => customTemplates(kit), [kit]);
  const existing = customs.find((tpl) => tpl.id === id) ?? null;
  const back = params.get("back") || "/chaine";

  const sampleJob = params.get("job") || latest?.job.job_id || null;
  const sampleClip = params.get("clip") || latest?.hotPoints[0]?.clip_filename || null;

  /* ── The template being edited, with undo / redo ── */
  const [spec, setSpec] = useState<TemplateSpec | null>(null);
  const committed = useRef<TemplateSpec | null>(null);
  const past = useRef<TemplateSpec[]>([]);
  const future = useRef<TemplateSpec[]>([]);
  const [, setHistoryTick] = useState(0);

  const update = useCallback((next: TemplateSpec, done = true) => {
    setSpec(next);
    if (!done) return;
    if (committed.current && committed.current !== next) {
      past.current = [...past.current.slice(-60), committed.current];
      future.current = [];
    }
    committed.current = next;
    setHistoryTick((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous || !committed.current) return;
    future.current.push(committed.current);
    committed.current = previous;
    setSpec(previous);
    setHistoryTick((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next || !committed.current) return;
    past.current.push(committed.current);
    committed.current = next;
    setSpec(next);
    setHistoryTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!kit || spec) return;
    if (!isNew && !existing) {
      navigate(back, { replace: true });
      return;
    }
    const requested = params.get("base") as TemplateId | null;
    const start: TemplateSpec =
      existing ??
      specFromLayout(requested && TEMPLATE_IDS.includes(requested) ? requested : "signature", {
        subtitleStyle: kit.subtitles.style,
        widgetTiming: kit.widget.timing,
        name: t("templateEditor.defaultName", { n: customs.length + 1 }),
      });
    committed.current = start;
    setSpec(start);
  }, [kit, spec, isNew, existing, navigate, back, params, customs.length, t]);

  /* ── Real footage to try it on ── */
  const [env, setEnv] = useState<EditEnvironment | null>(null);
  const [sampleHp, setSampleHp] = useState<HotPoint | null>(null);
  const [game, setGame] = useState<string | null>(null);
  useEffect(() => {
    if (!sampleJob || !sampleClip) return;
    getEditEnvironment(sampleJob, sampleClip).then(setEnv).catch(() => setEnv(null));
    getJobStatus(sampleJob)
      .then((job) => {
        setSampleHp(job.hot_points?.find((hp) => hp.clip_filename === sampleClip) ?? null);
        setGame(job.vod_game ?? null);
      })
      .catch(() => setSampleHp(null));
  }, [sampleJob, sampleClip]);

  useBackdrop(sampleJob && sampleClip ? clipThumbUrl(sampleJob, sampleClip) : null);

  const moment = sampleHp ? buildMoments([sampleHp], {})[0] : null;
  const duration = moment?.duration ?? 30;
  const brandCam = kit?.facecam && typeof kit.facecam === "object" ? kit.facecam : null;

  const ctx: TemplateContext | null = useMemo(() => {
    if (!kit) return null;
    const common = {
      login: channel?.login ?? kit.twitch_login,
      avatarUrl: channel?.avatar_url ?? null,
      displayName: channel?.display_name ?? null,
      followers: channel?.followers ?? null,
      game,
      hook: sampleHp?.clip_name || t("templateEditor.sampleHook"),
    };
    if (sampleJob && sampleClip) {
      return {
        ...clipTemplateContext({
          jobId: sampleJob,
          filename: sampleClip,
          env: env ?? undefined,
          kit,
          login: common.login,
          avatarUrl: common.avatarUrl,
          facecam: env?.cam?.rect ?? env?.facecam ?? null,
          startAt: 0,
          endAt: duration,
          hook: common.hook,
        }),
        ...common,
      };
    }
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
      ...common,
    };
  }, [kit, channel, sampleJob, sampleClip, env, sampleHp, duration, brandCam, game, t]);

  const layers = useMemo(() => (spec && ctx ? buildFromSpec(spec, ctx) : []), [spec, ctx]);
  const frameUrl = sampleJob && sampleClip ? clipThumbUrl(sampleJob, sampleClip) : kit?.facecam_frame ? brandFrameUrl : null;
  const firstWords = env?.words?.slice(0, 3).map((w) => w.word) ?? [];

  /* ── Selection, panels, canvas size ── */
  const [selected, setSelected] = useState<string | null>("background");
  const [picking, setPicking] = useState(false);
  const [showZones, setShowZones] = useState(true);
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The frame and its playback bar fit the window
  const fitHeight = () => Math.max(480, Math.min(760, window.innerHeight - 330));
  const [canvasHeight, setCanvasHeight] = useState(fitHeight);
  useEffect(() => {
    const onResize = () => setCanvasHeight(fitHeight());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    if (kit && existing) setMakeDefault(kit.default_template === existing.id);
  }, [kit, existing]);

  const select = (key: string | null) => {
    setPicking(false);
    setSelected(key ?? "background");
    const widget = spec?.widgets.find((w) => `widget:${w.id}` === key);
    if (widget) reveal(widget);
  };

  const reference = spec ? specFromLayout(spec.base, { subtitleStyle: kit?.subtitles.style, widgetTiming: kit?.widget.timing }) : null;

  const labelOf = (key: string) => {
    const widget = spec?.widgets.find((w) => `widget:${w.id}` === key);
    return widget ? t(`widgets.${widget.kind}.name`) : t(`templateEditor.el.${key}`);
  };

  // Bottom to top, like the render: the top ones get the clicks
  const elements: CanvasElement[] = spec
    ? orderOf(spec).flatMap((key): CanvasElement[] => {
        if (key === "game") return [{ key, label: labelOf(key), box: spec.game.box, checkZones: false }];
        if (key === "cam") return spec.cam.visible ? [{ key, label: labelOf(key), box: spec.cam.box, keepRatio: isRoundCam(spec) }] : [];
        if (key === "subtitles") return [{ key, label: labelOf(key), box: spec.subtitles.box }];
        if (key === "hook") return spec.hook.visible ? [{ key, label: labelOf(key), box: spec.hook.box }] : [];
        const w = spec.widgets.find((x) => `widget:${x.id}` === key);
        return w ? [{ key, label: labelOf(key), box: w.box, keepRatio: w.kind === "logo" || w.kind === "corner-logo" }] : [];
      })
    : [];

  const removeWidget = useCallback(
    (key: string) => {
      if (!spec) return;
      update({ ...spec, widgets: spec.widgets.filter((w) => `widget:${w.id}` !== key), order: orderOf(spec).filter((k) => k !== key) });
      setSelected("background");
    },
    [spec, update],
  );

  const addWidget = (kitDef: KitWidget) => {
    if (!spec) return;
    const widget: SpecWidget = {
      id: newWidgetId(),
      kind: kitDef.id,
      box: placeWidget(spec, kitDef.box, kitDef.timing),
      timing: kitDef.timing,
      show: defaultShow(kitDef.id, kitDef.timing),
      fields: {},
    };
    // On top of everything
    update({ ...spec, widgets: [...spec.widgets, widget], order: [...orderOf(spec), `widget:${widget.id}`] });
    setPicking(false);
    setSelected(`widget:${widget.id}`);
    reveal(widget);
  };

  /* ── Keyboard: nudge, delete, undo / redo ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (!spec || !selected) return;
      if (e.key === "Escape") {
        setPicking(false);
        setSelected("background");
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected.startsWith("widget:")) removeWidget(selected);
        else if (selected === "cam") update({ ...spec, cam: { ...spec.cam, visible: false } });
        else if (selected === "hook") update({ ...spec, hook: { ...spec.hook, visible: false } });
        else return;
        e.preventDefault();
        setSelected("background");
        return;
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const step = arrows[e.key];
      const box = boxOf(spec, selected);
      if (step && box) {
        e.preventDefault();
        const k = e.shiftKey ? 10 : 2;
        update(withBox(spec, selected, dragBox(box, "move", step[0] * k, step[1] * k, [], { snap: false }).box));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spec, selected, undo, redo, update, removeWidget]);

  /* ── Playback ── */
  const playerRef = useRef<PlayerRef | null>(null);
  /** Paused on a moment where a widget isn't on screen: go where it shows, to see what you edit */
  function reveal(widget: SpecWidget) {
    const player = playerRef.current;
    if (!player || player.isPlaying()) return;
    const { appearAt, leaveAt } = widgetWindow(widget, 0, duration);
    const until = leaveAt ?? duration;
    const now = player.getCurrentFrame() / FPS;
    // Settled: past its entrance, before it leaves
    if (now < appearAt + 0.6 || now > until - 0.1) player.seekTo(Math.round(Math.min(appearAt + 1.2, (appearAt + until) / 2) * FPS));
  }

  /** Plays a widget's entrance (and exit when it's close by) to see the animation */
  function replay(widget: SpecWidget) {
    const player = playerRef.current;
    if (!player) return;
    const { appearAt } = widgetWindow(widget, 0, duration);
    player.seekTo(Math.max(0, Math.round((appearAt - 0.4) * FPS)));
    player.play();
  }
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [env, spec !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Save / delete / advanced mode ── */
  const save = async () => {
    if (!kit || !spec) return;
    const toSave: TemplateSpec = { ...spec, name: spec.name.trim() || t("templateEditor.untitled") };
    setSaving(true);
    try {
      await saveKit({
        templates: [...(kit.templates ?? []).filter((tpl) => tpl.id !== toSave.id), toSave],
        ...(makeDefault ? { default_template: toSave.id } : kit.default_template === toSave.id ? { default_template: null } : {}),
      });
      toast.success(t("templateEditor.saved"));
      navigate(back.includes("/montage") ? `${back.split("?")[0]}?template=${toSave.id}` : back);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("templateEditor.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!kit || !existing) return;
    try {
      await saveKit({
        templates: (kit.templates ?? []).filter((tpl) => tpl.id !== existing.id),
        ...(kit.default_template === existing.id ? { default_template: null } : {}),
      });
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

  if (!kit || !spec || !ctx || !reference) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-ink-3" />
      </div>
    );
  }

  const selectedBox = selected ? boxOf(spec, selected) : null;
  const covered = showZones && selectedBox && selected !== "game" ? coveredBy(selectedBox) : [];
  const selectedWidget = selected?.startsWith("widget:") ? spec.widgets.find((w) => `widget:${w.id}` === selected) : undefined;


  return (
    <div className="animate-fade-in">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0 flex-1">
          <Link to={back} className="btn btn-ghost btn-sm -ml-2 h-7 px-2">
            <ArrowLeft className="w-4 h-4" /> {back.includes("/montage") ? t("project.step.edit") : t("sidebar.channel")}
          </Link>
          <input
            value={spec.name}
            onChange={(e) => setSpec({ ...spec, name: e.target.value })}
            onBlur={() => update(spec)}
            maxLength={40}
            aria-label={t("templateEditor.name")}
            className="mt-2 block w-full max-w-[560px] bg-transparent outline-none focus-visible:outline-none border-b border-transparent focus:border-white/20 text-[30px] leading-[1.15] tracking-[-0.03em] font-[650] text-white"
          />
          <p className="mt-1 text-[13px] text-ink-2">{t("templateEditor.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={undo} disabled={past.current.length === 0} title={t("templateEditor.undo")} aria-label={t("templateEditor.undo")} className="btn btn-ghost btn-icon">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={redo} disabled={future.current.length === 0} title={t("templateEditor.redo")} aria-label={t("templateEditor.redo")} className="btn btn-ghost btn-icon">
            <Redo2 className="w-4 h-4" />
          </button>
          {existing && (
            <button onClick={() => setConfirmDelete(true)} title={t("templateEditor.delete")} aria-label={t("templateEditor.delete")} className="btn btn-ghost btn-icon hover:text-[#ff8a7a]">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setMakeDefault((v) => !v)}
            aria-pressed={makeDefault}
            title={t("templateEditor.makeDefaultHint")}
            className={`btn btn-sm h-10 ${makeDefault ? "btn-accent" : "btn-glass"}`}
          >
            <Star className="w-4 h-4" fill={makeDefault ? "currentColor" : "none"} /> {t("templateEditor.makeDefault")}
          </button>
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

      <section className="mt-[22px] flex flex-wrap gap-[22px] items-start">
        {/* The frame */}
        <div className="flex flex-col items-center gap-3">
          <EditorCanvas
            layers={layers}
            elements={elements}
            selected={selected}
            onSelect={select}
            onBoxChange={(key, box, done) => update(withBox(spec, key, box), done)}
            showZones={showZones}
            height={canvasHeight}
            durationInFrames={Math.max(1, Math.round(duration * FPS))}
            playerRef={playerRef}
            initialFrame={45}
            still={sampleJob && sampleClip && env ? null : { frameUrl, sample: firstWords.length ? firstWords : [t("templateEditor.sampleWords")] }}
          />
          <div className="glass flex items-center gap-1.5 p-1.5 rounded-[14px]">
            {sampleJob && sampleClip && env && (
              <>
                <button onClick={() => playerRef.current?.toggle()} aria-label={playing ? t("project.pause") : t("project.play")} className="btn btn-primary btn-icon w-9 h-9 rounded-[10px]">
                  {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 translate-x-[1px]" fill="currentColor" />}
                </button>
                <button
                  onClick={() => {
                    if (muted) playerRef.current?.unmute();
                    else playerRef.current?.mute();
                    setMuted(!muted);
                  }}
                  aria-label={muted ? t("project.unmute") : t("project.mute")}
                  className="btn btn-ghost btn-icon w-9 h-9"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </>
            )}
            <button onClick={() => setShowZones((v) => !v)} aria-pressed={showZones} className={`btn btn-sm h-9 ${showZones ? "bg-white/[0.12] text-white" : "btn-ghost"}`}>
              <ScanLine className="w-4 h-4" /> {t("templateEditor.zones")}
            </button>
          </div>
          <p className="text-[12px] text-ink-3 text-center max-w-[420px]">
            {sampleHp ? t("templateEditor.previewOn", { clip: sampleHp.clip_name }) : t("templateEditor.previewStill")} {t("templateEditor.dragHint")}
          </p>
        </div>

        {/* Settings of the selected element */}
        <aside className="flex-[1_1_380px] min-w-0 max-w-[480px] flex flex-col gap-3 lg:sticky lg:top-[96px]">
          <LayerList
            items={orderOf(spec).map((key) => ({
              key,
              label: labelOf(key),
              hidden: (key === "cam" && !spec.cam.visible) || (key === "hook" && !spec.hook.visible),
            }))}
            selected={picking ? null : selected}
            onSelect={select}
            onMove={(key, index) => update({ ...spec, order: restack(spec, key, index) })}
            action={<AddWidgetButton onClick={() => setPicking(true)} />}
          />

          {covered.length > 0 && !picking && (
            <div className="flex items-start gap-2.5 p-3 rounded-[14px] bg-[rgba(245,177,76,0.12)] border border-[rgba(245,177,76,0.35)]">
              <AlertTriangle className="w-4 h-4 text-[#F5B14C] flex-none mt-0.5" />
              <p className="text-[12.5px] leading-snug text-[#f7d9a8]">
                {t("templateEditor.covered", { zones: covered.map((z) => t(`templateEditor.coveredBy.${z}`)).join(", ") })}
              </p>
            </div>
          )}

          <div className="glass rounded-[18px] px-[18px] py-4">
            {picking ? (
              <WidgetPicker ctx={ctx} onPick={addWidget} />
            ) : selected === "game" ? (
              <FramePanel
                kind="game"
                frame={spec.game.frame}
                colors={kit.colors}
                onFrame={(frame, done) => update({ ...spec, game: { ...spec.game, frame } }, done)}
                onReset={() => update({ ...spec, game: reference.game })}
              />
            ) : selected === "cam" ? (
              <FramePanel
                kind="cam"
                frame={spec.cam.frame}
                colors={kit.colors}
                visible={spec.cam.visible}
                onVisible={(visible) => update({ ...spec, cam: { ...spec.cam, visible } })}
                onFrame={(frame, done) => update({ ...spec, cam: { ...spec.cam, frame } }, done)}
                onRound={() => {
                  const b = spec.cam.box;
                  const side = Math.min(b.w, b.h);
                  update({
                    ...spec,
                    cam: { ...spec.cam, box: { x: Math.round(b.x + (b.w - side) / 2), y: Math.round(b.y + (b.h - side) / 2), w: side, h: side }, frame: { ...spec.cam.frame, radius: side / 2 } },
                  });
                }}
                onReset={() => update({ ...spec, cam: reference.cam })}
              />
            ) : selected === "subtitles" ? (
              <SubtitlesPanel
                value={spec.subtitles}
                colors={kit.colors}
                onChange={(subtitles, done) => update({ ...spec, subtitles }, done)}
                onReset={() => update({ ...spec, subtitles: reference.subtitles })}
              />
            ) : selected === "hook" ? (
              <HookPanel
                value={spec.hook}
                // Shown again: on a free spot, not over the webcam
                onChange={(hook, done) => update({ ...spec, hook: hook.visible && !spec.hook.visible ? { ...hook, box: placeWidget(spec, hook.box, "always") } : hook }, done)}
                onReset={() => {
                  const hidden = { ...spec, hook: { ...spec.hook, visible: false } };
                  update({ ...spec, hook: { ...reference.hook, visible: true, box: placeWidget(hidden, reference.hook.box, "always") } });
                }}
              />
            ) : selectedWidget ? (
              <WidgetPanel
                widget={selectedWidget}
                duration={duration}
                onChange={(widget, done) => {
                  update({ ...spec, widgets: spec.widgets.map((w) => (w.id === widget.id ? widget : w)) }, done);
                  if (widget.enter !== selectedWidget.enter) replay(widget);
                  else if (JSON.stringify(widget.show) !== JSON.stringify(selectedWidget.show)) reveal(widget);
                }}
                onReplay={() => replay(selectedWidget)}
                onRemove={() => removeWidget(`widget:${selectedWidget.id}`)}
                onReset={() => {
                  const def = kitWidget(selectedWidget.kind);
                  const box = def ? def.box : reference.widgets[0]?.box;
                  if (box) update({ ...spec, widgets: spec.widgets.map((w) => (w.id === selectedWidget.id ? { ...w, box: { ...box } } : w)) });
                }}
              />
            ) : (
              <BackgroundPanel
                spec={spec}
                colors={kit.colors}
                onChange={(background, done) => update({ ...spec, background }, done)}
                onLayout={(layout) =>
                  update({
                    ...specFromLayout(layout, { subtitleStyle: kit.subtitles.style, widgetTiming: kit.widget.timing }),
                    id: spec.id,
                    name: spec.name,
                  })
                }
                layoutCtx={ctx}
                frameUrl={frameUrl}
              />
            )}
          </div>
        </aside>
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
