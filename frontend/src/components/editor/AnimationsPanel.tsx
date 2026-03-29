import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, ChevronDown, Diamond } from "lucide-react";
import type { Layer, LayerAnimation, AnimationType, EasingPreset, KeyframeSnapshot } from "../../lib/editorTypes";
import { ANIMATION_DEFS, EASING_LABELS, KF_TOLERANCE } from "../../lib/animations";

interface Props {
  layer: Layer;
  clipDuration: number;
  onAddAnimation: (layerId: string, anim: LayerAnimation) => void;
  onUpdateAnimation: (layerId: string, animId: string, patch: Partial<LayerAnimation>) => void;
  onRemoveAnimation: (layerId: string, animId: string) => void;
  onCommit: () => void;
  keyframes?: KeyframeSnapshot[];
  currentTime?: number;
  onRemoveKeyframe?: (keyframeId: string) => void;
  onSeekToKeyframe?: (time: number) => void;
  onUpdateKeyframeEasing?: (keyframeId: string, easing: EasingPreset) => void;
}

let _animUid = 0;
function animUid() {
  return `anim_${++_animUid}_${Date.now().toString(36)}`;
}

const ANIMATION_GROUPS = [
  {
    labelKey: "editor.entrance",
    items: (Object.entries(ANIMATION_DEFS) as [AnimationType, typeof ANIMATION_DEFS[AnimationType]][])
      .filter(([, d]) => d.category === "in"),
  },
  {
    labelKey: "editor.exit",
    items: (Object.entries(ANIMATION_DEFS) as [AnimationType, typeof ANIMATION_DEFS[AnimationType]][])
      .filter(([, d]) => d.category === "out"),
  },
];

const EASING_OPTIONS = Object.entries(EASING_LABELS) as [EasingPreset, string][];

/* ── Duration input with unit selector ─────────────────── */

