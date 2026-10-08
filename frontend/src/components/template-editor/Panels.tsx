import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Circle, Eye, EyeOff, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { BrandColors } from "../../lib/api";
import { FONTS, type FontId } from "../../lib/fonts";
import {
  BRAND_COLOR_REFS,
  enterOf,
  exitOf,
  resolveColor,
  SHOW_PRESETS,
  showOf,
  timingOf,
  type ColorRef,
  type EnterId,
  type ExitId,
  type FrameStyle,
  type SpecWidget,
  type TemplateSpec,
  type WidgetShow,
  type WidgetTimingKind,
} from "../../lib/templateSpec";
import { buildTemplate, TEMPLATE_IDS, type TemplateContext, type TemplateId } from "../../lib/templates";
import { KIT_WIDGETS, type KitWidget } from "../editor/widgets/kit";
import TemplateSketch from "../montage/TemplateSketch";

/* ── Controls ─────────────────────────────────────────────── */

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="py-3 border-b border-white/[0.06] last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-[13px] text-ink-2">{label}</span>
        {children}
      </div>
      {hint && <p className="mt-1.5 text-[12px] leading-snug text-ink-3">{hint}</p>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="seg">
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ value, min, max, step = 1, onChange, onDone, label, unit = "" }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onDone?: () => void; label: string; unit?: string }) {
  return (
    <div className="flex items-center gap-2.5 w-[200px] max-w-full">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        className="flex-1 min-w-0 accent-[var(--color-accent)]"
      />
      <span className="mono w-11 text-right text-[12px] text-ink-2">
        {Math.round(value * (unit === "%" ? 100 : 1))}
        {unit}
      </span>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="switch">
      <span />
    </button>
  );
}

/** The channel's colors, white, or any color */
export function Swatches({ value, colors, onChange, label, allowNone = false }: { value: ColorRef | "none"; colors: BrandColors; onChange: (v: ColorRef | "none") => void; label: string; allowNone?: boolean }) {
  const { t } = useTranslation();
  const picker = useRef<HTMLInputElement>(null);
  const custom = value !== "none" && !(BRAND_COLOR_REFS as readonly string[]).includes(value);
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      {allowNone && (
        <button
          onClick={() => onChange("none")}
          aria-pressed={value === "none"}
          title={t("templateEditor.color.none")}
          className={`w-7 h-7 rounded-full grid place-items-center border text-ink-3 ${value === "none" ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.25)]" : "border-white/20"}`}
        >
          <span className="w-4 h-px bg-current rotate-45" />
        </button>
      )}
      {BRAND_COLOR_REFS.map((ref) => (
        <button
          key={ref}
          onClick={() => onChange(ref)}
          aria-pressed={value === ref}
          title={t(`templateEditor.color.${ref}`)}
          className={`w-7 h-7 rounded-full border transition-transform hover:scale-110 ${value === ref ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.35)]" : "border-white/20"}`}
          style={{ background: resolveColor(ref, colors) }}
        />
      ))}
      <button
        onClick={() => picker.current?.click()}
        aria-pressed={custom}
        title={t("templateEditor.color.custom")}
        className={`relative w-7 h-7 rounded-full border overflow-hidden ${custom ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.35)]" : "border-white/20"}`}
        style={{ background: custom ? value : "conic-gradient(#f43f5e, #f59e0b, #84cc16, #22d3ee, #8b5cf6, #f43f5e)" }}
      >
        <input ref={picker} type="color" value={custom ? value : "#ffffff"} onChange={(e) => onChange(e.target.value.toUpperCase())} className="sr-only" tabIndex={-1} />
      </button>
    </div>
  );
}

function FontPicker({ value, onChange }: { value: FontId; onChange: (v: FontId) => void }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("templateEditor.font")} className="grid grid-cols-3 gap-1.5 w-full mt-1">
      {FONTS.map((f) => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          aria-pressed={value === f.id}
          className={`h-14 rounded-[10px] border flex flex-col items-center justify-center transition-colors ${
            value === f.id ? "border-accent bg-white/[0.08] shadow-[0_0_0_3px_var(--color-accent-soft)]" : "border-white/[0.08] hover:bg-white/[0.06]"
          }`}
        >
          <span className="text-[19px] leading-none text-white" style={{ fontFamily: `"${f.family}", sans-serif`, fontWeight: 800 }}>
            Ab
          </span>
          <span className="mt-1 text-[10.5px] text-ink-3">{f.label}</span>
        </button>
      ))}
    </div>
  );
}

