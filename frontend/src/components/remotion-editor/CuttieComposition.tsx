import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "../../lib/editorTypes";
import { evaluateAnimations } from "../../lib/animations";
import GameplayLayer from "./layers/GameplayLayer";
import FacecamLayer from "./layers/FacecamLayer";
import SubtitleLayer from "./layers/SubtitleLayer";
import ChatLayer from "./layers/ChatLayer";
import ShapeLayer from "./layers/ShapeLayer";
import AssetLayer from "./layers/AssetLayer";
import TextLayer from "./layers/TextLayer";
import WidgetLayer from "./layers/WidgetLayer";

export interface CuttieCompositionProps {
  layers: Layer[];
}

function LayerContent({ layer, audible }: { layer: Layer; audible: boolean }) {
  switch (layer.type) {
    case "gameplay":  return <GameplayLayer layer={layer} audible={audible} />;
    case "facecam":   return <FacecamLayer layer={layer} audible={audible} />;
    case "subtitles": return <SubtitleLayer layer={layer} />;
    case "chat":      return <ChatLayer layer={layer} />;
    case "shape":     return <ShapeLayer layer={layer} />;
    case "asset":     return <AssetLayer layer={layer} />;
    case "text":      return <TextLayer layer={layer} />;
    case "widget":    return <WidgetLayer layer={layer} />;
    default:          return null;
  }
}

function AnimatedLayerWrapper({ layer, children }: { layer: Layer; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const duration = durationInFrames / fps;

  const { style } = layer;
  const animResult = evaluateAnimations(layer, currentTime, duration);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        opacity: animResult.opacity,
        transform: animResult.transform || undefined,
        borderRadius: !layer.shape && style.borderRadius > 0 ? style.borderRadius : undefined,
        overflow: !layer.shape && style.borderRadius > 0 ? "hidden" : undefined,
        filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** The game and the webcam play the same clip: only one of them is heard (the blurred background is a silent copy) */
export function audibleLayerId(layers: Layer[]): string | undefined {
  return layers.find((l) => l.visible && (l.type === "gameplay" || l.type === "facecam") && l.video && !l.video.background)?.id;
}

/** A layer where the template put it; `z` stacks layers that don't sit in the same list (montages) */
export function LayerBox({ layer, audible, z }: { layer: Layer; audible: boolean; z?: number }) {
  if (!layer.visible) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: layer.transform.x,
        top: layer.transform.y,
        width: layer.transform.width,
        height: layer.transform.height,
        transform: layer.transform.rotation ? `rotate(${layer.transform.rotation}deg)` : undefined,
        transformOrigin: "center center",
        zIndex: z,
      }}
    >
      <AnimatedLayerWrapper layer={layer}>
        <LayerContent layer={layer} audible={audible} />
      </AnimatedLayerWrapper>
    </div>
  );
}

export default function CuttieComposition({ layers }: CuttieCompositionProps) {
  const audioLayerId = audibleLayerId(layers);

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {layers.map((layer) => (
        <LayerBox key={layer.id} layer={layer} audible={layer.id === audioLayerId} />
      ))}
    </AbsoluteFill>
  );
}
