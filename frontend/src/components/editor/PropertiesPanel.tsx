import { useTranslation } from "react-i18next";
import { Crop, Diamond } from "lucide-react";
import { HintBadge } from "../ui/Tooltip";
import type { Layer, LayerStyle, ShapeData, SubtitleData, ChatData, TextData, AssetData } from "../../lib/editorTypes";
import { SUBTITLE_FONTS, TEXT_FONTS, BOX_SHADOW_PRESETS } from "../../lib/editorTypes";
import { hasKeyframeAt } from "../../lib/animations";

const CANVAS_W = 1080;
const CANVAS_H = 1920;

interface Props {
  layer: Layer;
  onStyleChange: (id: string, patch: Partial<LayerStyle>) => void;
  onSubtitleChange: (id: string, patch: Partial<SubtitleData>) => void;
  onShapeChange: (id: string, patch: Partial<ShapeData>) => void;
  onChatChange: (id: string, patch: Partial<ChatData>) => void;
  onAssetChange?: (id: string, patch: Partial<AssetData>) => void;
  onTextChange?: (id: string, patch: Partial<TextData>) => void;
  onTransformChange: (id: string, patch: Partial<Layer["transform"]>) => void;
  onCommit: () => void;
  onStartCrop?: (id: string) => void;
  currentTime?: number;
  onToggleKeyframe?: (layerId: string) => void;
}