function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pb-1">
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function ResetButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} title={t("templateEditor.reset")} aria-label={t("templateEditor.reset")} className="btn btn-ghost btn-icon btn-sm w-8 h-8">
      <RotateCcw className="w-3.5 h-3.5" />
    </button>
  );
}

/* ── Panels ───────────────────────────────────────────────── */

export function BackgroundPanel({
  spec,
  colors,
  onChange,
  onLayout,
  layoutCtx,
  frameUrl,
}: {
  spec: TemplateSpec;
  colors: BrandColors;
  onChange: (bg: TemplateSpec["background"], done?: boolean) => void;
  onLayout: (id: TemplateId) => void;
  layoutCtx: TemplateContext | null;
  frameUrl: string | null;
}) {
  const { t } = useTranslation();
  const bg = spec.background;
  return (
    <>
      <PanelHead title={t("templateEditor.el.background")} />
      <Row label={t("templateEditor.backgroundKind")}>
        <Seg
          label={t("templateEditor.backgroundKind")}
          value={bg.kind}
          onChange={(kind) => onChange({ ...bg, kind }, true)}
          options={[
            { value: "blur", label: t("templateEditor.bg.blur") },
            { value: "dark", label: t("templateEditor.bg.dark") },
            { value: "brand", label: t("templateEditor.bg.brand") },
            { value: "color", label: t("templateEditor.bg.color") },
          ]}
        />
      </Row>
      {bg.kind === "blur" && (
        <Row label={t("templateEditor.darken")}>
          <Slider label={t("templateEditor.darken")} value={bg.dim} min={0} max={0.8} step={0.02} unit="%" onChange={(dim) => onChange({ ...bg, dim })} onDone={() => onChange(bg, true)} />
        </Row>
      )}
      {bg.kind === "color" && (
        <Row label={t("templateEditor.color.label")}>
          <Swatches label={t("templateEditor.color.label")} value={bg.color} colors={colors} onChange={(color) => onChange({ ...bg, color: color as ColorRef }, true)} />
        </Row>
      )}
      <div className="pt-3">
        <div className="text-[13px] text-ink-2">{t("templateEditor.startOver")}</div>
        <p className="mt-0.5 text-[12px] text-ink-3">{t("templateEditor.startOverHint")}</p>
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
          {TEMPLATE_IDS.map((id) => (
            <button key={id} onClick={() => onLayout(id)} className="flex-none flex flex-col items-center gap-1 p-1 rounded-[10px] hover:bg-white/[0.06]">
              {layoutCtx && <TemplateSketch layers={buildTemplate(id, layoutCtx)} frameUrl={frameUrl} width={52} sample={[]} className="rounded-[7px] border border-white/10" />}
              <span className="text-[11px] text-ink-2">{t(`montage.template.${id}.name`)}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export function FramePanel({
  kind,
  frame,
  colors,
  visible,
  onFrame,
  onVisible,
  onRound,
  onReset,
}: {
  kind: "cam" | "game";
  frame: FrameStyle;
  colors: BrandColors;
  visible?: boolean;
  onFrame: (frame: FrameStyle, done?: boolean) => void;
  onVisible?: (visible: boolean) => void;
  onRound?: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PanelHead title={t(`templateEditor.el.${kind}`)}>
        {onVisible && (
          <button onClick={() => onVisible(!visible)} title={t(visible ? "templateEditor.hide" : "templateEditor.show")} className="btn btn-ghost btn-icon btn-sm w-8 h-8">
            {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        )}
        <ResetButton onClick={onReset} />
      </PanelHead>
      {kind === "cam" && <p className="text-[12px] leading-snug text-ink-3">{t("templateEditor.camHint")}</p>}
      <Row label={t("templateEditor.radius")}>
        <div className="flex items-center gap-2">
          <Slider label={t("templateEditor.radius")} value={frame.radius} min={0} max={400} onChange={(radius) => onFrame({ ...frame, radius })} onDone={() => onFrame(frame, true)} />
          {onRound && (
            <button onClick={onRound} title={t("templateEditor.makeRound")} className="btn btn-glass btn-icon btn-sm w-8 h-8">
              <Circle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </Row>
      <Row label={t("templateEditor.border")}>
        <Slider label={t("templateEditor.border")} value={frame.border} min={0} max={30} onChange={(border) => onFrame({ ...frame, border })} onDone={() => onFrame(frame, true)} />
      </Row>
      {frame.border > 0 && (
        <Row label={t("templateEditor.borderColor")}>
          <Swatches label={t("templateEditor.borderColor")} value={frame.borderColor} colors={colors} onChange={(borderColor) => onFrame({ ...frame, borderColor: borderColor as ColorRef }, true)} />
        </Row>
      )}
      <Row label={t("templateEditor.shadow")}>
        <Toggle label={t("templateEditor.shadow")} on={frame.shadow} onChange={(shadow) => onFrame({ ...frame, shadow }, true)} />
      </Row>
    </>
  );
}

export function SubtitlesPanel({
  value,
  colors,
  onChange,
  onReset,
}: {
  value: TemplateSpec["subtitles"];
  colors: BrandColors;
  onChange: (v: TemplateSpec["subtitles"], done?: boolean) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <PanelHead title={t("templateEditor.el.subtitles")}>
        <ResetButton onClick={onReset} />
      </PanelHead>
      <div className="py-2">
        <span className="text-[13px] text-ink-2">{t("templateEditor.font")}</span>
        <FontPicker value={value.font} onChange={(font) => onChange({ ...value, font }, true)} />
      </div>
      <Row label={t("templateEditor.textSize")}>
        <Slider label={t("templateEditor.textSize")} value={value.size} min={40} max={160} onChange={(size) => onChange({ ...value, size })} onDone={() => onChange(value, true)} />
      </Row>
      <Row label={t("templateEditor.textColor")}>
        <Swatches label={t("templateEditor.textColor")} value={value.color} colors={colors} onChange={(color) => onChange({ ...value, color: color as ColorRef }, true)} />
      </Row>
      <Row label={t("templateEditor.spoken")} hint={t("templateEditor.spokenHint")}>
        <Swatches label={t("templateEditor.spoken")} value={value.highlight} colors={colors} allowNone onChange={(highlight) => onChange({ ...value, highlight }, true)} />
      </Row>
      <Row label={t("templateEditor.uppercase")}>
        <Toggle label={t("templateEditor.uppercase")} on={value.uppercase} onChange={(uppercase) => onChange({ ...value, uppercase }, true)} />
      </Row>
      <Row label={t("templateEditor.outline")}>
        <Toggle label={t("templateEditor.outline")} on={value.stroke} onChange={(stroke) => onChange({ ...value, stroke }, true)} />
      </Row>
      <Row label={t("templateEditor.boxed")}>
        <Toggle label={t("templateEditor.boxed")} on={value.boxed} onChange={(boxed) => onChange({ ...value, boxed }, true)} />
      </Row>
      <Row label={t("templateEditor.speakers")} hint={t("templateEditor.speakersHint")}>
        <Toggle label={t("templateEditor.speakers")} on={value.speakers} onChange={(speakers) => onChange({ ...value, speakers }, true)} />
      </Row>
    </>
  );
}

export function HookPanel({ value, onChange, onReset }: { value: TemplateSpec["hook"]; onChange: (v: TemplateSpec["hook"], done?: boolean) => void; onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <PanelHead title={t("templateEditor.el.hook")}>
        <button onClick={() => onChange({ ...value, visible: !value.visible }, true)} title={t(value.visible ? "templateEditor.hide" : "templateEditor.show")} className="btn btn-ghost btn-icon btn-sm w-8 h-8">
          {value.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
        </button>
        <ResetButton onClick={onReset} />
      </PanelHead>
      <p className="text-[12px] leading-snug text-ink-3">{t("templateEditor.hookHint")}</p>
      <Row label={t("templateEditor.hookStyle")}>
        <Seg
          label={t("templateEditor.hookStyle")}
          value={value.style}
          onChange={(style) => onChange({ ...value, style, font: style === "box" ? "geist" : value.font === "geist" ? "luckiest" : value.font }, true)}
          options={[
            { value: "outline", label: t("templateEditor.hookOutline") },
            { value: "box", label: t("templateEditor.hookBox") },
          ]}
        />
      </Row>
      <div className="py-2">
        <span className="text-[13px] text-ink-2">{t("templateEditor.font")}</span>
        <FontPicker value={value.font} onChange={(font) => onChange({ ...value, font }, true)} />
      </div>
      <Row label={t("templateEditor.textSize")}>
        <Slider label={t("templateEditor.textSize")} value={value.size} min={40} max={140} onChange={(size) => onChange({ ...value, size })} onDone={() => onChange(value, true)} />
      </Row>
    </>
  );
}

/** Live mini render of a kit widget with the channel's brand */
function WidgetThumb({ widget, ctx, width }: { widget: KitWidget; ctx: TemplateContext; width: number }) {
  const { box, Component } = widget;
  const k = Math.min(width / box.w, 64 / box.h, 1);
  const props = {
    login: ctx.login ?? "streamer",
    displayName: ctx.displayName ?? ctx.login ?? "Streamer",
    avatarUrl: ctx.avatarUrl ?? "",
    accent: ctx.colors.accent,
    highlight: ctx.colors.highlight,
    dark: ctx.colors.dark,
    light: ctx.colors.light,
    followers: ctx.followers ?? 1234,
    game: ctx.game ?? "Grand Theft Auto V",
    tiktok: ctx.login ?? "",
    appearAt: 0,
    startAt: 0,
    endAt: 4,
  };
  return (
    <div className="relative overflow-hidden" style={{ width, height: 72 }}>
      {/* Centered before scaling: most widgets are bigger than the thumbnail */}
      <div className="absolute left-1/2 top-1/2" style={{ width: box.w, height: box.h, transform: `translate(-50%, -50%) scale(${k})` }}>
        <Component props={props} width={box.w} height={box.h} currentTime={2.4} />
      </div>
    </div>
  );
}

export function WidgetPicker({ ctx, onPick }: { ctx: TemplateContext; onPick: (widget: KitWidget) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <PanelHead title={t("templateEditor.addWidget")} />
      <p className="text-[12px] leading-snug text-ink-3">{t("templateEditor.addWidgetHint")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {KIT_WIDGETS.map((w) => (
          <button key={w.id} onClick={() => onPick(w)} className="rounded-[12px] border border-white/[0.08] bg-black/25 hover:bg-white/[0.06] hover:border-white/20 transition-colors p-2 text-left">
            <WidgetThumb widget={w} ctx={ctx} width={150} />
            <div className="mt-1.5 text-[12.5px] font-semibold text-white">{t(`widgets.${w.id}.name`)}</div>
            <div className="text-[11px] leading-snug text-ink-3">{t(`widgets.${w.id}.desc`)}</div>
          </button>
        ))}
      </div>
    </>
  );
}

/** Where a widget's arrival / departure lands on a clip of `duration` seconds */
function presenceTimes(show: WidgetShow, duration: number): [number, number] {
  const tIn = Math.min(duration, Math.max(0, show.inFrom === "end" ? duration - show.in : show.in));
  const tOut = show.out === null ? duration : show.outFrom === "end" ? duration - show.out : tIn + show.out;
  return [tIn, Math.min(duration, Math.max(tIn, tOut))];
}

/**
 * Bar position (0-1) of a clip time: the first and last 10 seconds, where
 * widgets come and go, take 40 % of the bar each, the middle is squeezed.
 */
function barScale(duration: number) {
  const edge = Math.min(10, duration / 3);
  const mid = Math.max(0.001, duration - 2 * edge);
  const toX = (t: number) =>
    t <= edge ? (t / edge) * 0.4 : t >= duration - edge ? 0.6 + ((t - (duration - edge)) / edge) * 0.4 : 0.4 + ((t - edge) / mid) * 0.2;
  const toT = (x: number) => (x <= 0.4 ? (x / 0.4) * edge : x >= 0.6 ? duration - edge + ((x - 0.6) / 0.4) * edge : edge + ((x - 0.4) / 0.2) * mid);
  return { toX, toT, edge };
}

/**
 * When a widget is on screen, as a bar over the clip: drag its ends. An end
 * in the first half of the clip counts from the start, in the second half
 * from the end, so the timing fits clips of any length. All the way right:
 * it stays to the very end. Arrow keys nudge a focused end by 0.1 s (Shift: 1 s).
 */
function PresenceBar({ show, duration, onChange }: { show: WidgetShow; duration: number; onChange: (show: WidgetShow, done: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const [tIn, tOut] = presenceTimes(show, duration);
  const fmt = (v: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(Math.round(v * 10) / 10);
  const round = (v: number) => Math.round(v * 10) / 10;

  const fromTimes = (a: number, b: number): WidgetShow => {
    const half = duration / 2;
    const inFrom = a < half ? "start" : "end";
    const next: WidgetShow = { in: round(inFrom === "start" ? a : duration - a), inFrom, out: null, outFrom: "end" };
    if (b < duration - 0.05) {
      if (b >= half) next.out = round(duration - b);
      else {
        next.out = round(b - a);
        next.outFrom = "in";
      }
    }
    return next;
  };

  const scale = barScale(duration);
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const v = scale.toT(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
    // Tenths of a second near the edges, half seconds in the squeezed middle
    const step = v <= scale.edge || v >= duration - scale.edge ? 10 : 2;
    return Math.min(duration, Math.round(v * step) / step);
  };

  const grab = (end: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    let last = show;
    const move = (ev: PointerEvent) => {
      const v = timeAt(ev.clientX);
      last = end === "in" ? fromTimes(Math.min(v, tOut - 0.5), tOut) : fromTimes(tIn, Math.max(v, tIn + 0.5));
      onChange(last, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      onChange(last, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (end: "in" | "out") => (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    const d = step * (e.shiftKey ? 1 : 0.1);
    onChange(end === "in" ? fromTimes(Math.max(0, Math.min(tIn + d, tOut - 0.5)), tOut) : fromTimes(tIn, Math.min(duration, Math.max(tOut + d, tIn + 0.5))), true);
  };

  const pct = (v: number) => `${scale.toX(v) * 100}%`;
  const arrive = show.inFrom === "start" ? t("templateEditor.arrivesAt", { s: fmt(show.in) }) : t("templateEditor.arrivesBefore", { s: fmt(show.in) });
  const leave =
    show.out === null
      ? t("templateEditor.staysToEnd")
      : show.outFrom === "end"
        ? t("templateEditor.leavesBefore", { s: fmt(show.out) })
        : t("templateEditor.staysFor", { s: fmt(show.out) });
  const handle = "absolute top-1/2 w-4 h-4 -ml-2 -mt-2 rounded-full bg-white border-2 border-accent shadow-[0_1px_6px_rgba(0,0,0,0.5)] cursor-ew-resize touch-none outline-none focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft)]";

  return (
    <div className="w-full mt-2">
      <div ref={track} className="relative h-7 mx-2">
        <div className="absolute inset-x-0 top-1/2 h-1.5 -mt-[3px] rounded-full bg-white/10" />
        {/* The squeezed middle of the clip */}
        <div className="absolute top-1/2 h-1.5 -mt-[3px] left-[40%] w-[20%] bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.18)_0_2px,transparent_2px_6px)]" />
        <div className="absolute top-1/2 h-1.5 -mt-[3px] rounded-full bg-accent" style={{ left: pct(tIn), width: `calc(${pct(tOut)} - ${pct(tIn)})` }} />
        <span role="slider" tabIndex={0} aria-label={t("templateEditor.arrival")} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={tIn} aria-valuetext={arrive} className={handle} style={{ left: pct(tIn) }} onPointerDown={grab("in")} onKeyDown={nudge("in")} />
        <span role="slider" tabIndex={0} aria-label={t("templateEditor.departure")} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={tOut} aria-valuetext={leave} className={handle} style={{ left: pct(tOut) }} onPointerDown={grab("out")} onKeyDown={nudge("out")} />
      </div>
      <div className="relative h-4 mx-2 text-[10.5px] text-ink-4">
        <span className="absolute left-0 -translate-x-1">{t("templateEditor.clipStart")}</span>
        <span className="absolute left-[40%] -translate-x-1/2 mono">{fmt(scale.edge)} s</span>
        <span className="absolute left-[60%] -translate-x-1/2 mono">−{fmt(scale.edge)} s</span>
        <span className="absolute right-0 translate-x-1">{t("templateEditor.clipEnd")}</span>
      </div>
      <p className="mt-1.5 text-[12.5px] text-white">
        {arrive} · {leave}
      </p>
    </div>
  );
}

const ENTER_IDS: EnterId[] = ["pop", "bounce", "elastic", "drop", "rise", "slideLeft", "slideRight", "zoom", "fade", "none"];
const EXIT_IDS: ExitId[] = ["fade", "shrink", "sink", "slideLeft", "slideRight", "none"];

function Choices<T extends string>({ value, options, onChange, label, prefix }: { value: T; options: T[]; onChange: (v: T) => void; label: string; prefix: string }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5 w-full mt-1">
      {options.map((id) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`h-8 px-2.5 rounded-[9px] border text-[12px] font-[550] transition-colors ${
            value === id ? "bg-white text-ground border-white" : "border-white/10 text-ink-2 hover:text-white hover:bg-white/[0.06]"
          }`}
        >
          {t(`${prefix}.${id}`)}
        </button>
      ))}
    </div>
  );
}

export function WidgetPanel({
  widget,
  duration,
  onChange,
  onReplay,
  onRemove,
  onReset,
}: {
  widget: SpecWidget;
  /** Length of the clip the preview runs on, seconds */
  duration: number;
  onChange: (w: SpecWidget, done?: boolean) => void;
  /** Plays its entrance in the preview */
  onReplay: () => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const kit = KIT_WIDGETS.find((k) => k.id === widget.kind);
  const name = t(`widgets.${widget.kind}.name`);
  const show = showOf(widget);
  const preset = (Object.keys(SHOW_PRESETS) as WidgetTimingKind[]).find((k) => JSON.stringify(SHOW_PRESETS[k]) === JSON.stringify(show));
  const setShow = (next: WidgetShow) => onChange({ ...widget, show: next, timing: timingOf(next) }, true);

  return (
    <>
      <PanelHead title={name}>
        <button onClick={onReplay} title={t("templateEditor.replay")} aria-label={t("templateEditor.replay")} className="btn btn-ghost btn-icon btn-sm w-8 h-8">
          <Play className="w-3.5 h-3.5" />
        </button>
        <ResetButton onClick={onReset} />
        <button onClick={onRemove} title={t("templateEditor.removeWidget")} aria-label={t("templateEditor.removeWidget")} className="btn btn-ghost btn-icon btn-sm w-8 h-8 hover:text-[#ff8a7a]">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </PanelHead>
      <p className="text-[12px] leading-snug text-ink-3">{t(`widgets.${widget.kind}.desc`)}</p>

      <Row label={t("templateEditor.when")}>
        <div role="group" aria-label={t("templateEditor.when")} className="seg">
          {(["start", "always", "end"] as const).map((k) => (
            <button key={k} aria-pressed={preset === k} onClick={() => setShow(SHOW_PRESETS[k])}>
              {t(`templateEditor.timing.${k}`)}
            </button>
          ))}
        </div>
      </Row>
      <div className="py-3 border-b border-white/[0.06]">
        <span className="text-[13px] text-ink-2">{t("templateEditor.presence")}</span>
        <PresenceBar show={show} duration={duration} onChange={(next, done) => onChange({ ...widget, show: next, timing: timingOf(next) }, done)} />
      </div>
      <div className="py-3 border-b border-white/[0.06]">
        <span className="text-[13px] text-ink-2">{t("templateEditor.enter")}</span>
        <Choices label={t("templateEditor.enter")} prefix="templateEditor.enters" value={enterOf(widget)} options={ENTER_IDS} onChange={(enter) => onChange({ ...widget, enter }, true)} />
      </div>
      {show.out !== null && (
        <div className="py-3 border-b border-white/[0.06]">
          <span className="text-[13px] text-ink-2">{t("templateEditor.exit")}</span>
          <Choices label={t("templateEditor.exit")} prefix="templateEditor.exits" value={exitOf(widget)} options={EXIT_IDS} onChange={(exit) => onChange({ ...widget, exit }, true)} />
        </div>
      )}
      {kit?.fields.map((field) =>
        field === "shape" ? (
          <Row key={field} label={t("templateEditor.field.shape")}>
            <Seg
              label={t("templateEditor.field.shape")}
              value={(widget.fields.shape as "squircle" | "round") || "squircle"}
              onChange={(shape) => onChange({ ...widget, fields: { ...widget.fields, shape } }, true)}
              options={[
                { value: "squircle", label: t("templateEditor.shape.rounded") },
                { value: "round", label: t("templateEditor.shape.circle") },
              ]}
            />
          </Row>
        ) : (
          <Row key={field} label={t(`templateEditor.field.${field}`)}>
            <input
              value={widget.fields[field] ?? ""}
              maxLength={60}
              placeholder={t(`templateEditor.fieldPlaceholder.${field}`)}
              onChange={(e) => onChange({ ...widget, fields: { ...widget.fields, [field]: e.target.value } })}
              onBlur={() => onChange(widget, true)}
              className="h-9 w-[200px] max-w-full px-3 rounded-[9px] bg-black/30 border border-white/10 text-[13px] text-white placeholder:text-ink-4 outline-none focus-visible:outline-none focus:border-white/30"
            />
          </Row>
        ),
      )}
    </>
  );
}

export function AddWidgetButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className="btn btn-glass btn-sm">
      <Plus className="w-3.5 h-3.5" /> {t("templateEditor.addWidget")}
    </button>
  );
}

