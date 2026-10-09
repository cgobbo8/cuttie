import type { CSSProperties } from "react";
import { evaluateAnimations } from "../../lib/animations";
import { BOX_SHADOW_PRESETS, type Layer } from "../../lib/editorTypes";
import ChannelPill from "../editor/widgets/ChannelPill";
import { kitWidget } from "../editor/widgets/kit";

interface Props {
  layers: Layer[];
  /** Still frame of the clip, stands in for the video layers */
  frameUrl: string | null;
  /** Rendered width in px (the 1080x1920 canvas is scaled down) */
  width: number;
  /** A few words to show in the subtitle layer */
  sample: string[];
  /** Clip time to show (layers not on screen then are left out); unset: every layer */
  at?: number;
  className?: string;
}

/** Stands in for the chat of a clip without messages */
const SAMPLE_CHAT = [
  { author: "viewer42", text: "LUL" },
  { author: "chat_fan", text: "GG" },
];
const SAMPLE_AUTHOR_COLORS = ["#00CED1", "#FFD700"];

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Cheap still of a template: same layers as the render, a frame instead of the video */
export default function TemplateSketch({ layers, frameUrl, width, sample, at, className = "" }: Props) {
  const k = width / 1080;

  const content = (layer: Layer) => {
    const t = layer.transform;
    if (layer.video?.background && frameUrl) {
      return <img src={frameUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(40px)", transform: "scale(1.15)" }} />;
    }
    if ((layer.type === "gameplay" || layer.type === "facecam") && layer.video && frameUrl) {
      const crop = layer.video.crop ?? { x: 0, y: 0, w: layer.video.nativeWidth ?? 1920, h: layer.video.nativeHeight ?? 1080 };
      const sx = t.width / crop.w;
      const sy = t.height / crop.h;
      const style: CSSProperties = {
        position: "absolute",
        maxWidth: "none",
        width: (layer.video.nativeWidth ?? 1920) * sx,
        height: (layer.video.nativeHeight ?? 1080) * sy,
        left: -crop.x * sx,
        top: -crop.y * sy,
      };
      return <img src={frameUrl} alt="" draggable={false} style={style} />;
    }
    if (layer.type === "shape" && layer.shape) {
      const shadow = BOX_SHADOW_PRESETS[layer.shape.boxShadowPreset]?.value;
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: rgba(layer.shape.backgroundColor, layer.shape.backgroundAlpha),
            borderRadius: layer.shape.shapeType === "circle" ? "50%" : layer.style.borderRadius,
            boxShadow: shadow && shadow !== "none" ? shadow : undefined,
          }}
        />
      );
    }
    if (layer.type === "subtitles" && layer.subtitle) {
      const sub = layer.subtitle;
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          <p
            style={{
              margin: 0,
              fontFamily: `"${sub.fontFamily}", sans-serif`,
              fontSize: sub.fontSize,
              fontWeight: 700,
              lineHeight: 1.2,
              textTransform: sub.uppercase ? "uppercase" : "none",
              color: sub.boxed ? "#fff" : sub.customColor,
              WebkitTextStroke: sub.boxed || sub.noStroke ? undefined : `${Math.max(2, sub.fontSize / 25)}px black`,
              paintOrder: "stroke fill",
              ...(sub.pop ? { wordSpacing: "0.18em" } : {}),
              ...(sub.boxed
                ? { display: "inline-block", padding: `${sub.fontSize * 0.22}px ${sub.fontSize * 0.45}px`, borderRadius: sub.fontSize * 0.35, background: "rgba(0,0,0,0.58)" }
                : {}),
            }}
          >
            {sample.slice(0, sub.maxWords ?? sample.length).map((word, i, shown) => {
              // The last word is the one being said: in the karaoke color, popping
              const spoken = i === shown.length - 1;
              return (
                <span key={i}>
                  {i > 0 ? " " : ""}
                  <span
                    style={{
                      ...(sub.activeColor ? { color: spoken ? sub.activeColor : sub.restColor } : {}),
                      ...(sub.pop && spoken ? { display: "inline-block", transform: "scale(1.12)", transformOrigin: "50% 70%" } : {}),
                    }}
                  >
                    {word}
                  </span>
                </span>
              );
            })}
          </p>
        </div>
      );
    }
    if (layer.type === "chat" && layer.chat) {
      const c = layer.chat;
      const shown = (c.messages.length ? c.messages : SAMPLE_CHAT).slice(-Math.max(1, Math.min(2, c.maxVisible)));
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "flex-start", gap: c.fontSize * 0.32 }}>
          {shown.map((m, i) => (
            <div
              key={i}
              style={{
                maxWidth: "100%",
                padding: `${c.fontSize * 0.3}px ${c.fontSize * 0.55}px`,
                borderRadius: c.fontSize * 0.7,
                background: "rgba(20,20,24,0.86)",
                boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.16)",
                fontFamily: `"${c.fontFamily}", sans-serif`,
                fontSize: c.fontSize,
                lineHeight: 1.25,
              }}
            >
              <span style={{ color: SAMPLE_AUTHOR_COLORS[i % 2], fontWeight: 750 }}>{m.author}</span>
              <span style={{ color: "#FFFFFF", fontWeight: 550 }}> {m.text}</span>
            </div>
          ))}
        </div>
      );
    }
    if (layer.type === "widget" && layer.widget?.widgetId === "channel-pill") {
      return <ChannelPill props={layer.widget.props} width={t.width} height={t.height} />;
    }
    const kit = layer.type === "widget" && layer.widget ? kitWidget(layer.widget.widgetId) : undefined;
    if (kit && layer.widget) {
      // As it looks once settled, a couple of seconds after it shows up
      const at = Number(layer.widget.props.appearAt ?? 0) + 2.4;
      return <kit.Component props={layer.widget.props} width={t.width} height={t.height} currentTime={at} />;
    }
    if (layer.type === "text" && layer.text) {
      const text = layer.text;
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 12px" }}>
          <span
            style={{
              fontFamily: text.fontFamily,
              fontSize: text.fontSize,
              fontWeight: text.fontWeight,
              color: text.color,
              textAlign: text.textAlign,
              textTransform: text.uppercase ? "uppercase" : undefined,
              lineHeight: text.lineHeight,
              width: "100%",
              WebkitTextStroke: text.stroke ? `${Math.max(2, Math.round(text.fontSize / 18))}px black` : undefined,
              paintOrder: "stroke fill",
            }}
          >
            {text.content}
          </span>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={`relative overflow-hidden bg-black ${className}`} style={{ width, height: (width * 16) / 9 }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${k})`, transformOrigin: "0 0" }}>
        {layers
          .filter((l) => l.visible && (at === undefined || evaluateAnimations(l, at, Infinity).opacity > 0.05))
          .map((layer) => (
            <div
              key={layer.id}
              style={{
                position: "absolute",
                left: layer.transform.x,
                top: layer.transform.y,
                width: layer.transform.width,
                height: layer.transform.height,
                overflow: layer.type === "shape" || layer.type === "widget" ? "visible" : "hidden",
                borderRadius: layer.type !== "shape" && layer.style.borderRadius > 0 ? layer.style.borderRadius : undefined,
                filter: layer.style.blur > 0 ? `blur(${layer.style.blur}px)` : undefined,
                opacity: layer.style.opacity,
              }}
            >
              {content(layer)}
            </div>
          ))}
      </div>
    </div>
  );
}
