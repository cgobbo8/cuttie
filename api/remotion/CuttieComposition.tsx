import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import { evaluateAnimations } from "./animations";
import VideoLayer from "./layers/VideoLayer";
import SubtitleLayer from "./layers/SubtitleLayer";
import ChatLayer from "./layers/ChatLayer";
import AssetLayer from "./layers/AssetLayer";
import ShapeLayer from "./layers/ShapeLayer";
import TextLayer from "./layers/TextLayer";

export interface CuttieCompositionProps {
  layers: Layer[];
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case "gameplay":
    case "facecam":
      return <VideoLayer layer={layer} />;
    case "subtitles": return <SubtitleLayer layer={layer} />;
    case "chat":      return <ChatLayer layer={layer} />;
    case "shape":     return <ShapeLayer layer={layer} />;
    case "asset":     return <AssetLayer layer={layer} />;
    case "text":      return <TextLayer layer={layer} />;
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

export const CuttieComposition: React.FC<CuttieCompositionProps> = ({ layers }) => {
  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <AbsoluteFill style={{ background: "black", width: 1080, height: 1920 }}>
      {visibleLayers.map((layer) => (
        <div
          key={layer.id}
          style={{
            position: "absolute",
            left: layer.transform.x,
            top: layer.transform.y,
            width: layer.transform.width,
            height: layer.transform.height,
            transform: layer.transform.rotation ? `rotate(${layer.transform.rotation}deg)` : undefined,
            transformOrigin: "center center",
          }}
        >
          <AnimatedLayerWrapper layer={layer}>
            <LayerContent layer={layer} />
          </AnimatedLayerWrapper>
        </div>
      ))}
    </AbsoluteFill>
  );
};
