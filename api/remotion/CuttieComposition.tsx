import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "./editorTypes";
import VideoLayer from "./layers/VideoLayer";
import SubtitleLayer from "./layers/SubtitleLayer";
import ChatLayer from "./layers/ChatLayer";
import AssetLayer from "./layers/AssetLayer";
import ShapeLayer from "./layers/ShapeLayer";

export interface CuttieCompositionProps {
  layers: Layer[];
}

function layerOpacity(layer: Layer, currentTime: number, duration: number): number {
  const { opacity, fadeIn, fadeOut } = layer.style;
  let o = opacity;
  if (fadeIn > 0 && currentTime < fadeIn) o *= currentTime / fadeIn;
  if (fadeOut > 0 && currentTime > duration - fadeOut) o *= (duration - currentTime) / fadeOut;
  return Math.max(0, Math.min(1, o));
}

export const CuttieComposition: React.FC<CuttieCompositionProps> = ({ layers }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const duration = durationInFrames / fps;

  const visibleLayers = layers.filter((l) => l.visible);

  return (
    <AbsoluteFill style={{ background: "black", width: 1080, height: 1920 }}>
      {visibleLayers.map((layer) => {
        const { transform, style } = layer;
        const opacity = layerOpacity(layer, currentTime, duration);

        return (
          <div
            key={layer.id}
            style={{
              position: "absolute",
              left: transform.x,
              top: transform.y,
              width: transform.width,
              height: transform.height,
              opacity,
              filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
              borderRadius: style.borderRadius > 0 ? style.borderRadius : undefined,
              overflow: style.borderRadius > 0 ? "hidden" : undefined,
            }}
          >
            {(layer.type === "gameplay" || layer.type === "facecam") && (
              <VideoLayer layer={layer} />
            )}
            {layer.type === "subtitles" && <SubtitleLayer layer={layer} />}
            {layer.type === "chat" && <ChatLayer layer={layer} />}
            {layer.type === "asset" && <AssetLayer layer={layer} />}
            {layer.type === "shape" && <ShapeLayer layer={layer} />}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