function KeyframeButton({
  hasKeyframe,
  onClick,
}: {
  hasKeyframe: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-5 h-5 flex items-center justify-center shrink-0 transition-colors ${
        hasKeyframe
          ? "text-yellow-400 hover:text-yellow-300"
          : "text-zinc-600 hover:text-zinc-400"
      }`}
      title={hasKeyframe ? "Remove keyframe" : "Add keyframe"}
    >
      <Diamond className="w-3.5 h-3.5" fill={hasKeyframe ? "currentColor" : "none"} />
    </button>
  );
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
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
  onCommit: () => void;
  suffix?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
            {label}
          </span>
          {suffix}
        </div>
        <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
          {unit === "%" ? `${Math.round(value * 100)}%` : unit === "s" ? `${value.toFixed(1)}s` : unit === "°" ? `${value}°` : `${value}${unit}`}
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
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
          [&::-webkit-slider-thumb]:hover:bg-zinc-200 [&::-webkit-slider-thumb]:transition-colors"
      />
    </div>
  );
}

export default function PropertiesPanel({ layer, onStyleChange, onSubtitleChange, onShapeChange, onChatChange, onAssetChange, onTextChange, onTransformChange, onCommit, onStartCrop, currentTime = 0, onToggleKeyframe }: Props) {
  const { t } = useTranslation();
  const { style, transform, subtitle, shape, chat, text, asset } = layer;

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
          {t("editor.properties")}
        </h4>
        {onToggleKeyframe && (
          <KeyframeButton
            hasKeyframe={hasKeyframeAt(layer.keyframes, currentTime)}
            onClick={() => onToggleKeyframe(layer.id)}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-4">
        {/* Layer info */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
            {t("editor.layer")}
          </span>
          <span className="text-xs text-zinc-300 truncate">{layer.name}</span>
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Transform info */}
        <div className="grid grid-cols-2 gap-2">
          {(["x", "y", "width", "height"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[10px] text-zinc-600 uppercase">
                {k === "width" ? "W" : k === "height" ? "H" : k.toUpperCase()}
              </span>
              <input
                type="number"
                value={Math.round(layer.transform[k])}
                onChange={(e) => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v)) onTransformChange(layer.id, { [k]: v });
                }}
                onFocus={onCommit}
                className="w-full text-[10px] text-zinc-400 font-mono tabular-nums bg-transparent border-b border-transparent hover:border-white/[0.1] focus:border-white/[0.2] outline-none py-0.5 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          ))}
        </div>

        {/* Center buttons */}
        <div className="flex gap-2">
          <button
            onClick={centerX}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            {t("editor.centerX")}
          </button>
          <button
            onClick={centerY}
            className="flex-1 text-[10px] px-2 py-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-400 hover:text-zinc-200 transition-colors font-medium"
          >
            {t("editor.centerY")}
          </button>
        </div>

        {/* Crop button (facecam only) */}
        {layer.type === "facecam" && layer.video?.crop && onStartCrop && (
          <button
            onClick={() => onStartCrop(layer.id)}
            className="w-full text-[10px] px-2 py-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-zinc-200 hover:text-zinc-100 transition-colors font-medium flex items-center justify-center gap-1.5"
          >
            <Crop className="w-3.5 h-3.5" />
            {t("editor.cropSource")}
          </button>
        )}

        {/* GIF options (asset layers with .gif source) */}
        {asset && onAssetChange && asset.src.toLowerCase().endsWith(".gif") && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium flex items-center gap-1">
                {t("editor.loopGif")}
                <HintBadge tooltip={t("editor.loopGifHint")} />
              </span>
              <button
                onClick={() => {
                  onCommit();
                  onAssetChange(layer.id, { gifLoop: asset.gifLoop === false ? true : false });
                }}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors ${
                  asset.gifLoop !== false
                    ? "bg-white/[0.1] text-zinc-200"
                    : "bg-white/[0.04] text-zinc-500"
                }`}
              >
                {asset.gifLoop !== false ? t("common.yes") : t("common.no")}
              </button>
            </div>

          </>
        )}

        {/* Rotation */}
        <div className="flex items-end gap-1.5">
          <div className="flex-1">
            <Slider
              label={t("editor.rotation")}
              value={transform.rotation ?? 0}
              min={-180}
              max={180}
              step={1}
              unit="°"
              onChange={(v) => onTransformChange(layer.id, { rotation: v })}
              onCommit={onCommit}
            />
          </div>
          {(transform.rotation ?? 0) !== 0 && (
            <button
              onClick={() => {
                onCommit();
                onTransformChange(layer.id, { rotation: 0 });
              }}
              className="text-[9px] px-1.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-zinc-500 hover:text-zinc-300 transition-colors shrink-0 mb-[1px]"
              title={t("editor.resetRotation")}
            >
              0°
            </button>
          )}
        </div>

        <div className="h-px bg-white/[0.06]" />

        {/* Style sliders */}
        <Slider
          label={t("editor.opacity")}
          value={style.opacity}
          min={0}
          max={1}
          step={0.01}
          unit="%"
          onChange={(v) => onStyleChange(layer.id, { opacity: v })}
          onCommit={onCommit}
        />

        <Slider
          label={t("editor.blur")}
          value={style.blur}
          min={0}
          max={50}
          step={1}
          unit="px"
          onChange={(v) => onStyleChange(layer.id, { blur: v })}
          onCommit={onCommit}
        />

        {/* Hide generic border-radius for shapes — they have their own in the shape section */}
        {!shape && (
          <Slider
            label={t("editor.borderRadius")}
            value={style.borderRadius}
            min={0}
            max={100}
            step={1}
            unit="px"
            onChange={(v) => onStyleChange(layer.id, { borderRadius: v })}
            onCommit={onCommit}
          />
        )}

        <div className="h-px bg-white/[0.06]" />

        {/* Fade animations */}
        <Slider
          label={t("editor.fadeInSeconds")}
          value={style.fadeIn ?? 0}
          min={0}
          max={5}
          step={0.1}
          unit="s"
          onChange={(v) => onStyleChange(layer.id, { fadeIn: v })}
          onCommit={onCommit}
        />
        <Slider
          label={t("editor.fadeOutSeconds")}
          value={style.fadeOut ?? 0}
          min={0}
          max={5}
          step={0.1}
          unit="s"
          onChange={(v) => onStyleChange(layer.id, { fadeOut: v })}
          onCommit={onCommit}
        />

        {/* ─── Subtitle-specific properties ─── */}
        {subtitle && (
          <>
            <div className="h-px bg-white/[0.06]" />

            {/* Font selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.font")}
              </span>
              <select
                value={subtitle.fontFamily}
                onChange={(e) => {
                  onCommit();
                  onSubtitleChange(layer.id, { fontFamily: e.target.value });
                }}
                className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2 py-1.5 border border-white/[0.06] outline-none focus:border-white/[0.2] cursor-pointer"
              >
                {SUBTITLE_FONTS.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Font size */}
            <Slider
              label={t("editor.size")}
              value={subtitle.fontSize}
              min={30}
              max={120}
              step={1}
              unit="px"
              onChange={(v) => onSubtitleChange(layer.id, { fontSize: v })}
              onCommit={onCommit}
            />

            {/* Uppercase toggle */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.uppercase")}
              </span>
              <button
                onClick={() => {
                  onCommit();
                  onSubtitleChange(layer.id, { uppercase: !subtitle.uppercase });
                }}
                className={`text-[10px] px-2.5 py-1 rounded-md font-bold transition-colors ${
                  subtitle.uppercase
                    ? "bg-white/[0.1] text-zinc-200"
                    : "bg-white/[0.04] text-zinc-500"
                }`}
              >
                AA
              </button>
            </div>

            <div className="h-px bg-white/[0.06]" />

            {/* Color mode */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.color")}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    onCommit();
                    onSubtitleChange(layer.id, { colorMode: "auto" });
                  }}
                  className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                    subtitle.colorMode === "auto"
                      ? "bg-white/[0.1] text-zinc-200"
                      : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t("editor.auto")}
                </button>
                <button
                  onClick={() => {
                    onCommit();
                    onSubtitleChange(layer.id, { colorMode: "custom" });
                  }}
                  className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                    subtitle.colorMode === "custom"
                      ? "bg-white/[0.1] text-zinc-200"
                      : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t("editor.custom")}
                </button>
              </div>

              {/* Color preview + picker */}
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded-md border border-white/[0.1] shrink-0"
                  style={{
                    backgroundColor: subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor,
                  }}
                />
                {subtitle.colorMode === "auto" ? (
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {subtitle.autoColor}
                  </span>
                ) : (
                  <input
                    type="color"
                    value={subtitle.customColor}
                    onChange={(e) => onSubtitleChange(layer.id, { customColor: e.target.value })}
                    onFocus={onCommit}
                    className="w-full h-6 bg-transparent border-0 cursor-pointer rounded"
                  />
                )}
              </div>
            </div>
          </>
        )}

        {/* ─── Chat-specific properties ─── */}
        {chat && (
          <>
            <div className="h-px bg-white/[0.06]" />

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.font")}
              </span>
              <select
                value={chat.fontFamily}
                onChange={(e) => {
                  onCommit();
                  onChatChange(layer.id, { fontFamily: e.target.value });
                }}
                className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2 py-1.5 border border-white/[0.06] outline-none focus:border-white/[0.2] cursor-pointer"
              >
                {SUBTITLE_FONTS.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <Slider
              label={t("editor.textSize")}
              value={chat.fontSize}
              min={16}
              max={48}
              step={1}
              unit="px"
              onChange={(v) => onChatChange(layer.id, { fontSize: v })}
              onCommit={onCommit}
            />

            <Slider
              label={t("editor.visibleMessages")}
              value={chat.maxVisible}
              min={1}
              max={15}
              step={1}
              unit=""
              onChange={(v) => onChatChange(layer.id, { maxVisible: v })}
              onCommit={onCommit}
            />

            <Slider
              label={t("editor.showDuration")}
              value={chat.showDuration}
              min={1}
              max={15}
              step={0.5}
              unit="s"
              onChange={(v) => onChatChange(layer.id, { showDuration: v })}
              onCommit={onCommit}
            />

            <div className="text-[10px] text-zinc-500">
              {t("editor.messagesInClip", { count: chat.messages.length })}
            </div>
          </>
        )}

        {/* ─── Shape-specific properties ─── */}
        {shape && (
          <>
            <div className="h-px bg-white/[0.06]" />

            {/* Shape type toggle */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.shape")}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    onCommit();
                    onShapeChange(layer.id, { shapeType: "rectangle" });
                  }}
                  className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                    shape.shapeType === "rectangle"
                      ? "bg-white/[0.1] text-zinc-200"
                      : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t("editor.rectangle")}
                </button>
                <button
                  onClick={() => {
                    onCommit();
                    onShapeChange(layer.id, { shapeType: "circle" });
                  }}
                  className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                    shape.shapeType === "circle"
                      ? "bg-white/[0.1] text-zinc-200"
                      : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {t("editor.circle")}
                </button>
              </div>
            </div>

            {/* Background color + alpha */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.backgroundColor")}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={shape.backgroundColor}
                  onChange={(e) => onShapeChange(layer.id, { backgroundColor: e.target.value })}
                  onFocus={onCommit}
                  className="w-7 h-7 bg-transparent border border-white/[0.1] rounded-md cursor-pointer shrink-0"
                />
                <span className="text-[10px] text-zinc-500 font-mono">{shape.backgroundColor}</span>
              </div>
            </div>

            <Slider
              label={t("editor.backgroundOpacity")}
              value={shape.backgroundAlpha}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              onChange={(v) => onShapeChange(layer.id, { backgroundAlpha: v })}
              onCommit={onCommit}
            />

            <Slider
              label={t("editor.backdropBlur")}
              value={shape.backdropBlur}
              min={0}
              max={80}
              step={1}
              unit="px"
              onChange={(v) => onShapeChange(layer.id, { backdropBlur: v })}
              onCommit={onCommit}
            />

            {/* Border radius (only for rectangle) */}
            {shape.shapeType === "rectangle" && (
              <Slider
                label={t("editor.borderRadius")}
                value={style.borderRadius}
                min={0}
                max={200}
                step={1}
                unit="px"
                onChange={(v) => onStyleChange(layer.id, { borderRadius: v })}
                onCommit={onCommit}
              />
            )}

            {/* Box shadow presets */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.shadow")}
              </span>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(BOX_SHADOW_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    onClick={() => {
                      onCommit();
                      onShapeChange(layer.id, { boxShadowPreset: key });
                    }}
                    className={`text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                      shape.boxShadowPreset === key
                        ? "bg-white/[0.1] text-zinc-200"
                        : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {t(`shadows.${key}`, { defaultValue: preset.label })}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ─── Text-specific properties ─── */}
        {text && onTextChange && (
          <>
            <div className="h-px bg-white/[0.06]" />

            {/* Content */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.content")}
              </span>
              <textarea
                value={text.content}
                onChange={(e) => onTextChange(layer.id, { content: e.target.value })}
                onFocus={onCommit}
                rows={2}
                className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2 py-1.5 border border-white/[0.06] outline-none focus:border-white/[0.2] resize-none"
                placeholder={t("editor.textPlaceholder")}
              />
            </div>

            {/* Font selector */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.font")}
              </span>
              <select
                value={text.fontFamily}
                onChange={(e) => {
                  onCommit();
                  onTextChange(layer.id, { fontFamily: e.target.value });
                }}
                className="w-full text-xs bg-white/[0.06] text-zinc-300 rounded-md px-2 py-1.5 border border-white/[0.06] outline-none focus:border-white/[0.2] cursor-pointer"
              >
                {TEXT_FONTS.map((f) => (
                  <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Font size */}
            <Slider
              label={t("editor.size")}
              value={text.fontSize}
              min={16}
              max={200}
              step={1}
              unit="px"
              onChange={(v) => onTextChange(layer.id, { fontSize: v })}
              onCommit={onCommit}
            />

            {/* Color */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.color")}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={text.color}
                  onChange={(e) => onTextChange(layer.id, { color: e.target.value })}
                  onFocus={onCommit}
                  className="w-7 h-7 bg-transparent border border-white/[0.1] rounded-md cursor-pointer shrink-0"
                />
                <span className="text-[10px] text-zinc-500 font-mono">{text.color}</span>
              </div>
            </div>

            {/* Weight + Uppercase */}
            <div className="flex gap-1">
              <button
                onClick={() => {
                  onCommit();
                  onTextChange(layer.id, { fontWeight: text.fontWeight === "bold" ? "normal" : "bold" });
                }}
                className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-bold transition-colors ${
                  text.fontWeight === "bold"
                    ? "bg-white/[0.1] text-zinc-200"
                    : "bg-white/[0.04] text-zinc-500"
                }`}
              >
                B
              </button>
              <button
                onClick={() => {
                  onCommit();
                  onTextChange(layer.id, { uppercase: !text.uppercase });
                }}
                className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-bold transition-colors ${
                  text.uppercase
                    ? "bg-white/[0.1] text-zinc-200"
                    : "bg-white/[0.04] text-zinc-500"
                }`}
              >
                AA
              </button>
            </div>

            {/* Text align */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-medium">
                {t("editor.alignment")}
              </span>
              <div className="flex gap-1">
                {(["left", "center", "right"] as const).map((align) => (
                  <button
                    key={align}
                    onClick={() => {
                      onCommit();
                      onTextChange(layer.id, { textAlign: align });
                    }}
                    className={`flex-1 text-[10px] px-2 py-1.5 rounded-md font-medium transition-colors ${
                      text.textAlign === align
                        ? "bg-white/[0.1] text-zinc-200"
                        : "bg-white/[0.04] text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    {align === "left" ? t("editor.alignLeft") : align === "center" ? t("editor.alignCenter") : t("editor.alignRight")}
                  </button>
                ))}
              </div>
            </div>

            {/* Line height */}
            <Slider
              label={t("editor.lineHeight")}
              value={text.lineHeight}
              min={0.8}
              max={2.5}
              step={0.05}
              unit=""
              onChange={(v) => onTextChange(layer.id, { lineHeight: v })}
              onCommit={onCommit}
            />
          </>
        )}
      </div>
    </div>
  );
}
