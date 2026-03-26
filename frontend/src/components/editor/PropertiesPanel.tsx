import type { Layer, LayerStyle } from "../../lib/editorTypes";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props {
  layer: Layer;
  onStyleChange: (id: string, patch: Partial<LayerStyle>) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
  onCommit: () => void;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
          {label}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
          {unit === "%" ? `${Math.round(value * 100)}%` : `${value}${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onCommit}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-white/[0.06] rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400
          [&::-webkit-slider-thumb]:hover:bg-purple-300 [&::-webkit-slider-thumb]:transition-colors"
      />
    </div>
  );
}

export default function PropertiesPanel({ layer, onStyleChange, onTransformChange, onCommit }: Props) {
  const { style, transform } = layer;

  const centerX = () => {
    onCommit();
    onTransformChange(layer.id, { x: Math.round((CANVAS_W - transform.width) / 2) });
  };
  const centerY = () => {
    onCommit();
    onTransformChange(layer.id, { y: Math.round((CANVAS_H - transform.height) / 2) });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <h4 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">
          Proprietes
        </h4>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {/* Layer info */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
            Calque
          </span>
          <span className="text-xs text-zinc-300 truncate">{layer.name}</span>
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Transform info */}
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-600 uppercase">{k === "width" ? "W" : k === "height" ? "H" : k.toUpperCase()}</span>
              <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
                {Math.round(layer.transform[k])}
              </span>
            </div>
          ))}
        </div>

        {/* Center buttons */}
        <div className="flex gap-2">
          <button
            onClick={centerX}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            Centrer X
          </button>
          <button
            onClick={centerY}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            Centrer Y
          </button>
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Style sliders */}
        <Slider
          label="Opacite"
          value={style.opacity}
          min={0}
          max={1}
          step={0.01}
          unit="%"
          onChange={(v) => onStyleChange(layer.id, { opacity: v })}
          onCommit={onCommit}
        />

        <Slider
          label="Flou"
          value={style.blur}
          min={0}
          max={50}
          step={1}
          unit="px"
          onChange={(v) => onStyleChange(layer.id, { blur: v })}
          onCommit={onCommit}
        />

        <Slider
          label="Arrondi"
          value={style.borderRadius}
          min={0}
          max={100}
          step={1}
          unit="px"
          onChange={(v) => onStyleChange(layer.id, { borderRadius: v })}
          onCommit={onCommit}
        />
      </div>
    </div>
  );
}