function DurationInput({
  value, onChange, onCommit,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  const [unit, setUnit] = useState<"s" | "ms">("s");
  const displayValue = unit === "ms" ? Math.round(value * 1000) : parseFloat(value.toFixed(2));

  const handleChange = (raw: string) => {
    const n = parseFloat(raw);
    if (isNaN(n) || n < 0) return;
    const seconds = unit === "ms" ? n / 1000 : n;
    onChange(Math.max(0.01, seconds));
  };

  return (
    <div className="flex items-center flex-1 min-w-0">
      <input
        type="number"
        min={unit === "ms" ? 10 : 0.01}
        step={unit === "ms" ? 50 : 0.05}
        value={displayValue}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={onCommit}
        className="w-0 flex-1 min-w-0 text-[10px] bg-white/[0.06] text-zinc-300 rounded-l px-1.5 py-1 border border-white/[0.06] border-r-0 outline-none focus:border-white/[0.2] font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as "s" | "ms")}
        className="shrink-0 text-[10px] bg-white/[0.06] text-zinc-400 rounded-r px-1 py-1 border border-white/[0.06] outline-none appearance-none cursor-pointer w-7 text-center"
      >
        <option value="s">s</option>
        <option value="ms">ms</option>
      </select>
    </div>
  );
}

export default function AnimationsPanel({
  layer, clipDuration, onAddAnimation, onUpdateAnimation, onRemoveAnimation, onCommit,
  keyframes, currentTime = 0, onRemoveKeyframe, onSeekToKeyframe, onUpdateKeyframeEasing,
}: Props) {
  const { t } = useTranslation();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const anims = layer.animations ?? [];
  const kfs = keyframes ?? [];

  const handleAdd = useCallback((type: AnimationType) => {
    const def = ANIMATION_DEFS[type];
    const time = def.category === "out" ? Math.max(0, clipDuration - 1) : 0;
    onAddAnimation(layer.id, {
      id: animUid(),
      type,
      time,
      duration: 0.5,
      easing: def.category === "in" ? "easeOut" : "easeIn",
    });
    setAddMenuOpen(false);
  }, [layer.id, clipDuration, onAddAnimation]);

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06]">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          {t("editor.animations")}
        </h4>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ── Keyframes section ── */}
        {kfs.length > 0 && (
          <div className="border-b border-white/[0.06]">
            <div className="px-3 py-2 flex items-center gap-1.5">
              <Diamond className="w-3 h-3 text-yellow-400" />
              <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest">
                Keyframes
              </span>
              <span className="text-[9px] text-zinc-600 ml-auto">{kfs.length}</span>
            </div>
            {kfs.map((kf, idx) => {
              const isActive = Math.abs(kf.time - currentTime) < KF_TOLERANCE;
              const isLast = idx === kfs.length - 1;
              return (
                <div key={kf.id}>
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                      isActive ? "bg-yellow-500/10" : "hover:bg-white/[0.03]"
                    }`}
                    onClick={() => onSeekToKeyframe?.(kf.time)}
                  >
                    <Diamond className={`w-3 h-3 shrink-0 ${isActive ? "text-yellow-400" : "text-zinc-600"}`} fill="currentColor" />
                    <span className={`text-[11px] font-mono tabular-nums ${isActive ? "text-yellow-300" : "text-zinc-400"}`}>
                      {kf.time.toFixed(2)}s
                    </span>
                    <span className="text-[9px] text-zinc-600 truncate ml-auto mr-1">
                      {Math.round(kf.x)},{Math.round(kf.y)} · {Math.round(kf.width)}×{Math.round(kf.height)}
                    </span>
                    {onRemoveKeyframe && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemoveKeyframe(kf.id); }}
                        className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {/* Easing picker between this keyframe and the next */}
                  {!isLast && onUpdateKeyframeEasing && (
                    <div className="flex items-center gap-1.5 px-3 py-1 ml-3 border-l border-dashed border-zinc-700">
                      <span className="text-[9px] text-zinc-600 shrink-0">easing</span>
                      <div className="relative flex-1">
                        <select
                          value={kf.easing}
                          onChange={(e) => onUpdateKeyframeEasing(kf.id, e.target.value as EasingPreset)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-[10px] bg-white/[0.04] text-zinc-400 rounded px-1.5 py-0.5 border border-white/[0.06] outline-none appearance-none cursor-pointer hover:bg-white/[0.08] transition-colors"
                        >
                          {EASING_OPTIONS.map(([key, label]) => (
                            <option key={key} value={key}>{t(`easings.${key}`, { defaultValue: label })}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 text-zinc-600 pointer-events-none" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Animations section ── */}
        {anims.length === 0 && kfs.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] text-zinc-600">{t("editor.noAnimations")}</p>
            <p className="text-[10px] text-zinc-700 mt-1">{t("editor.noAnimationsHint")}</p>
          </div>
        )}

        {anims.map((anim) => {
          const def = ANIMATION_DEFS[anim.type];
          return (
            <div key={anim.id} className="px-3 py-2.5 border-b border-white/[0.06]">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                    def.category === "in"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-orange-500/10 text-orange-400"
                  }`}>
                    {def.category === "in" ? t("editor.in") : t("editor.out")}
                  </span>
                  <span className="text-[11px] text-zinc-300 font-medium">{t(`animations.${anim.type}`, { defaultValue: def.label })}</span>
                </div>
                <button
                  onClick={() => onRemoveAnimation(layer.id, anim.id)}
                  className="w-5 h-5 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Time (Début for in, Fin for out) */}
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-[10px] text-zinc-500 w-12 shrink-0">
                  {def.category === "out" ? t("editor.end") : t("editor.start")}
                </label>
                <input
                  type="range"
                  min={def.category === "out" ? anim.duration : 0}
                  max={clipDuration}
                  step={0.1}
                  value={def.category === "out" ? anim.time + anim.duration : anim.time}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    onUpdateAnimation(layer.id, anim.id, {
                      time: def.category === "out" ? v - anim.duration : v,
                    });
                  }}
                  onMouseDown={onCommit}
                  className="flex-1 accent-white h-1"
                />
                <span className="text-[10px] text-zinc-400 font-mono w-8 text-right">
                  {def.category === "out"
                    ? (anim.time + anim.duration).toFixed(1)
                    : anim.time.toFixed(1)}s
                </span>
              </div>

              {/* Duration — number input + unit selector */}
              <div className="flex items-center gap-2 mb-1.5 min-w-0">
                <label className="text-[10px] text-zinc-500 w-12 shrink-0">{t("editor.duration")}</label>
                <DurationInput
                  value={anim.duration}
                  onChange={(newDur) => {
                    if (def.category === "out") {
                      const endTime = anim.time + anim.duration;
                      onUpdateAnimation(layer.id, anim.id, {
                        duration: newDur,
                        time: Math.max(0, endTime - newDur),
                      });
                    } else {
                      onUpdateAnimation(layer.id, anim.id, { duration: newDur });
                    }
                  }}
                  onCommit={onCommit}
                />
              </div>

              {/* Easing */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-zinc-500 w-12 shrink-0">{t("editor.easing")}</label>
                <div className="relative flex-1">
                  <select
                    value={anim.easing}
                    onChange={(e) => onUpdateAnimation(layer.id, anim.id, { easing: e.target.value as EasingPreset })}
                    className="w-full text-[10px] bg-white/[0.05] text-zinc-300 rounded px-2 py-1 border border-white/[0.06] outline-none appearance-none cursor-pointer"
                  >
                    {EASING_OPTIONS.map(([key, label]) => (
                      <option key={key} value={key}>{t(`easings.${key}`, { defaultValue: label })}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add button */}
      <div className="shrink-0 border-t border-white/[0.06] p-2 relative">
        <button
          onClick={() => setAddMenuOpen((v) => !v)}
          className="w-full text-xs px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors flex items-center justify-center gap-2 font-medium"
        >
          <Plus className="w-4 h-4" />
          {t("editor.addAnimation")}
        </button>

        {addMenuOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-1 bg-zinc-900 border border-white/[0.08] rounded-lg shadow-xl overflow-hidden z-50 max-h-60 overflow-y-auto">
            {ANIMATION_GROUPS.map((group) => (
              <div key={group.labelKey}>
                <div className="px-3 py-1.5 text-[9px] font-semibold text-zinc-500 uppercase tracking-widest bg-white/[0.02]">
                  {t(group.labelKey)}
                </div>
                {group.items.map(([type, def]) => (
                  <button
                    key={type}
                    onClick={() => handleAdd(type)}
                    className="w-full text-left text-xs px-3 py-2 hover:bg-white/[0.05] text-zinc-300 hover:text-white transition-colors"
                  >
                    {t(`animations.${type}`, { defaultValue: def.label })}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
