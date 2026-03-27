import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer } from "../../lib/editorTypes";
import { animatedOpacity } from "../../lib/animations";
import GameplayLayer from "./layers/GameplayLayer";
import FacecamLayer from "./layers/FacecamLayer";
import SubtitleLayer from "./layers/SubtitleLayer";
import ShapeLayer from "./layers/ShapeLayer";
import AssetLayer from "./layers/AssetLayer";

export interface CuttieCompositionProps {
  layers: Layer[];
}

function LayerContent({ layer }: { layer: Layer }) {
  switch (layer.type) {
    case "gameplay":  return <GameplayLayer layer={layer} />;
    case "facecam":   return <FacecamLayer layer={layer} />;
    case "subtitles": return <SubtitleLayer layer={layer} />;
    case "shape":     return <ShapeLayer layer={layer} />;
    case "asset":     return <AssetLayer layer={layer} />;
    default:          return null;
  }
}

/**
 * Converts Remotion's frame-based time into seconds, then calls the same
 * animatedOpacity() used in NativePreviewViewport. Logic written once.
 */
function AnimatedLayerWrapper({ layer, children }: { layer: Layer; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const currentTime = frame / fps;
  const duration = durationInFrames / fps;

  const { style } = layer;
  const opacity = animatedOpacity(style, currentTime, duration);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        opacity,
        borderRadius: !layer.shape && style.borderRadius > 0 ? style.borderRadius : undefined,
        overflow: !layer.shape && style.borderRadius > 0 ? "hidden" : undefined,
        filter: style.blur > 0 ? `blur(${style.blur}px)` : undefined,
      }}
    >
      {children}
    </div>
  );
}

export default function CuttieComposition({ layers }: CuttieCompositionProps) {
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {layers.map((layer) => {
        if (!layer.visible) return null;
        return (
          <div
            key={layer.id}
            style={{
              position: "absolute",
              left: layer.transform.x,
              top: layer.transform.y,
              width: layer.transform.width,
              height: layer.transform.height,
            }}
          >
            <AnimatedLayerWrapper layer={layer}>
              <LayerContent layer={layer} />
            </AnimatedLayerWrapper>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
