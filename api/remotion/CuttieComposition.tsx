import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import { evaluateAnimations, resolveKeyframes } from "./animations";
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

function AnimatedLayerWrapper({ layer, kfBorderRadius, kfBlur, children }: { layer: Layer; kfBorderRadius: number; kfBlur: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const duration = durationInFrames / fps;

  const animResult = evaluateAnimations(layer, currentTime, duration);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        opacity: animResult.opacity,
        transform: animResult.transform || undefined,
        borderRadius: !layer.shape && kfBorderRadius > 0 ? kfBorderRadius : undefined,
        overflow: !layer.shape && kfBorderRadius > 0 ? "hidden" : undefined,
        filter: kfBlur > 0 ? `blur(${kfBlur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

function ResolvedLayer({ layer }: { layer: Layer }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const kf = resolveKeyframes(layer.keyframes, currentTime);
  const x = kf.x ?? layer.transform.x;
  const y = kf.y ?? layer.transform.y;
  const w = kf.width ?? layer.transform.width;
  const h = kf.height ?? layer.transform.height;
  const rotation = kf.rotation ?? (layer.transform.rotation ?? 0);
  const opacity = kf.opacity ?? layer.style.opacity;
  const borderRadius = kf.borderRadius ?? layer.style.borderRadius;
  const blur = kf.blur ?? layer.style.blur;
  const kfScale = kf.scale ?? 1;

  const transformParts: string[] = [];
  if (rotation) transformParts.push(`rotate(${rotation}deg)`);
  if (kfScale !== 1) transformParts.push(`scale(${kfScale})`);

  // Override layer style/transform with resolved values for the animation wrapper
  const resolvedLayer: Layer = {
    ...layer,
    style: { ...layer.style, opacity },
  };

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        transform: transformParts.length > 0 ? transformParts.join(" ") : undefined,
        transformOrigin: "center center",
      }}
    >
      <AnimatedLayerWrapper layer={resolvedLayer} kfBorderRadius={borderRadius} kfBlur={blur}>
        <LayerContent layer={layer} />
      </AnimatedLayerWrapper>
    </div>
  );
}

export const CuttieComposition: React.FC<CuttieCompositionProps> = ({ layers }) => {
  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <AbsoluteFill style={{ background: "black", width: 1080, height: 1920 }}>
      {visibleLayers.map((layer) => (
        <ResolvedLayer key={layer.id} layer={layer} />
      ))}
    </AbsoluteFill>
  );
};
